// Güç modeli ve oran fiyatlama.
//  - Takım güçleri (hücum/orta saha/defans/kaleci) + sezon içi performans + form -> etkin güç
//  - Etkin güç farkı -> Poisson gol beklentileri (yarı yarı)
//  - Ortak dağılım (1Y ev, 1Y dep, 2Y ev, 2Y dep) x korner x penaltı -> tüm pazar olasılıkları
//  - Marj eklenerek oranlar üretilir (maç öncesi ve canlı aynı yol)

import { type Facts, MARKETS, type MarketDef, outcome, selectionsOf } from "./markets.ts";
import { poissonTable } from "./rng.ts";

export interface RatingRow {
  team_id: number;
  attack: number;
  midfield: number;
  defense: number;
  goalkeeper: number;
  sim_played: number;
  sim_points: number;
  sim_gf: number;
  sim_ga: number;
  sim_form: string;
}

export interface Strength {
  att: number;
  def: number;
  mid: number;
  overall: number;
  /** performansın etkin güce ağırlığı (0..0.75) */
  perfWeight: number;
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** Sezon içi performans + form ile etkin güç. totalRounds: ligdeki toplam hafta sayısı. */
export function effectiveStrength(r: RatingRow, totalRounds: number): Strength {
  const played = r.sim_played;
  const w = 0.75 * clamp(played / Math.max(6, 0.6 * totalRounds), 0, 1);

  const baseAtt = 0.7 * r.attack + 0.3 * r.midfield;
  const baseDef = 0.6 * r.defense + 0.25 * r.goalkeeper + 0.15 * r.midfield;

  let perfAtt = baseAtt;
  let perfDef = baseDef;
  if (played > 0) {
    const ppg = r.sim_points / played;
    const gfpg = r.sim_gf / played;
    const gapg = r.sim_ga / played;
    const perf = 66 + (ppg - 1.37) * 20 + ((r.sim_gf - r.sim_ga) / played) * 5;
    perfAtt = clamp(perf + (gfpg - 1.35) * 6, 38, 96);
    perfDef = clamp(perf - (gapg - 1.35) * 6, 38, 96);
  }

  // Form: son 5 maç puanı (0..15) -> ±3 puan
  let formPts = 0, formN = 0;
  for (const ch of r.sim_form.slice(-5)) {
    formN++;
    formPts += ch === "W" ? 3 : ch === "D" ? 1 : 0;
  }
  const formAdj = formN ? ((formPts / formN) * 5 - 7) / 8 * 3 : 0;

  const att = clamp((1 - w) * baseAtt + w * perfAtt + formAdj, 30, 99);
  const def = clamp((1 - w) * baseDef + w * perfDef + formAdj, 30, 99);
  const mid = clamp(r.midfield + formAdj, 30, 99);
  return { att, def, mid, overall: (att + def + mid) / 3, perfWeight: w };
}

export interface Expectation {
  lambdaHome: number;   // 90 dk ev sahibi gol beklentisi
  lambdaAway: number;
  corners: number;      // toplam korner beklentisi
  penalty: number;      // maçta penaltı olasılığı
  home: Strength;
  away: Strength;
}

export const FIRST_HALF_SHARE = 0.46;
export const HOME_BASE = 1.32;
export const AWAY_BASE = 1.08;
const K = 0.019;
/** Golün penaltıdan olma payı ve takım başına kaçan penaltı olasılığı (script ile aynı) */
export const PEN_GOAL_FRAC = 0.06;
export const MISSED_PEN_PER_TEAM = 0.04;

export function expectation(home: Strength, away: Strength): Expectation {
  const lambdaHome = clamp(HOME_BASE * Math.exp(K * (home.att - away.def)), 0.25, 4.5);
  const lambdaAway = clamp(AWAY_BASE * Math.exp(K * (away.att - home.def)), 0.2, 4.0);
  const total = lambdaHome + lambdaAway;
  const corners = clamp(9.6 + (total - 2.4) * 1.2 + (home.mid - away.mid) * 0.01, 7, 14);
  // En az bir penaltı (atılan ya da kaçan) olasılığı: Poisson(penaltı sayısı)
  const penalty = clamp(1 - Math.exp(-(PEN_GOAL_FRAC * total + 2 * MISSED_PEN_PER_TEAM)), 0.08, 0.5);
  return { lambdaHome, lambdaAway, corners, penalty, home, away };
}

// ---------------------------------------------------------------------
// Canlı durum ve kalan beklentiler
// ---------------------------------------------------------------------
export type Phase = "pre" | "1H" | "HT" | "2H" | "FT";

export interface LiveState {
  phase: Phase;
  /** mutlak maç dakikası (1..45+, 46..90+) */
  t: number;
  h1: number; a1: number; h2: number; a2: number;
  corners: number; corners1h: number;
  penalty: boolean;
  redHome: number; redAway: number;
}

export const PRE_STATE: LiveState = {
  phase: "pre", t: 0, h1: 0, a1: 0, h2: 0, a2: 0, corners: 0, corners1h: 0, penalty: false, redHome: 0, redAway: 0,
};

interface Remaining {
  h1: number; a1: number; h2: number; a2: number;   // kalan gol beklentileri
  c1: number; c2: number;                           // kalan korner beklentileri (1Y / 2Y)
  pen: number;                                      // kalan penaltı olasılığı
}

function remaining(exp: Expectation, s: LiveState): Remaining {
  const lh1 = exp.lambdaHome * FIRST_HALF_SHARE, la1 = exp.lambdaAway * FIRST_HALF_SHARE;
  const lh2 = exp.lambdaHome * (1 - FIRST_HALF_SHARE), la2 = exp.lambdaAway * (1 - FIRST_HALF_SHARE);
  const c1 = exp.corners * FIRST_HALF_SHARE, c2 = exp.corners * (1 - FIRST_HALF_SHARE);

  // kırmızı kart etkisi
  const redH = Math.pow(0.72, s.redHome) * Math.pow(1.18, s.redAway);
  const redA = Math.pow(0.72, s.redAway) * Math.pow(1.18, s.redHome);

  // skor durumu etkisi (geride olan açılır)
  const gh = s.h1 + s.h2, ga = s.a1 + s.a2;
  const stateH = gh < ga ? 1.08 : gh > ga ? 0.94 : 1;
  const stateA = ga < gh ? 1.08 : ga > gh ? 0.94 : 1;

  if (s.phase === "pre") {
    return { h1: lh1, a1: la1, h2: lh2, a2: la2, c1, c2, pen: exp.penalty };
  }
  if (s.phase === "1H") {
    const r = clamp((47 - s.t) / 47, 0, 1);
    const boost = 1 + 0.12 * (1 - r);
    const f1 = r * boost;
    const penRem = exp.penalty * (0.46 * r + 0.54);
    return {
      h1: lh1 * f1 * redH, a1: la1 * f1 * redA,
      h2: lh2 * redH * stateH, a2: la2 * redA * stateA,
      c1: c1 * r, c2, pen: s.penalty ? 0 : penRem,
    };
  }
  if (s.phase === "HT") {
    return { h1: 0, a1: 0, h2: lh2 * redH * stateH, a2: la2 * redA * stateA, c1: 0, c2, pen: s.penalty ? 0 : exp.penalty * 0.54 };
  }
  if (s.phase === "2H") {
    const r = clamp((94 - s.t) / 49, 0, 1);
    const boost = 1 + 0.15 * (1 - r);
    const f2 = r * boost;
    return {
      h1: 0, a1: 0,
      h2: lh2 * f2 * redH * stateH, a2: la2 * f2 * redA * stateA,
      c1: 0, c2: c2 * r, pen: s.penalty ? 0 : exp.penalty * 0.54 * r,
    };
  }
  return { h1: 0, a1: 0, h2: 0, a2: 0, c1: 0, c2: 0, pen: 0 };
}

// ---------------------------------------------------------------------
// Olasılıklar
// ---------------------------------------------------------------------
export interface MarketProbs {
  code: string;
  line: number;
  /** seçim -> kazanma olasılığı (iade kütlesi çıkarılıp normalize edilmiş) */
  probs: Map<string, number>;
  /** kazananı zaten kesinleşmiş (canlı) */
  decided: boolean;
}

const MAX_GOALS = 7;   // yarı başına kuyruk sınırı
const MAX_CORNERS = 22;

export function computeProbabilities(exp: Expectation, state: LiveState = PRE_STATE): MarketProbs[] {
  const rem = remaining(exp, state);
  const th1 = poissonTable(rem.h1, MAX_GOALS), ta1 = poissonTable(rem.a1, MAX_GOALS);
  const th2 = poissonTable(rem.h2, MAX_GOALS), ta2 = poissonTable(rem.a2, MAX_GOALS);
  const tc1 = poissonTable(rem.c1, MAX_CORNERS), tc2 = poissonTable(rem.c2, MAX_CORNERS);

  type Acc = { win: Map<string, number>; voidMass: number };
  const accs = new Map<string, Acc>();
  const key = (m: MarketDef, line: number) => `${m.code}|${line}`;
  const goalMarkets: { m: MarketDef; line: number }[] = [];
  const cornerMarkets: { m: MarketDef; line: number }[] = [];
  const corner1hMarkets: { m: MarketDef; line: number }[] = [];
  const penMarkets: { m: MarketDef; line: number }[] = [];
  for (const m of MARKETS) {
    for (const line of m.lines) {
      accs.set(key(m, line), { win: new Map(), voidMass: 0 });
      const entry = { m, line };
      if (m.kind === "goals") goalMarkets.push(entry);
      else if (m.kind === "corners") cornerMarkets.push(entry);
      else if (m.kind === "corners1h") corner1hMarkets.push(entry);
      else penMarkets.push(entry);
    }
  }

  const add = (m: MarketDef, line: number, f: Facts, p: number) => {
    if (p <= 0) return;
    const acc = accs.get(key(m, line))!;
    const w = outcome(m.code, f, line);
    if (w === null || w === undefined) { acc.voidMass += p; return; }
    for (const s of w) acc.win.set(s, (acc.win.get(s) ?? 0) + p);
  };

  // Gol pazarları: 4 boyutlu ortak dağılım
  const f: Facts = { h1: 0, a1: 0, h2: 0, a2: 0, corners: 0, corners1h: 0, penalty: false };
  for (let i = 0; i < th1.length; i++) {
    const p1 = th1[i]; if (p1 < 1e-7) continue;
    for (let j = 0; j < ta1.length; j++) {
      const p2 = p1 * ta1[j]; if (p2 < 1e-7) continue;
      for (let k = 0; k < th2.length; k++) {
        const p3 = p2 * th2[k]; if (p3 < 1e-7) continue;
        for (let l = 0; l < ta2.length; l++) {
          const p = p3 * ta2[l]; if (p < 1e-8) continue;
          f.h1 = state.h1 + i; f.a1 = state.a1 + j; f.h2 = state.h2 + k; f.a2 = state.a2 + l;
          for (const gm of goalMarkets) add(gm.m, gm.line, f, p);
        }
      }
    }
  }

  // Korner: 1Y ve toplam
  const fc: Facts = { ...f, h1: 0, a1: 0, h2: 0, a2: 0 };
  for (let i = 0; i < tc1.length; i++) {
    const p1 = tc1[i]; if (p1 < 1e-7) continue;
    fc.corners1h = state.corners1h + i;
    for (const cm of corner1hMarkets) add(cm.m, cm.line, fc, p1);
    for (let j = 0; j < tc2.length; j++) {
      const p = p1 * tc2[j]; if (p < 1e-8) continue;
      fc.corners = state.corners + i + j;
      for (const cm of cornerMarkets) add(cm.m, cm.line, fc, p);
    }
  }

  // Penaltı
  for (const pm of penMarkets) {
    const pYes = state.penalty ? 1 : clamp(rem.pen, 0, 1);
    add(pm.m, pm.line, { ...fc, penalty: true }, pYes);
    add(pm.m, pm.line, { ...fc, penalty: false }, 1 - pYes);
  }

  const out: MarketProbs[] = [];
  for (const m of MARKETS) {
    for (const line of m.lines) {
      const acc = accs.get(key(m, line))!;
      const live = 1 - acc.voidMass;
      const probs = new Map<string, number>();
      let decided = false;
      if (live <= 1e-6) {
        decided = true;
      } else {
        for (const s of selectionsOf(m, line)) {
          const p = (acc.win.get(s) ?? 0) / live;
          probs.set(s, p);
          if (p >= 0.985) decided = true;
        }
      }
      out.push({ code: m.code, line, probs, decided });
    }
  }
  return out;
}

// ---------------------------------------------------------------------
// Oran satırları
// ---------------------------------------------------------------------
export interface OddRow {
  fixture_id: number;
  market: string;
  selection: string;
  line: number;
  odd: number;
  suspended: boolean;
  is_live: boolean;
  bookmaker: string;
  updated_at: string;
}

export const BOOKMAKER = "Macoran";
const MIN_ODD = 1.01;
const MAX_ODD = 150;
const MIN_PROB = 0.004;   // bunun altı sunulmaz
const MAX_PROB = 0.97;    // neredeyse kesin seçimler sunulmaz

export function priceOdds(
  fixtureId: number,
  probs: MarketProbs[],
  margin: number,
  isLive: boolean,
  suspended = false,
): OddRow[] {
  const now = new Date().toISOString();
  const rows: OddRow[] = [];
  for (const mp of probs) {
    if (mp.decided) continue;
    const def = MARKETS.find((m) => m.code === mp.code)!;
    const mul = def.marginMul ?? 1;
    const effMargin = margin * mul;
    const offered: [string, number][] = [];
    let fullSum = 0;
    for (const [sel, p] of mp.probs) {
      fullSum += p;
      if (p < MIN_PROB || p > MAX_PROB) continue;
      offered.push([sel, p]);
    }
    if (offered.length < 2) continue;
    // Sunulmayan (çok düşük olasılıklı) seçimlerin kütlesi kalanlara dağıtılır.
    // fullSum tek kazananlı pazarlarda 1, çifte şans gibi çok kazananlı pazarlarda >1'dir;
    // oranlar seçimin kendi olasılığına göre verilir.
    // Marj, olasılığa "kalan kütle" oranında eklenir: favoriye az, sürprize çok
    // (Σ implied = 1 + marj). Çok kazananlı pazarlar (çifte şans) 2 yollu sayılır.
    const multiWinner = fullSum > 1.2;
    const offeredSum = offered.reduce((a, [, p]) => a + p, 0);
    const scale = multiWinner || fullSum <= 0 ? 1 : fullSum / offeredSum;
    const spread = multiWinner ? 1 : Math.max(1, offered.length - 1);
    for (const [sel, p] of offered) {
      const fair = Math.min(0.995, p * scale);
      const implied = fair + effMargin * (1 - fair) / spread;
      const odd = clamp(Math.round((1 / implied) * 100) / 100, MIN_ODD, MAX_ODD);
      rows.push({
        fixture_id: fixtureId, market: mp.code, selection: sel, line: mp.line,
        odd, suspended, is_live: isLive, bookmaker: BOOKMAKER, updated_at: now,
      });
    }
  }
  return rows;
}
