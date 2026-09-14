// Maç senaryosu (script) üretimi.
// Kickoff anında bir kez üretilir: kadrolar, tüm olaylar (gol, kart, değişiklik,
// sakatlık, VAR, penaltı), istatistik zaman çizelgeleri ve maç sonu gerçekleri.
// Canlı akış bu script'i dakika dakika "açıklar".

import type { Facts } from "./markets.ts";
import { type Expectation, FIRST_HALF_SHARE, MISSED_PEN_PER_TEAM, PEN_GOAL_FRAC } from "./model.ts";
import { hashSeed, Rng } from "./rng.ts";

export type Position = "GK" | "DEF" | "MID" | "FWD";

export interface PlayerRow {
  id: number;
  team_id: number;
  name: string;
  number: number | null;
  position: Position;
  talent: number;
  finishing: number;
  creativity: number;
  aggression: number;
  injured_until: string | null;
  suspended_matches: number;
}

export interface PlayerRef {
  id: number;
  name: string;
  number: number | null;
  position: Position;
}

export interface Lineup {
  formation: string;
  starters: PlayerRef[];
  bench: PlayerRef[];
}

export type Side = "home" | "away";

/** Zaman anahtarı: 1. yarı = dakika (+uzatma), 2. yarı = 100 + dakika (+uzatma) */
export interface SimTime {
  half: 1 | 2;
  minute: number;        // 1..45 / 46..90
  extra: number | null;  // uzatma dakikası
}
export const tkey = (t: SimTime) => (t.half === 1 ? 0 : 100) + t.minute + (t.extra ?? 0);
export function timeFromAbs(half: 1 | 2, abs: number): SimTime {
  // abs: 1. yarıda 1..45+st, 2. yarıda 46..90+st
  const cap = half === 1 ? 45 : 90;
  return { half, minute: Math.min(abs, cap), extra: abs > cap ? abs - cap : null };
}

export type EventType = "Goal" | "Card" | "subst" | "Var" | "Injury" | "Chance";

export interface SimEvent {
  time: SimTime;
  side: Side;
  type: EventType;
  detail: string;
  player: PlayerRef | null;
  assist: PlayerRef | null;
  comments: string | null;
}

export interface StatTimeline {
  shots: number[];      // artışların zaman anahtarları (tkey), sıralı
  sot: number[];
  corners: number[];
  fouls: number[];
  offsides: number[];
  saves: number[];
  possession: number;   // %
  passes: number;
  passAcc: number;      // %
}

export interface Scenario {
  ht_home: number;
  ht_away: number;
  ft_home: number;
  ft_away: number;
  note?: string;
}

export interface Script {
  version: 1;
  lineups: { home: Lineup; away: Lineup };
  events: SimEvent[];
  stoppage: { h1: number; h2: number };
  stats: { home: StatTimeline; away: StatTimeline };
  facts: Facts;
  injuries: { player_id: number; days: number }[];
  suspensions: { player_id: number; matches: number }[];
  scenario: Scenario | null;
}

export interface TeamCtx {
  id: number;
  name: string;
  players: PlayerRow[];
}

const ref = (p: PlayerRow | PlayerRef): PlayerRef => ({ id: p.id, name: p.name, number: p.number, position: p.position });

const FORMATIONS: { name: string; def: number; mid: number; fwd: number; w: number }[] = [
  { name: "4-3-3", def: 4, mid: 3, fwd: 3, w: 0.35 },
  { name: "4-2-3-1", def: 4, mid: 5, fwd: 1, w: 0.3 },
  { name: "4-4-2", def: 4, mid: 4, fwd: 2, w: 0.2 },
  { name: "3-5-2", def: 3, mid: 5, fwd: 2, w: 0.15 },
];

