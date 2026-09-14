// Admin simülasyon işlemleri (admin JWT ile çağrılır)
//  action: start_league | stop_league | set_scenario | clear_scenario | update_settings
//          | import_squads | init_ratings | set_rating | status
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { ApiFootball, fetchSeasonFixtures } from "../_shared/api.ts";
import { adminClient, apiKey, authorize, errMsg, json, log, upsertChunked } from "../_shared/db.ts";
import { planFromApiFixtures, planFromRhythm, teamsFromFixtures, type CalendarResult } from "../_shared/sim/calendar.ts";
import { buildSchedule, computeStandings, type ScheduleConfig, type TeamInfo } from "../_shared/sim/league.ts";
import { hashSeed } from "../_shared/sim/rng.ts";
import type { Scenario } from "../_shared/sim/script.ts";
import {
  type ApiStandingRowLite, buildPlayersFromApi, buildSyntheticPlayers, fetchSquad, ratingsFromStandings,
} from "../_shared/sim/squads.ts";

const SECOND_TIER = new Set([204, 40, 79, 141, 136, 62]);
/** Avrupa kupaları: takımın "ana ligi" sayılmaz, güç puanlarını ezmez */
const CUPS = new Set([2, 3, 848]);
const SIM_ID_BASE = 900000000;

Deno.serve(async (req) => {
  const db = adminClient();
  if (!(await authorize(req, db))) return json({ error: "unauthorized" }, 401);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* boş */ }
  const action = String(body.action ?? "status");

  try {
    switch (action) {
      case "status": return json(await status(db));
      case "start_league": return json(await startLeague(db, body));
      case "start_leagues": return json(await startLeagues(db, body));
      case "stop_league": return json(await stopLeague(db, Number(body.league_id)));
      case "set_scenario": return json(await setScenario(db, body));
      case "clear_scenario": {
        await db.from("sim_matches").update({ scenario: null }).eq("fixture_id", Number(body.fixture_id));
        return json({ ok: true });
      }
      case "update_settings": return json(await updateSettings(db, body));
      case "import_squads": return json(await importSquads(db, body.league_id ? Number(body.league_id) : null, !!body.force));
      case "init_ratings": return json(await initRatings(db, Number(body.league_id), !!body.overwrite));
      case "set_rating": return json(await setRating(db, body));
      default: return json({ error: `unknown action: ${action}` }, 400);
    }
  } catch (e) {
    const msg = errMsg(e);
    await log(db, "sim-admin", false, `${action}: ${msg}`, 0);
    return json({ ok: false, error: msg }, 500);
  }
});

// ---------------------------------------------------------------------
async function status(db: SupabaseClient) {
  const [lRes, sRes] = await Promise.all([
    db.rpc("sim_league_status"),
    db.from("sim_settings").select("*").eq("id", 1).single(),
  ]);
  if (lRes.error) throw lRes.error;
  const out = (lRes.data ?? []).map((l: Record<string, unknown>) => ({
    ...l, teams: Number(l.teams), players: Number(l.players), upcoming: Number(l.upcoming), played: Number(l.played),
  }));
  return { ok: true, settings: sRes.data, leagues: out };
}

// ---------------------------------------------------------------------
interface StandingGroup { rank: number; team: { id: number; name: string; logo: string }; points: number; all: { played: number; goals: { for: number; against: number } } }

/** Ligin güncel API-Football puan tablosu (simülasyon başlamamış ligler için takım listesi + güç kaynağı). */
async function fetchApiStandings(leagueId: number, season: number): Promise<StandingGroup[][]> {
  const key = apiKey();
  if (!key) return [];
  try {
    const api = new ApiFootball(key);
    const res = await api.get<{ league: { standings: StandingGroup[][] } }>("/standings", { league: leagueId, season });
    return (res.response[0]?.league?.standings ?? []).filter((g) => Array.isArray(g) && g.length);
  } catch (e) {
    console.warn(`standings ${leagueId}: ${errMsg(e)}`);
    return [];
  }
}

