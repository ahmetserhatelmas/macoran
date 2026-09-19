// Simülasyon için DB yardımcıları (tick ve admin tarafından ortak kullanılır)

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { earlySettleSelection, type Facts, type MatchPhase } from "./markets.ts";
import { effectiveStrength, expectation, type Expectation, type OddRow, type RatingRow } from "./model.ts";
import type { PlayerRow } from "./script.ts";

export interface SimSettings {
  seconds_per_minute: number;
  halftime_seconds: number;
  goal_suspend_seconds: number;
  margin: number;
  live_margin: number;
}

export async function loadSettings(db: SupabaseClient): Promise<SimSettings> {
  const { data, error } = await db.from("sim_settings").select("*").eq("id", 1).single();
  if (error) throw error;
  return {
    seconds_per_minute: Number(data.seconds_per_minute),
    halftime_seconds: Number(data.halftime_seconds),
    goal_suspend_seconds: Number(data.goal_suspend_seconds),
    margin: Number(data.margin),
    live_margin: Number(data.live_margin),
  };
}

export async function loadRatings(db: SupabaseClient, teamIds: number[]): Promise<Map<number, RatingRow>> {
  if (!teamIds.length) return new Map();
  const { data, error } = await db.from("team_ratings").select("*").in("team_id", teamIds);
  if (error) throw error;
  const m = new Map<number, RatingRow>();
  for (const r of data ?? []) {
    m.set(r.team_id, {
      team_id: r.team_id,
      attack: Number(r.attack), midfield: Number(r.midfield), defense: Number(r.defense), goalkeeper: Number(r.goalkeeper),
      sim_played: r.sim_played, sim_points: r.sim_points, sim_gf: r.sim_gf, sim_ga: r.sim_ga, sim_form: r.sim_form ?? "",
    });
  }
  return m;
}

export const DEFAULT_RATING = (teamId: number): RatingRow => ({
  team_id: teamId, attack: 62, midfield: 62, defense: 62, goalkeeper: 62, sim_played: 0, sim_points: 0, sim_gf: 0, sim_ga: 0, sim_form: "",
});

export async function loadPlayers(db: SupabaseClient, teamIds: number[]): Promise<Map<number, PlayerRow[]>> {
  const m = new Map<number, PlayerRow[]>();
  if (!teamIds.length) return m;
  const { data, error } = await db.from("players").select("*").in("team_id", teamIds);
  if (error) throw error;
  for (const p of data ?? []) {
    const row: PlayerRow = {
      id: Number(p.id), team_id: p.team_id, name: p.name, number: p.number, position: p.position,
      photo: p.photo ?? null, api_id: p.api_id ?? null,
      talent: Number(p.talent), finishing: Number(p.finishing), creativity: Number(p.creativity), aggression: Number(p.aggression),
      injured_until: p.injured_until, suspended_matches: p.suspended_matches,
    };
    if (!m.has(row.team_id)) m.set(row.team_id, []);
    m.get(row.team_id)!.push(row);
  }
  return m;
}

export interface LeagueSim {
  id: number;
  name: string;
  season: number;
  sim_started_at: string | null;
  sim_config: { rounds?: number; [k: string]: unknown } | null;
  odds_dirty_at: string | null;
}

export async function loadLeagues(db: SupabaseClient): Promise<Map<number, LeagueSim>> {
  const { data, error } = await db.from("leagues").select("id, name, season, sim_started_at, sim_config, odds_dirty_at");
  if (error) throw error;
  return new Map((data ?? []).map((l) => [l.id as number, l as LeagueSim]));
}

export function totalRounds(league: LeagueSim | undefined): number {
  return Number(league?.sim_config?.rounds ?? 34);
}

export function fixtureExpectation(
  ratings: Map<number, RatingRow>,
  homeId: number,
  awayId: number,
  rounds: number,
  leagueId?: number,
): Expectation {
  const h = effectiveStrength(ratings.get(homeId) ?? DEFAULT_RATING(homeId), rounds);
  const a = effectiveStrength(ratings.get(awayId) ?? DEFAULT_RATING(awayId), rounds);
  return expectation(h, a, leagueId);
}

/** Oran satırlarını fikstür bazında tek çağrıda değiştir (upsert + listede olmayanları sil) */
export async function replaceOdds(db: SupabaseClient, fixtureId: number, rows: OddRow[]) {
  const payload = rows.map(({ market, selection, line, odd, suspended, is_live, bookmaker, updated_at }) =>
    ({ market, selection, line, odd, suspended, is_live, bookmaker, updated_at }));
  const { error } = await db.rpc("replace_fixture_odds", { p_fixture_id: fixtureId, p_rows: payload });
  if (error) throw new Error(`replace_fixture_odds: ${error.message}`);
}

/** Bir tick'i başlatmaya çalış; başka bir tick hâlâ çalışıyorsa false */
export async function acquireTickLock(db: SupabaseClient, ttlSeconds = 90): Promise<boolean> {
  const { data, error } = await db.rpc("sim_tick_lock", { p_ttl_seconds: ttlSeconds });
  if (error) throw new Error(`sim_tick_lock: ${error.message}`);
  return data === true;
}

export async function releaseTickLock(db: SupabaseClient) {
  await db.rpc("sim_tick_unlock");
}

/** Sınırlı eşzamanlılıkla map */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

export async function deleteOdds(db: SupabaseClient, fixtureId: number) {
  const { error } = await db.from("odds").delete().eq("fixture_id", fixtureId);
  if (error) throw error;
}

/** Gol/penaltı anında bahsi skor görünmeden kilitle (oran askı + live_odds_at null). */
export async function lockLiveBetting(
  db: SupabaseClient,
  fixtureId: number,
  until: Date,
  now: Date,
) {
  const iso = now.toISOString();
  await Promise.all([
    db.from("fixtures").update({ live_odds_at: null, updated_at: iso }).eq("id", fixtureId),
    db.from("sim_matches").update({ suspended_until: until.toISOString() }).eq("fixture_id", fixtureId),
    db.from("odds").update({ suspended: true, updated_at: iso }).eq("fixture_id", fixtureId).eq("suspended", false),
  ]);
}

/** Kesinleşen canlı bahisleri maç bitmeden sonuçlandırır (kupon kaybı/kazancı settle_bet ile). */
export async function settleLiveDecided(
  db: SupabaseClient,
  fixtureId: number,
  facts: Facts,
  phase: MatchPhase,
  home: number,
  away: number,
): Promise<number> {
  const { data: sels, error } = await db.from("bet_selections")
    .select("id, bet_id, market, selection, line")
    .eq("fixture_id", fixtureId)
    .eq("status", "pending");
  if (error) throw error;
  if (!sels?.length) return 0;

  const decided: { id: string; bet_id: string; status: "won" | "lost" | "void" }[] = [];
  for (const s of sels) {
    const status = earlySettleSelection(s.market, s.selection, Number(s.line), facts, phase);
    if (status) decided.push({ id: s.id as string, bet_id: s.bet_id as string, status });
  }
  if (!decided.length) return 0;

  await Promise.all(decided.map((d) =>
    db.from("bet_selections").update({
      status: d.status, result_home: home, result_away: away,
    }).eq("id", d.id).eq("status", "pending"),
  ));

  const bets = [...new Set(decided.map((d) => d.bet_id))];
  for (const id of bets) {
    const { error: se } = await db.rpc("settle_bet", { p_bet_id: id });
    if (se) throw se;
  }
  return decided.length;
}