/** Uygun (sakat/cezalı olmayan) oyunculardan ilk 11 + yedekler */
export function pickLineup(players: PlayerRow[], kickoff: Date, rng: Rng): Lineup {
  const available = players.filter((p) =>
    p.suspended_matches <= 0 && (!p.injured_until || new Date(p.injured_until) <= kickoff)
  );
  const pool = available.length >= 11 ? available : players;
  const score = (p: PlayerRow) => p.talent + rng.range(-0.08, 0.08);
  const byPos = (pos: Position) => pool.filter((p) => p.position === pos).sort((a, b) => score(b) - score(a));

  const f = rng.weighted(FORMATIONS, (x) => x.w)!;
  const taken = new Set<number>();
  const take = (pos: Position, n: number) => {
    const out: PlayerRow[] = [];
    for (const p of byPos(pos)) {
      if (out.length >= n) break;
      if (taken.has(p.id)) continue;
      taken.add(p.id);
      out.push(p);
    }
    return out;
  };

  const starters: PlayerRow[] = [...take("GK", 1), ...take("DEF", f.def), ...take("MID", f.mid), ...take("FWD", f.fwd)];
  // Eksik mevki varsa en yetenekli kalanlarla doldur
  if (starters.length < 11) {
    const rest = pool.filter((p) => !taken.has(p.id)).sort((a, b) => b.talent - a.talent);
    for (const p of rest) {
      if (starters.length >= 11) break;
      taken.add(p.id);
      starters.push(p);
    }
  }
  const restAll = pool.filter((p) => !taken.has(p.id)).sort((a, b) => b.talent - a.talent);
  const bench: PlayerRow[] = [];
  const gk = restAll.find((p) => p.position === "GK");
  if (gk) bench.push(gk);
  for (const p of restAll) {
    if (bench.length >= 7) break;
    if (!bench.includes(p)) bench.push(p);
  }
  return { formation: f.name, starters: starters.map(ref), bench: bench.map(ref) };
}

// ---------------------------------------------------------------------
// Yardımcılar
// ---------------------------------------------------------------------
const POS_GOAL: Record<Position, number> = { GK: 0.004, DEF: 0.12, MID: 0.45, FWD: 1.0 };
const POS_ASSIST: Record<Position, number> = { GK: 0.03, DEF: 0.35, MID: 1.0, FWD: 0.8 };
const POS_CARD: Record<Position, number> = { GK: 0.15, DEF: 1.0, MID: 0.9, FWD: 0.5 };

interface TeamState {
  side: Side;
  ctx: TeamCtx;
  lineup: Lineup;
  byId: Map<number, PlayerRow>;
  /** sahaya giriş/çıkış kayıtları: id -> [inKey, outKey] */
  onFrom: Map<number, number>;
  offAt: Map<number, number>;
  bench: PlayerRef[];
  subsUsed: number;
  yellows: Set<number>;
  sentOff: Set<number>;
}

function onPitch(ts: TeamState, k: number): PlayerRef[] {
  const out: PlayerRef[] = [];
  const all = [...ts.lineup.starters, ...ts.lineup.bench];
  for (const p of all) {
    const from = ts.onFrom.get(p.id);
    if (from === undefined || from > k) continue;
    const off = ts.offAt.get(p.id);
    if (off !== undefined && off <= k) continue;
    out.push(p);
  }
  return out;
}

function attr(ts: TeamState, p: PlayerRef, key: "finishing" | "creativity" | "aggression" | "talent"): number {
  return ts.byId.get(p.id)?.[key] ?? 0.5;
}

// ---------------------------------------------------------------------
// Ana üretim
// ---------------------------------------------------------------------
export interface GenerateInput {
  seed: number;
  kickoff: Date;
  home: TeamCtx;
  away: TeamCtx;
  exp: Expectation;
  scenario: Scenario | null;
}

/**
 * Yarının uzatma süresi (1–9 dk): hakem gibi, yarıda kaybedilen zamana göre.
 * Gol sevinci, sakatlık (ve zorunlu değişiklik), kırmızı kart, VAR incelemesi,
 * oyuncu değişikliği ve kartlar süreyi uzatır. Uzatmaya yerleşmiş bir olay varsa
 * uzatma en az o dakikaya kadar sürer.
 */
function stoppageFor(events: SimEvent[], half: 1 | 2, rng: Rng): number {
  const inHalf = events.filter((e) => e.time.half === half);
  const n = (f: (e: SimEvent) => boolean) => inHalf.filter(f).length;
  const goals = n((e) => e.type === "Goal" && e.detail !== "Missed Penalty");
  const missedPens = n((e) => e.type === "Goal" && e.detail === "Missed Penalty");
  const injuries = n((e) => e.type === "Injury");
  const reds = n((e) => e.type === "Card" && e.detail !== "Yellow Card");
  const yellows = n((e) => e.type === "Card" && e.detail === "Yellow Card");
  const vars = n((e) => e.type === "Var");
  const subs = n((e) => e.type === "subst");

  const base = half === 1 ? 0.8 : 1.0;
  const raw = base
    + goals * 0.55 + missedPens * 0.6
    + injuries * 1.3
    + reds * 1.0
    + vars * 1.2
    + yellows * 0.25
    + subs * (half === 1 ? 0.5 : 0.3)
    + rng.normal(0, half === 1 ? 0.5 : 0.8);

  // Uzatmada gerçekleşen olay varsa süre en az o kadar
  const lastExtra = Math.max(0, ...inHalf.map((e) => e.time.extra ?? 0));
  return Math.max(1, Math.min(9, Math.max(Math.round(raw), lastExtra)));
}