async function leagueTeams(db: SupabaseClient, leagueId: number): Promise<{ teams: TeamInfo[]; groups: StandingGroup[][] }> {
  const [{ data: st }, { data: league }, { data: lt }] = await Promise.all([
    db.from("standings").select("data").eq("league_id", leagueId).maybeSingle(),
    db.from("leagues").select("season, sim_started_at").eq("id", leagueId).single(),
    db.from("league_teams").select("team_id, teams(id, name, logo)").eq("league_id", leagueId),
  ]);
  let groups = ((st?.data ?? []) as StandingGroup[][]).filter((g) => Array.isArray(g) && g.length);
  // Simülasyon başlamamış ve tablo yoksa: gerçek tablo API'den (1 istek)
  if (!groups.length && !league?.sim_started_at) groups = await fetchApiStandings(leagueId, Number(league?.season ?? new Date().getFullYear()));
  const fromStandings: TeamInfo[] = groups.flat().map((r) => ({ id: r.team.id, name: r.team.name, logo: r.team.logo ?? null }));

  const existing: TeamInfo[] = (lt ?? []).map((r) => {
    const t = r.teams as unknown as TeamInfo;
    return { id: t.id, name: t.name, logo: t.logo };
  });

  let teams = existing.length ? existing : fromStandings;
  if (!teams.length) {
    // Son çare: fikstürdeki takımlar
    const { data: fx } = await db.from("fixtures").select("home_team_id, away_team_id").eq("league_id", leagueId);
    const ids = [...new Set((fx ?? []).flatMap((f) => [f.home_team_id as number, f.away_team_id as number]))];
    const { data: ts } = await db.from("teams").select("id, name, logo").in("id", ids);
    teams = (ts ?? []) as TeamInfo[];
  }
  if (!teams.length) throw new Error("Bu lig için takım bulunamadı (puan durumu / fikstür yok)");
  // Çok gruplu liglerde (Apertura/Clausura vb.) aynı takım birden fazla kez gelebilir
  teams = [...new Map(teams.map((t) => [t.id, t])).values()];

  // Takımlar tabloda yoksa (puan durumundan geldiyse) ekle
  await upsertChunked(db, "teams", teams.map((t) => ({ id: t.id, name: t.name, logo: t.logo })), "id");
  await upsertChunked(db, "league_teams", teams.map((t) => ({ league_id: leagueId, team_id: t.id })), "league_id,team_id");
  return { teams, groups };
}

const toLite = (g: StandingGroup[]): ApiStandingRowLite[] => g.map((r) => ({ rank: r.rank, team: { id: r.team.id }, points: r.points, all: r.all }));

/** Geçen sezonun final tablosu (API-Football, lig başına 1 istek). Kupalarda ve hata durumunda boş. */
async function previousSeasonTable(leagueId: number, season: number): Promise<ApiStandingRowLite[] | undefined> {
  if (CUPS.has(leagueId)) return undefined;
  const key = apiKey();
  if (!key) return undefined;
  try {
    const api = new ApiFootball(key);
    const res = await api.get<{ league: { standings: StandingGroup[][] } }>("/standings", { league: leagueId, season: season - 1 });
    const groups = res.response[0]?.league?.standings ?? [];
    const rows = toLite(groups.flat());
    // Çok gruplu ligde aynı takım birden fazla kez gelebilir: ilk kaydı tut
    return [...new Map(rows.map((r) => [r.team.id, r])).values()];
  } catch (e) {
    console.warn(`prev standings ${leagueId}: ${errMsg(e)}`);
    return undefined;
  }
}

