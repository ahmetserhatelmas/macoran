// Fikstür üretimi (çift devreli lig usulü) ve puan durumu hesaplama.

import { Rng } from "./rng.ts";

/** Oran testi için sentetik lig; puan / krallık / forma yazılmaz. */
export const TEST_LEAGUE_ID = 99999;

export interface ScheduleConfig {
  /** ilk haftanın günü (ISO, UTC) */
  start_at: string;
  /** haftalar arası süre (saat) */
  round_interval_hours: number;
  /** yerel (TR) saat dilimine göre başlama saatleri, ör. ["14:00","17:00","20:00"] */
  kickoff_times: string[];
  /** iki devreli mi */
  double_round: boolean;
}

export interface ScheduledMatch {
  round: number;
  home: number;
  away: number;
  date: Date;
}

/** Berger (daire) yöntemiyle tek devre eşleşmeler */
export function singleRoundRobin(ids: number[], rng: Rng): [number, number][][] {
  const teams = rng.shuffle(ids);
  if (teams.length % 2 === 1) teams.push(-1); // bay
  const n = teams.length;
  const rounds: [number, number][][] = [];
  for (let r = 0; r < n - 1; r++) {
    const pairs: [number, number][] = [];
    for (let i = 0; i < n / 2; i++) {
      const a = teams[i];
      const b = teams[n - 1 - i];
      if (a === -1 || b === -1) continue;
      // ev/deplasman dengesi: sıra numarasına göre değiştir
      if (i === 0 ? r % 2 === 1 : (r + i) % 2 === 1) pairs.push([b, a]);
      else pairs.push([a, b]);
    }
    rounds.push(pairs);
    // döndür (ilk takım sabit)
    teams.splice(1, 0, teams.pop()!);
  }
  return rounds;
}

const TR_OFFSET_MIN = 3 * 60; // Türkiye UTC+3 (yaz/kış aynı)

export function buildSchedule(teamIds: number[], cfg: ScheduleConfig, seed: number): ScheduledMatch[] {
  const rng = new Rng(seed);
  const first = singleRoundRobin(teamIds, rng);
  const rounds = cfg.double_round ? [...first, ...first.map((r) => r.map(([h, a]) => [a, h] as [number, number]))] : first;

  const start = new Date(cfg.start_at);
  const times = (cfg.kickoff_times.length ? cfg.kickoff_times : ["20:00"]).map((t) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + (m || 0);
  }).sort((a, b) => a - b);

  const out: ScheduledMatch[] = [];
  rounds.forEach((pairs, ri) => {
    const day = new Date(start.getTime() + ri * cfg.round_interval_hours * 3600_000);
    // Günden kısa aralıklarla (hızlı sezon / test) haftanın tüm maçları aynı anda başlar
    if (cfg.round_interval_hours < 24) {
      for (const [home, away] of rng.shuffle(pairs)) out.push({ round: ri + 1, home, away, date: day });
      return;
    }
    // hafta günü (UTC gün başlangıcı, TR'ye göre)
    const trMidnight = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()) - TR_OFFSET_MIN * 60_000;
    // İlk hafta: başlangıç saatinden önceki saatleri kullanma
    const shuffled = rng.shuffle(pairs);
    shuffled.forEach(([home, away], i) => {
      let slot = times[i % times.length];
      let date = new Date(trMidnight + slot * 60_000);
      // Haftanın ilk günü başlangıçtan önce kalırsa bir sonraki güne/saate kaydır
      if (ri === 0 && date.getTime() < start.getTime()) {
        const later = times.find((t) => trMidnight + t * 60_000 >= start.getTime());
        if (later !== undefined) { slot = later; date = new Date(trMidnight + slot * 60_000); }
        else date = new Date(trMidnight + 24 * 3600_000 + times[i % times.length] * 60_000);
      }
      out.push({ round: ri + 1, home, away, date });
    });
  });
  return out;
}

// ---------------------------------------------------------------------
// Puan durumu (API-Football şekliyle uyumlu)
// ---------------------------------------------------------------------
export interface TeamInfo { id: number; name: string; logo: string | null }
export interface ResultRow { home_team_id: number; away_team_id: number; home: number; away: number; date: string }

export interface StandingRow {
  rank: number;
  team: { id: number; name: string; logo: string };
  points: number;
  goalsDiff: number;
  group: string;
  form: string | null;
  status: string;
  description: string | null;
  all: { played: number; win: number; draw: number; lose: number; goals: { for: number; against: number } };
  home: { played: number; win: number; draw: number; lose: number; goals: { for: number; against: number } };
  away: { played: number; win: number; draw: number; lose: number; goals: { for: number; against: number } };
  update: string;
}

const blank = () => ({ played: 0, win: 0, draw: 0, lose: 0, goals: { for: 0, against: 0 } });

export function computeStandings(teams: TeamInfo[], results: ResultRow[], groupName: string): StandingRow[] {
  const rows = new Map<number, StandingRow>();
  for (const t of teams) {
    rows.set(t.id, {
      rank: 0, team: { id: t.id, name: t.name, logo: t.logo ?? "" }, points: 0, goalsDiff: 0, group: groupName,
      form: "", status: "same", description: null, all: blank(), home: blank(), away: blank(), update: new Date().toISOString(),
    });
  }
  const sorted = results.slice().sort((a, b) => a.date.localeCompare(b.date));
  const formMap = new Map<number, string[]>();
  const apply = (r: StandingRow, gf: number, ga: number, side: "home" | "away") => {
    const s = r[side];
    s.played++; r.all.played++;
    s.goals.for += gf; s.goals.against += ga; r.all.goals.for += gf; r.all.goals.against += ga;
    let ch = "D";
    if (gf > ga) { s.win++; r.all.win++; r.points += 3; ch = "W"; }
    else if (gf < ga) { s.lose++; r.all.lose++; ch = "L"; }
    else { s.draw++; r.all.draw++; r.points += 1; }
    r.goalsDiff = r.all.goals.for - r.all.goals.against;
    const f = formMap.get(r.team.id) ?? [];
    f.push(ch);
    formMap.set(r.team.id, f);
  };
  for (const m of sorted) {
    const h = rows.get(m.home_team_id), a = rows.get(m.away_team_id);
    if (!h || !a) continue;
    apply(h, m.home, m.away, "home");
    apply(a, m.away, m.home, "away");
  }
  const list = [...rows.values()];
  for (const r of list) r.form = (formMap.get(r.team.id) ?? []).slice(-5).join("") || null;
  list.sort((x, y) => y.points - x.points || y.goalsDiff - x.goalsDiff || y.all.goals.for - x.all.goals.for || x.team.name.localeCompare(y.team.name));
  list.forEach((r, i) => { r.rank = i + 1; });
  return list;
}