export function generateScript(inp: GenerateInput): Script {
  const rng = new Rng(inp.seed);
  // Olaylar geçici bir uzatma penceresine yerleştirilir; gerçek uzatma (1–9 dk) maçın
  // gidişatına göre (gol, sakatlık, kart, VAR, değişiklik) olaylar bittikten sonra hesaplanır.
  const END1 = 45 + 2;                // 1. yarı olay penceresi (mutlak dakika)
  const END2 = 90 + 4;                // 2. yarı olay penceresi

  const mk = (side: Side, ctx: TeamCtx): TeamState => {
    const lineup = pickLineup(ctx.players, inp.kickoff, rng);
    const ts: TeamState = {
      side, ctx, lineup, byId: new Map(ctx.players.map((p) => [p.id, p])),
      onFrom: new Map(), offAt: new Map(), bench: lineup.bench.slice(), subsUsed: 0,
      yellows: new Set(), sentOff: new Set(),
    };
    for (const p of lineup.starters) ts.onFrom.set(p.id, 0);
    return ts;
  };
  const H = mk("home", inp.home);
  const A = mk("away", inp.away);
  const teams: Record<Side, TeamState> = { home: H, away: A };
  const other = (s: Side): Side => (s === "home" ? "away" : "home");

  const events: SimEvent[] = [];
  const usedKeys = new Set<number>();
  const injuries: Script["injuries"] = [];
  const suspensions: Script["suspensions"] = [];

  /** Belirli aralıkta boş bir dakika seç (mutlak) */
  const pickAbs = (half: 1 | 2, lo: number, hi: number, weightLate = 0): number => {
    for (let tries = 0; tries < 40; tries++) {
      const abs = rng.weighted(
        Array.from({ length: hi - lo + 1 }, (_, i) => lo + i),
        (m) => 1 + weightLate * ((m - lo) / Math.max(1, hi - lo)),
      )!;
      const k = tkey(timeFromAbs(half, abs));
      if (!usedKeys.has(k)) { usedKeys.add(k); return abs; }
    }
    return hi;
  };
  const push = (e: SimEvent) => { events.push(e); };

  // ---------------- 1) Kırmızı kartlar ----------------
  const reds: { side: Side; k: number }[] = [];
  for (const side of ["home", "away"] as Side[]) {
    if (rng.chance(0.07)) {
      const half: 1 | 2 = rng.chance(0.3) ? 1 : 2;
      const abs = half === 1 ? pickAbs(1, 15, END1) : pickAbs(2, 46, END2);
      const time = timeFromAbs(half, abs);
      const k = tkey(time);
      const ts = teams[side];
      const cand = onPitch(ts, k).filter((p) => p.position !== "GK");
      const p = rng.weighted(cand, (x) => POS_CARD[x.position] * (0.4 + attr(ts, x, "aggression")))!;
      const second = rng.chance(0.45);
      if (second) {
        // önce sarı, sonra ikinci sarı
        const firstAbs = Math.max(half === 1 ? 5 : 46, abs - rng.int(8, 30));
        const firstTime = timeFromAbs(half, Math.min(firstAbs, abs - 1));
        push({ time: firstTime, side, type: "Card", detail: "Yellow Card", player: p, assist: null, comments: "Faul" });
        ts.yellows.add(p.id);
      }
      push({ time, side, type: "Card", detail: second ? "Second Yellow card" : "Red Card", player: p, assist: null, comments: second ? "İkinci sarı kart" : "Sert faul" });
      ts.offAt.set(p.id, k);
      ts.sentOff.add(p.id);
      reds.push({ side, k });
      suspensions.push({ player_id: p.id, matches: second ? 1 : rng.chance(0.5) ? 1 : 2 });
    }
  }

  // ---------------- 2) Gol sayıları ----------------
  const sc = inp.scenario;
  let goals: Record<Side, [number, number]>;
  if (sc) {
    goals = {
      home: [sc.ht_home, Math.max(0, sc.ft_home - sc.ht_home)],
      away: [sc.ht_away, Math.max(0, sc.ft_away - sc.ht_away)],
    };
  } else {
    const lam = (side: Side, half: 1 | 2) => {
      const base = (side === "home" ? inp.exp.lambdaHome : inp.exp.lambdaAway) * (half === 1 ? FIRST_HALF_SHARE : 1 - FIRST_HALF_SHARE);
      // kırmızı kart: eksik kalan takım zayıflar, rakip güçlenir (kalan süre oranında)
      let mul = 1;
      for (const r of reds) {
        const rk = r.k;
        const halfStart = half === 1 ? 0 : 100 + 45;
        const halfEnd = half === 1 ? END1 : 100 + END2;
        const frac = Math.max(0, Math.min(1, (halfEnd - Math.max(rk, halfStart)) / (halfEnd - halfStart)));
        if (frac <= 0) continue;
        mul *= r.side === side ? 1 - 0.28 * frac : 1 + 0.3 * frac;
      }
      return base * mul;
    };
    goals = {
      home: [Math.min(6, rng.poisson(lam("home", 1))), Math.min(6, rng.poisson(lam("home", 2)))],
      away: [Math.min(6, rng.poisson(lam("away", 1))), Math.min(6, rng.poisson(lam("away", 2)))],
    };
  }

  // ---------------- 3) Sakatlıklar ----------------
  for (const side of ["home", "away"] as Side[]) {
    if (!rng.chance(0.11)) continue;
    const half: 1 | 2 = rng.chance(0.45) ? 1 : 2;
    const abs = half === 1 ? pickAbs(1, 4, 44) : pickAbs(2, 47, 84);
    const time = timeFromAbs(half, abs);
    const k = tkey(time);
    const ts = teams[side];
    const cand = onPitch(ts, k);
    const p = rng.pick(cand);
    push({ time, side, type: "Injury", detail: "Injury", player: p, assist: null, comments: "Sakatlandı, oyuna devam edemiyor" });
    injuries.push({ player_id: p.id, days: rng.weighted([4, 7, 12, 21, 35, 60], (_, i) => [0.3, 0.3, 0.2, 0.12, 0.06, 0.02][i])! });
    // zorunlu değişiklik
    const inP = pickSubIn(ts, p, rng);
    if (inP) {
      ts.subsUsed++;
      ts.offAt.set(p.id, k);
      ts.onFrom.set(inP.id, k);
      ts.bench = ts.bench.filter((b) => b.id !== inP.id);
      push({ time, side, type: "subst", detail: `Substitution ${ts.subsUsed}`, player: p, assist: inP, comments: "Sakatlık nedeniyle" });
    } else {
      ts.offAt.set(p.id, k);
    }
  }

  // ---------------- 4) Normal değişiklikler ----------------
  for (const side of ["home", "away"] as Side[]) {
    const ts = teams[side];
    const target = rng.weighted([3, 4, 5], (_, i) => [0.5, 0.35, 0.15][i])!;
    let guard = 0;
    while (ts.subsUsed < target && ts.bench.length && guard++ < 10) {
      const bucket = rng.weighted([0, 1, 2, 3], (_, i) => [0.1, 0.4, 0.42, 0.08][i])!;
      const abs = bucket === 0 ? 46 : bucket === 1 ? rng.int(55, 70) : bucket === 2 ? rng.int(71, 84) : rng.int(85, 90);
      const time = timeFromAbs(2, abs);
      const k = tkey(time);
      const cand = onPitch(ts, k).filter((p) => p.position !== "GK" && ts.onFrom.get(p.id) === 0);
      if (!cand.length) break;
      const out = rng.weighted(cand, (p) => (p.position === "DEF" ? 0.5 : 1) * (1.25 - attr(ts, p, "talent")))!;
      const inP = pickSubIn(ts, out, rng);
      if (!inP) break;
      ts.subsUsed++;
      ts.offAt.set(out.id, k);
      ts.onFrom.set(inP.id, k);
      ts.bench = ts.bench.filter((b) => b.id !== inP.id);
      push({ time, side, type: "subst", detail: `Substitution ${ts.subsUsed}`, player: out, assist: inP, comments: null });
    }
  }

  // ---------------- 5) Goller ----------------
  let penalty = false;
  const goalTimes: Record<Side, number[]> = { home: [], away: [] };
  for (const side of ["home", "away"] as Side[]) {
    for (const half of [1, 2] as (1 | 2)[]) {
      const n = goals[side][half - 1];
      for (let g = 0; g < n; g++) {
        const abs = half === 1 ? pickAbs(1, 1, END1, 0.6) : pickAbs(2, 46, END2, 0.7);
        const time = timeFromAbs(half, abs);
        const k = tkey(time);
        const ts = teams[side];
        const opp = teams[other(side)];
        const roll = rng.next();
        if (roll < PEN_GOAL_FRAC) {
          // Penaltı golü
          penalty = true;
          const cand = onPitch(ts, k);
          const taker = cand.slice().sort((a, b) => attr(ts, b, "finishing") - attr(ts, a, "finishing"))[0] ?? cand[0];
          if (rng.chance(0.5)) {
            push({ time, side, type: "Var", detail: "Penalty confirmed", player: null, assist: null, comments: "VAR incelemesi sonucu penaltı" });
          }
          push({ time, side, type: "Goal", detail: "Penalty", player: taker, assist: null, comments: "Penaltıdan gol" });
        } else if (roll < PEN_GOAL_FRAC + 0.03) {
          // Kendi kalesine
          const cand = onPitch(opp, k).filter((p) => p.position === "DEF" || p.position === "MID");
          const og = rng.pick(cand.length ? cand : onPitch(opp, k));
          push({ time, side, type: "Goal", detail: "Own Goal", player: og, assist: null, comments: "Kendi kalesine" });
        } else {
          const cand = onPitch(ts, k);
          const scorer = rng.weighted(cand, (p) => POS_GOAL[p.position] * (0.35 + attr(ts, p, "finishing")))!;
          let assist: PlayerRef | null = null;
          if (rng.chance(0.74)) {
            const others = cand.filter((p) => p.id !== scorer.id);
            assist = rng.weighted(others, (p) => POS_ASSIST[p.position] * (0.35 + attr(ts, p, "creativity"))) ?? null;
          }
          const kind = rng.weighted(["Şık bir vuruş", "Kafa golü", "Yakın mesafeden", "Uzaktan sert şut", "Kontratak sonunda", "Karambolde", "Plase vuruş"], () => 1)!;
          push({ time, side, type: "Goal", detail: "Normal Goal", player: scorer, assist, comments: kind });
        }
        goalTimes[side].push(k);
      }
    }
  }

  // ---------------- 6) Kaçan penaltı ----------------
  for (const side of ["home", "away"] as Side[]) {
    if (!rng.chance(MISSED_PEN_PER_TEAM)) continue;
    penalty = true;
    const half: 1 | 2 = rng.chance(0.45) ? 1 : 2;
    const abs = half === 1 ? pickAbs(1, 5, END1) : pickAbs(2, 46, END2);
    const time = timeFromAbs(half, abs);
    const ts = teams[side];
    const cand = onPitch(ts, tkey(time));
    const taker = cand.slice().sort((a, b) => attr(ts, b, "finishing") - attr(ts, a, "finishing"))[0];
    if (!taker) continue;
    push({ time, side, type: "Goal", detail: "Missed Penalty", player: taker, assist: null, comments: rng.chance(0.5) ? "Kaleci kurtardı" : "Direkten döndü" });
  }

  // ---------------- 7) Sarı kartlar ----------------
  for (const side of ["home", "away"] as Side[]) {
    const ts = teams[side];
    const n = Math.min(5, rng.poisson(1.9));
    for (let i = 0; i < n; i++) {
      const half: 1 | 2 = rng.chance(0.38) ? 1 : 2;
      const abs = half === 1 ? pickAbs(1, 8, END1, 0.5) : pickAbs(2, 46, END2, 0.5);
      const time = timeFromAbs(half, abs);
      const k = tkey(time);
      const cand = onPitch(ts, k).filter((p) => !ts.yellows.has(p.id));
      if (!cand.length) break;
      const p = rng.weighted(cand, (x) => POS_CARD[x.position] * (0.4 + attr(ts, x, "aggression")))!;
      ts.yellows.add(p.id);
      push({ time, side, type: "Card", detail: "Yellow Card", player: p, assist: null, comments: rng.pick(["Faul", "Sert müdahale", "İtiraz", "Zaman geçirme", "Taktik faul"]) });
    }
  }

  // ---------------- 8) VAR: iptal edilen gol ----------------
  if (rng.chance(0.12)) {
    const side = rng.pick(["home", "away"] as Side[]);
    const half: 1 | 2 = rng.chance(0.5) ? 1 : 2;
    const abs = half === 1 ? pickAbs(1, 5, 44) : pickAbs(2, 47, 89);
    const time = timeFromAbs(half, abs);
    const ts = teams[side];
    const cand = onPitch(ts, tkey(time));
    const p = rng.weighted(cand, (x) => POS_GOAL[x.position] * (0.35 + attr(ts, x, "finishing"))) ?? null;
    push({ time, side, type: "Var", detail: "Goal cancelled", player: p, assist: null, comments: rng.chance(0.7) ? "Ofsayt" : "Faul" });
  }

  // Zaman sırasına diz; değişiklikleri takım bazında yeniden numarala
  events.sort((a, b) => tkey(a.time) - tkey(b.time));
  const subNo: Record<Side, number> = { home: 0, away: 0 };
  for (const e of events) {
    if (e.type === "subst") e.detail = `Substitution ${++subNo[e.side]}`;
  }

  // ---------------- 9) Uzatma süreleri (1–9 dk, gidişata göre) ----------------
  const stoppage = { h1: stoppageFor(events, 1, rng), h2: stoppageFor(events, 2, rng) };
  const FIN1 = 45 + stoppage.h1;      // 1. yarı gerçek bitiş (mutlak dakika)
  const FIN2 = 90 + stoppage.h2;      // 2. yarı gerçek bitiş

  // ---------------- 10) İstatistikler ----------------
  const totalGoals = (s: Side) => goals[s][0] + goals[s][1];
  const cornersTotal = rng.poisson(inp.exp.corners);
  const pHomeCorner = Math.min(0.72, Math.max(0.28, 0.5 + (inp.exp.home.att - inp.exp.away.att) / 200));
  const cornerKeys: Record<Side, number[]> = { home: [], away: [] };
  let corners1h = 0;
  for (let i = 0; i < cornersTotal; i++) {
    const half: 1 | 2 = rng.chance(FIRST_HALF_SHARE) ? 1 : 2;
    const abs = half === 1 ? rng.int(1, FIN1) : rng.int(46, FIN2);
    const k = tkey(timeFromAbs(half, abs));
    if (half === 1) corners1h++;
    cornerKeys[rng.chance(pHomeCorner) ? "home" : "away"].push(k);
  }

  const possHome = Math.round(Math.min(72, Math.max(28, 50 + (inp.exp.home.mid - inp.exp.away.mid) * 0.55 + rng.normal(0, 3))));
  const statsFor = (side: Side): StatTimeline => {
    const lam = side === "home" ? inp.exp.lambdaHome : inp.exp.lambdaAway;
    const g = totalGoals(side);
    const shots = Math.max(g + 1, Math.round(rng.normal(lam * 4.6 + 4, 2.5)));
    const sot = Math.max(g, Math.round(shots * rng.range(0.3, 0.48)));
    const randKeys = (n: number) => {
      const ks: number[] = [];
      for (let i = 0; i < n; i++) {
        const half: 1 | 2 = rng.chance(0.47) ? 1 : 2;
        const abs = half === 1 ? rng.int(1, FIN1) : rng.int(46, FIN2);
        ks.push(tkey(timeFromAbs(half, abs)));
      }
      return ks;
    };
    const shotKeys = [...goalTimes[side], ...randKeys(shots - g)].sort((a, b) => a - b);
    const sotKeys = [...goalTimes[side], ...randKeys(sot - g)].sort((a, b) => a - b);
    const oppSot = 0; // rakip isabetli şut sayısı aşağıda hesaplanır (kurtarışlar için)
    void oppSot;
    const poss = side === "home" ? possHome : 100 - possHome;
    return {
      shots: shotKeys,
      sot: sotKeys,
      corners: cornerKeys[side].sort((a, b) => a - b),
      fouls: randKeys(rng.int(8, 17)).sort((a, b) => a - b),
      offsides: randKeys(rng.int(0, 5)).sort((a, b) => a - b),
      saves: [],
      possession: poss,
      passes: Math.max(150, Math.round(poss * 9 + rng.normal(0, 40))),
      passAcc: Math.round(Math.min(92, Math.max(62, 70 + (side === "home" ? inp.exp.home.mid : inp.exp.away.mid) * 0.2 + rng.normal(0, 3)))),
    };
  };
  const statsHome = statsFor("home");
  const statsAway = statsFor("away");
  // Kurtarış: rakibin isabetli ama gol olmayan şutları
  const savesFrom = (oppSot: number[], oppGoals: number[]) => {
    const g = new Set(oppGoals);
    return oppSot.filter((k) => !g.has(k));
  };
  statsHome.saves = savesFrom(statsAway.sot, goalTimes.away);
  statsAway.saves = savesFrom(statsHome.sot, goalTimes.home);

  const facts: Facts = {
    h1: goals.home[0], a1: goals.away[0], h2: goals.home[1], a2: goals.away[1],
    corners: cornersTotal, corners1h, penalty,
  };

  return {
    version: 1,
    lineups: { home: H.lineup, away: A.lineup },
    events,
    stoppage,
    stats: { home: statsHome, away: statsAway },
    facts,
    injuries,
    suspensions,
    scenario: sc,
  };
}