async function initRatings(db: SupabaseClient, leagueId: number, overwrite: boolean) {
  const [{ teams, groups }, leagueRes] = await Promise.all([
    leagueTeams(db, leagueId),
    db.from("leagues").select("season").eq("id", leagueId).single(),
  ]);
  const { data: existing } = await db.from("team_ratings").select("team_id, source, league_id").in("team_id", teams.map((t) => t.id));
  const have = new Map((existing ?? []).map((r) => [r.team_id as number, r.source as string]));
  const tier = SECOND_TIER.has(leagueId) ? 2 : 1;
  const isCup = CUPS.has(leagueId);
  const season = Number(leagueRes.data?.season ?? new Date().getFullYear());

  // Kupalarda (UCL vb.) mevcut güçler korunur: takımların gücü kendi liglerinden gelir
  const rows: Record<string, unknown>[] = [];
  const missingRatings = teams.filter((t) => !have.has(t.id));
  if ((!isCup || overwrite) && (overwrite || missingRatings.length)) {
    const prev = groups.length ? await previousSeasonTable(leagueId, season) : undefined;
    // Puan durumu yoksa herkes orta sıra (eşit güç); admin panelinden elle ayarlanabilir
    const mid = Math.ceil(teams.length / 2);
    const src: StandingGroup[][] = groups.length ? groups : [teams.map((t) => ({ rank: mid, team: { id: t.id, name: t.name, logo: t.logo ?? "" }, points: 0, all: { played: 0, goals: { for: 0, against: 0 } } }))];
    for (const g of src) {
      for (const r of ratingsFromStandings(leagueId, toLite(g), tier, prev)) {
        const s = have.get(r.team_id);
        if (s && !overwrite) continue;
        if (s === "manual" && !overwrite) continue;
        if (rows.some((x) => x.team_id === r.team_id)) continue; // çok gruplu lig: ilk grup geçerli
        rows.push({ ...r, updated_at: new Date().toISOString() });
      }
    }
    if (rows.length) await upsertChunked(db, "team_ratings", rows, "team_id");
  }
  // Güç kaydı olmayan takımlar (kupada gelen, ligi bizde olmayan takımlar) varsayılan güçle eklenir
  const missing = teams.filter((t) => !have.has(t.id) && !rows.some((x) => x.team_id === t.id));
  if (missing.length) {
    await upsertChunked(db, "team_ratings", missing.map((t) => ({ team_id: t.id, league_id: leagueId, source: "default" })), "team_id");
  }
  // Ana lig üyeliği (kupalar ezmez)
  if (!isCup) await db.from("team_ratings").update({ league_id: leagueId }).in("team_id", teams.map((t) => t.id));
  return { ok: true, teams: teams.length, rated: rows.length, defaulted: missing.length };
}

async function importSquads(db: SupabaseClient, leagueId: number | null, force: boolean, budgetMs = 110_000) {
  let teamIds: number[];
  if (leagueId) {
    const { teams } = await leagueTeams(db, leagueId);
    teamIds = teams.map((t) => t.id);
  } else {
    const { data } = await db.from("league_teams").select("team_id");
    teamIds = [...new Set((data ?? []).map((r) => r.team_id as number))];
  }
  const { data: have } = await db.from("players").select("team_id").in("team_id", teamIds);
  const haveSet = new Set((have ?? []).map((r) => r.team_id as number));
  const todo = force ? teamIds : teamIds.filter((id) => !haveSet.has(id));
  if (!todo.length) return { ok: true, imported: 0, synthetic: 0, skipped: teamIds.length };

  const { data: ratings } = await db.from("team_ratings").select("team_id, attack, midfield, defense, goalkeeper").in("team_id", todo);
  const overall = new Map((ratings ?? []).map((r) => [r.team_id as number, (Number(r.attack) + Number(r.midfield) + Number(r.defense) + Number(r.goalkeeper)) / 4]));

  const key = apiKey();
  const api = key ? new ApiFootball(key) : null;
  let imported = 0, synthetic = 0;
  const started = Date.now();
  for (const teamId of todo) {
    const overtime = Date.now() - started > budgetMs;
    const ov = overall.get(teamId) ?? 62;
    let rows = null;
    if (api && !overtime) {
      try {
        const squad = await fetchSquad(api, teamId);
        if (squad && squad.length >= 11) rows = buildPlayersFromApi(teamId, ov, squad);
      } catch (e) {
        console.warn(`squad ${teamId}: ${errMsg(e)}`);
      }
    }
    if (!rows) { rows = buildSyntheticPlayers(teamId, ov); synthetic++; } else imported++;
    if (force) await db.from("players").delete().eq("team_id", teamId);
    await upsertChunked(db, "players", rows as unknown as Record<string, unknown>[]);
  }
  await log(db, "sim-admin", true, `kadro: API ${imported}, sentetik ${synthetic}`, api?.requests ?? 0);
  return { ok: true, imported, synthetic, remaining: todo.length - imported - synthetic, requests: api?.requests ?? 0 };
}

