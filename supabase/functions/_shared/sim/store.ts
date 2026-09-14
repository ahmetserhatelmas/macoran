// Simülasyon için DB yardımcıları (tick ve admin tarafından ortak kullanılır)

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
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
): Expectation {
  const h = effectiveStrength(ratings.get(homeId) ?? DEFAULT_RATING(homeId), rounds);
  const a = effectiveStrength(ratings.get(awayId) ?? DEFAULT_RATING(awayId), rounds);
  return expectation(h, a);
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