function pickSubIn(ts: TeamState, out: PlayerRef, rng: Rng): PlayerRef | null {
  if (!ts.bench.length) return null;
  const same = ts.bench.filter((b) => b.position === out.position);
  const pool = same.length ? same : ts.bench.filter((b) => b.position !== "GK");
  if (!pool.length) return out.position === "GK" ? ts.bench[0] : null;
  return rng.weighted(pool, (p) => 0.3 + attr(ts, p, "talent")) ?? null;
}

// ---------------------------------------------------------------------
// Canlı görünüm: script'i verilen zamana kadar aç
// ---------------------------------------------------------------------
export interface Snapshot {
  h1: number; a1: number; h2: number; a2: number;
  corners: number; corners1h: number;
  penalty: boolean;
  redHome: number; redAway: number;
  events: SimEvent[];
}

/** İstatistiklerden tehlikeli anlar (direk, kurtarış, kaçan gol). Eski script'lere de uygulanır. */
export function withChanceEvents(script: Script): Script {
  if (script.events.some((e) => e.type === "Chance")) return script;
  const extra = deriveChanceEvents(script);
  if (!extra.length) return script;
  return { ...script, events: [...script.events, ...extra].sort((a, b) => tkey(a.time) - tkey(b.time)) };
}

function timeFromKey(k: number): SimTime {
  return k >= 100 ? timeFromAbs(2, k - 100) : timeFromAbs(1, k);
}