// ---------------------------------------------------------------------
async function archiveLeagueFixtures(db: SupabaseClient, leagueId: number) {
  const { data: fx } = await db.from("fixtures").select("id, status_short").eq("league_id", leagueId).eq("archived", false);
  const ids = (fx ?? []).map((f) => f.id as number);
  if (!ids.length) return 0;
  await db.rpc("void_fixture_bets", { p_fixture_ids: ids });
  const unfinished = (fx ?? []).filter((f) => !["FT", "AET", "PEN"].includes(f.status_short)).map((f) => f.id as number);
  for (let i = 0; i < unfinished.length; i += 200) {
    await db.from("fixtures").update({ status_short: "CANC", status_long: "Cancelled", settled: true, archived: true, live_odds_at: null }).in("id", unfinished.slice(i, i + 200));
  }
  for (let i = 0; i < ids.length; i += 200) {
    const part = ids.slice(i, i + 200);
    await db.from("fixtures").update({ archived: true, settled: true }).in("id", part);
    await db.from("odds").delete().in("fixture_id", part);
    await db.from("sim_matches").delete().in("fixture_id", part);
  }
  return ids.length;
}

/** Başlamamış ligleri aynı fikstür ayarıyla sırayla başlatır (Edge süre sınırı ~150 sn). */
async function startLeagues(db: SupabaseClient, body: Record<string, unknown>) {
  const { data: all, error } = await db.from("leagues").select("id, name, sim_started_at").order("sort_order");
  if (error) throw error;
  const wanted = Array.isArray(body.league_ids) && body.league_ids.length
    ? new Set((body.league_ids as unknown[]).map(Number))
    : null;
  const pool = (all ?? []).filter((l) => !wanted || wanted.has(l.id));
  const todo = pool.filter((l) => !l.sim_started_at);
  const skipped = pool.filter((l) => l.sim_started_at).map((l) => ({ id: l.id, name: l.name, reason: "zaten aktif" }));
  const started: Record<string, unknown>[] = [];
  const failed: { id: number; name: string; error: string }[] = [];

  const t0 = Date.now();
  const WALL = 135_000;
  for (let i = 0; i < todo.length; i++) {
    const l = todo[i];
    if (Date.now() - t0 > WALL) {
      for (const rest of todo.slice(i)) failed.push({ id: rest.id, name: rest.name, error: "süre doldu" });
      break;
    }
    try {
      // Kadrolar sentetik/mevcut: 30 ligi bir çağrıda bitirmek için API'ye takılmıyoruz
      const r = await startLeague(db, { ...body, league_id: l.id, squad_budget_ms: 0 });
      started.push({ id: l.id, name: l.name, teams: r.teams, fixtures: r.fixtures, rounds: r.rounds });
    } catch (e) {
      failed.push({ id: l.id, name: l.name, error: errMsg(e) });
    }
  }

  const msg = `hepsi: ${started.length} başladı, ${skipped.length} atlandı, ${failed.length} hata`;
  await log(db, "sim-admin", failed.length === 0, msg, 0);
  return { ok: failed.length === 0, started, skipped, failed };
}