function pitchFromScript(script: Script, side: Side, at: number): PlayerRef[] {
  const lu = script.lineups[side];
  const onFrom = new Map<number, number>(lu.starters.map((p) => [p.id, 0]));
  const offAt = new Map<number, number>();
  for (const e of script.events) {
    if (e.side !== side) continue;
    const ek = tkey(e.time);
    if (e.type === "subst" && e.player && e.assist) {
      offAt.set(e.player.id, ek);
      onFrom.set(e.assist.id, ek);
    }
    if (e.type === "Card" && (e.detail === "Red Card" || e.detail === "Second Yellow card") && e.player) {
      offAt.set(e.player.id, ek);
    }
    if (e.type === "Injury" && e.player && !script.events.some((x) => x.type === "subst" && x.player?.id === e.player?.id && tkey(x.time) === ek)) {
      offAt.set(e.player.id, ek);
    }
  }
  const all = [...lu.starters, ...lu.bench];
  return all.filter((p) => {
    const from = onFrom.get(p.id);
    if (from === undefined || from > at) return false;
    const off = offAt.get(p.id);
    return off === undefined || off > at;
  });
}

function pickAttacker(rng: Rng, pitch: PlayerRef[]): PlayerRef | null {
  if (!pitch.length) return null;
  return rng.weighted(pitch, (p) => POS_GOAL[p.position] * (0.35 + (p.position === "FWD" ? 0.4 : 0.15))) ?? pitch[0];
}

function deriveChanceEvents(script: Script): SimEvent[] {
  const seed = hashSeed(
    "chance",
    script.facts.h1, script.facts.a1, script.facts.h2, script.facts.a2,
    script.stats.home.shots.length, script.stats.away.shots.length,
    script.stats.home.sot[0] ?? 0, script.stats.away.sot[0] ?? 0,
  );
  const rng = new Rng(seed);
  const goalKeys = new Set(
    script.events.filter((e) => e.type === "Goal" && e.detail !== "Missed Penalty").map((e) => tkey(e.time)),
  );
  const used = new Set(script.events.map((e) => tkey(e.time)));
  const out: SimEvent[] = [];

  const push = (side: Side, k: number, detail: string, comments: string, player: PlayerRef | null, assist: PlayerRef | null = null) => {
    used.add(k);
    out.push({ time: timeFromKey(k), side, type: "Chance", detail, player, assist, comments });
  };

  const woodCandidates: { side: Side; k: number }[] = [];
  for (const side of ["home", "away"] as Side[]) {
    const sot = new Set(script.stats[side].sot);
    const opp = side === "home" ? "away" : "home";
    const oppGk = () => pitchFromScript(script, opp, 0).find((p) => p.position === "GK") ?? null;

    // İsabetli şut + gol değil = kaleci kurtardı (istatistikteki "Goalkeeper Saves")
    for (const k of script.stats[side].sot) {
      if (goalKeys.has(k)) continue;
      const pitch = pitchFromScript(script, side, k);
      const p = pickAttacker(rng, pitch);
      const gk = pitchFromScript(script, opp, k).find((x) => x.position === "GK") ?? oppGk();
      push(side, k, "Save", gk
        ? `${p?.name ?? "Oyuncu"} tehlikeli vuruyor, ${gk.name} son anda çıkarıyor`
        : `${p?.name ?? "Oyuncu"} tehlikeli vuruyor, kaleci son anda çıkarıyor`, p, gk);
    }

    const offTarget: number[] = [];
    for (const k of script.stats[side].shots) {
      if (sot.has(k) || goalKeys.has(k) || used.has(k)) continue;
      offTarget.push(k);
      woodCandidates.push({ side, k });
    }
    for (const k of offTarget) {
      if (used.has(k)) continue;
      const pitch = pitchFromScript(script, side, k);
      const p = pickAttacker(rng, pitch);
      const late = (k >= 85 && k < 100) || k >= 185;
      const roll = rng.next();
      if (roll < 0.16 || (late && roll < 0.32)) {
        push(side, k, "Big Chance", late
          ? `Kaçan gol! ${p?.name ?? "Oyuncu"} son anda ağları bulamıyor`
          : `${p?.name ?? "Oyuncu"} net pozisyonda kaleyi ıskalıyor`, p);
      }
    }

    // Şutsuz tehlikeli ataklar (az sayıda)
    const nAtk = rng.int(1, 3);
    let guard = 0;
    while (out.filter((e) => e.side === side && e.detail === "Dangerous Attack").length < nAtk && guard++ < 20) {
      const half: 1 | 2 = rng.chance(0.45) ? 1 : 2;
      const abs = half === 1 ? rng.int(8, 44) : rng.int(50, 88);
      const k = tkey(timeFromAbs(half, abs));
      if (used.has(k) || goalKeys.has(k)) continue;
      const pitch = pitchFromScript(script, side, k);
      const p = pickAttacker(rng, pitch);
      push(side, k, "Dangerous Attack", `${p?.name ?? "Oyuncu"} ceza sahasına süzülüyor, savunma son anda müdahale ediyor`, p);
    }
  }
  const woodPool = woodCandidates.filter((c) => !used.has(c.k));
  if (woodPool.length && rng.chance(0.22)) {
    const pick = rng.weighted(woodPool, (c) => 1 + (((c.k >= 85 && c.k < 100) || c.k >= 185) ? 1.2 : 0))!;
    const p = pickAttacker(rng, pitchFromScript(script, pick.side, pick.k));
    push(pick.side, pick.k, "Woodwork", `Direkten döndü! ${p?.name ?? "Oyuncu"} şutu direğe çarpıyor`, p);
  }
  return out.sort((a, b) => tkey(a.time) - tkey(b.time));
}