async function startLeague(db: SupabaseClient, body: Record<string, unknown>) {
  const leagueId = Number(body.league_id);
  if (!leagueId) throw new Error("league_id gerekli");
  const { data: league, error } = await db.from("leagues").select("*").eq("id", leagueId).single();
  if (error) throw error;

  const cfg: ScheduleConfig = {
    start_at: typeof body.start_at === "string" && body.start_at ? new Date(body.start_at).toISOString() : new Date(Date.now() + 10 * 60_000).toISOString(),
    round_interval_hours: Math.max(1, Number(body.round_interval_hours ?? 24)),
    kickoff_times: Array.isArray(body.kickoff_times) && body.kickoff_times.length ? (body.kickoff_times as string[]) : ["14:00", "17:00", "20:00"],
    double_round: body.double_round === undefined ? true : !!body.double_round,
  };
  const realCalendar = body.use_real_calendar !== false;
  const startAt = new Date(cfg.start_at);
  const seed = hashSeed("schedule", leagueId, cfg.start_at);

  // 1) Takımlar ve güçler (API dönemi puan durumu arşivlenmeden önce!)
  const { teams } = await leagueTeams(db, leagueId);

  let apiFixtures = 0;
  let calendar: CalendarResult | null = null;
  if (realCalendar) {
    const key = apiKey();
    if (key) {
      try {
        const api = new ApiFootball(key);
        const fx = await fetchSeasonFixtures(api, leagueId, Number(league.season));
        apiFixtures = fx.length;
        const extra = teamsFromFixtures(fx).filter((t) => !teams.some((x) => x.id === t.id));
        if (extra.length) {
          await upsertChunked(db, "teams", extra.map((t) => ({ id: t.id, name: t.name, logo: t.logo })), "id");
          await upsertChunked(db, "league_teams", extra.map((t) => ({ league_id: leagueId, team_id: t.id })), "league_id,team_id");
          teams.push(...extra);
        }
        calendar = planFromApiFixtures(fx, teams.map((t) => t.id), leagueId, startAt, seed);
      } catch (e) {
        console.warn(`fixtures ${leagueId}: ${errMsg(e)}`);
      }
    }
  }

  await initRatings(db, leagueId, false);
  await db.from("team_ratings").update({ sim_played: 0, sim_points: 0, sim_gf: 0, sim_ga: 0, sim_form: "" }).in("team_id", teams.map((t) => t.id));

  // 2) Kadrolar (süre bütçesi dolunca kalan takımlar sentetik kadro alır)
  const squads = await importSquads(db, leagueId, false, Number(body.squad_budget_ms ?? 110_000));

  // 3) Eski fikstürler (API ya da önceki simülasyon) arşive
  const archived = await archiveLeagueFixtures(db, leagueId);
  await db.from("player_stats").delete().eq("league_id", leagueId);

  // 4) Yeni fikstür: gerçek sezon (varsayılan) veya hızlı test takvimi
  if (!calendar) {
    if (realCalendar || cfg.round_interval_hours >= 24) {
      calendar = planFromRhythm(teams.map((t) => t.id), leagueId, cfg, seed);
    } else {
      const raw = buildSchedule(teams.map((t) => t.id), cfg, seed);
      calendar = {
        matches: raw.map((m) => ({ ...m, roundLabel: `${m.round}. Hafta` })),
        source: "rhythm",
        estimated: raw.length,
      };
    }
  }
  if (!calendar.matches.length) throw new Error("Fikstür üretilemedi");

  const { data: maxRow } = await db.from("fixtures").select("id").gte("id", SIM_ID_BASE).order("id", { ascending: false }).limit(1);
  let nextId = Math.max(SIM_ID_BASE, Number(maxRow?.[0]?.id ?? SIM_ID_BASE)) + 1;
  const rows = calendar.matches.map((m) => ({
    id: nextId++,
    league_id: leagueId,
    season: league.season,
    round: m.roundLabel,
    date: m.date.toISOString(),
    status_short: "NS",
    status_long: "Not Started",
    elapsed: null,
    home_team_id: m.home,
    away_team_id: m.away,
    venue: m.venue ?? null,
    is_sim: true,
    archived: false,
    settled: false,
    updated_at: new Date().toISOString(),
  }));
  await upsertChunked(db, "fixtures", rows, "id");

  const rounds = Math.max(0, ...calendar.matches.map((m) => m.round));
  await db.from("leagues").update({
    sim_started_at: new Date().toISOString(),
    sim_config: { ...cfg, rounds, calendar: calendar.source, estimated: calendar.estimated, api_fixtures: apiFixtures },
    odds_dirty_at: null,
  }).eq("id", leagueId);

  // 5) Boş puan durumu
  await db.from("standings").upsert({
    league_id: leagueId, season: league.season, data: [computeStandings(teams, [], league.name)], updated_at: new Date().toISOString(),
  }, { onConflict: "league_id" });

  await log(db, "sim-admin", true, `${league.name} başlatıldı: ${teams.length} takım, ${rows.length} maç, ${rounds} hafta (${calendar.source})`, apiFixtures ? 1 : 0);
  return {
    ok: true, teams: teams.length, fixtures: rows.length, rounds, archived, squads,
    config: cfg, calendar: calendar.source, estimated: calendar.estimated,
  };
}