/** k: geçerli zaman anahtarı (dahil). HT için k = 99 (1. yarının tamamı) */
export function snapshot(script: Script, k: number): Snapshot {
  const src = withChanceEvents(script);
  const s: Snapshot = { h1: 0, a1: 0, h2: 0, a2: 0, corners: 0, corners1h: 0, penalty: false, redHome: 0, redAway: 0, events: [] };
  for (const e of src.events) {
    const ek = tkey(e.time);
    if (ek > k) break;
    s.events.push(e);
    if (e.type === "Goal") {
      if (e.detail === "Missed Penalty") { s.penalty = true; continue; }
      if (e.detail === "Penalty") s.penalty = true;
      if (e.time.half === 1) { if (e.side === "home") s.h1++; else s.a1++; }
      else { if (e.side === "home") s.h2++; else s.a2++; }
    } else if (e.type === "Card" && (e.detail === "Red Card" || e.detail === "Second Yellow card")) {
      if (e.side === "home") s.redHome++; else s.redAway++;
    }
  }
  for (const side of ["home", "away"] as Side[]) {
    for (const ck of script.stats[side].corners) {
      if (ck > k) continue;
      s.corners++;
      if (ck < 100) s.corners1h++;
    }
  }
  return s;
}

/** Bir istatistik dizisinden k anına kadar olan sayım */
export const countUpTo = (keys: number[], k: number) => {
  let n = 0;
  for (const x of keys) { if (x <= k) n++; else break; }
  return n;
};