async function stopLeague(db: SupabaseClient, leagueId: number) {
  if (!leagueId) throw new Error("league_id gerekli");
  const archived = await archiveLeagueFixtures(db, leagueId);
  await db.from("leagues").update({ sim_started_at: null, odds_dirty_at: null }).eq("id", leagueId);
  return { ok: true, archived };
}

// ---------------------------------------------------------------------
async function setScenario(db: SupabaseClient, body: Record<string, unknown>) {
  const fixtureId = Number(body.fixture_id);
  const sc: Scenario = {
    ht_home: Math.max(0, Math.min(9, Number(body.ht_home ?? 0))),
    ht_away: Math.max(0, Math.min(9, Number(body.ht_away ?? 0))),
    ft_home: Math.max(0, Math.min(12, Number(body.ft_home ?? 0))),
    ft_away: Math.max(0, Math.min(12, Number(body.ft_away ?? 0))),
    note: typeof body.note === "string" ? body.note.slice(0, 200) : undefined,
  };
  if (sc.ft_home < sc.ht_home || sc.ft_away < sc.ht_away) throw new Error("Maç sonu skoru ilk yarı skorundan küçük olamaz");
  const { data: f, error } = await db.from("fixtures").select("id, status_short, is_sim, date").eq("id", fixtureId).single();
  if (error) throw error;
  if (!f.is_sim || f.status_short !== "NS") throw new Error("Senaryo sadece başlamamış simülasyon maçlarına yazılabilir");

  const { data: existing } = await db.from("sim_matches").select("seed").eq("fixture_id", fixtureId).maybeSingle();
  const seed = existing?.seed ? Number(existing.seed) : hashSeed("match", fixtureId, f.date);
  const { error: upErr } = await db.from("sim_matches").upsert({ fixture_id: fixtureId, seed, scenario: sc }, { onConflict: "fixture_id" });
  if (upErr) throw upErr;
  return { ok: true, scenario: sc };
}

async function updateSettings(db: SupabaseClient, body: Record<string, unknown>) {
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  const num = (k: string, lo: number, hi: number) => {
    if (body[k] === undefined || body[k] === null || body[k] === "") return;
    const v = Number(body[k]);
    if (!Number.isFinite(v)) throw new Error(`${k} sayı olmalı`);
    patch[k] = Math.min(hi, Math.max(lo, v));
  };
  num("seconds_per_minute", 1, 600);
  num("halftime_seconds", 0, 3600);
  num("goal_suspend_seconds", 5, 300);
  num("margin", 0, 0.5);
  num("live_margin", 0, 0.5);
  const { data, error } = await db.from("sim_settings").update(patch).eq("id", 1).select("*").single();
  if (error) throw error;
  return { ok: true, settings: data };
}

async function setRating(db: SupabaseClient, body: Record<string, unknown>) {
  const teamId = Number(body.team_id);
  if (!teamId) throw new Error("team_id gerekli");
  const c = (v: unknown) => Math.min(99, Math.max(30, Number(v)));
  const patch: Record<string, unknown> = { source: "manual", updated_at: new Date().toISOString() };
  for (const k of ["attack", "midfield", "defense", "goalkeeper"]) if (body[k] !== undefined) patch[k] = c(body[k]);
  const { data, error } = await db.from("team_ratings").upsert({ team_id: teamId, ...patch }, { onConflict: "team_id" }).select("*").single();
  if (error) throw error;
  if (data.league_id) await db.from("leagues").update({ odds_dirty_at: new Date().toISOString() }).eq("id", data.league_id);
  return { ok: true, rating: data };
}
