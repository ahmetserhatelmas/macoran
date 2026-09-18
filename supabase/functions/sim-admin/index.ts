// Admin simülasyon işlemleri (admin JWT ile çağrılır)
//  action: start_league | start_leagues | stop_league | stop_leagues | set_scenario | clear_scenario | update_settings
//          | import_squads | init_ratings | set_rating | status | start_test_matches | stop_test_matches | set_live_score
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { ApiFootball, fetchSeasonFixtures } from "../_shared/api.ts";
import { adminClient, apiKey, authorize, errMsg, json, log, upsertChunked } from "../_shared/db.ts";
import { planFromApiFixtures, planFromRhythm, teamsFromFixtures, isCupLeague, isUefaClubCup, filterCupMainFixtures, resolveTeamClashes, type CalendarResult } from "../_shared/sim/calendar.ts";
import { buildSchedule, computeStandings, TEST_LEAGUE_ID, type ScheduleConfig, type TeamInfo } from "../_shared/sim/league.ts";
import { matchClock } from "../_shared/sim/clock.ts";
import { computeProbabilities, type LiveState, PRE_STATE, priceOdds } from "../_shared/sim/model.ts";
import { hashSeed, Rng } from "../_shared/sim/rng.ts";
import { writeDetails } from "../_shared/sim/details.ts";
import { dropAdminGoal, elapsedToKey, generateScript, injectLiveGoals, rewriteRemainingScore, snapshot, type Scenario, type ScenarioGoal, type Script } from "../_shared/sim/script.ts";
import { fixtureExpectation, loadLeagues, loadPlayers, loadRatings, loadSettings, lockLiveBetting, mapLimit, replaceOdds, settleLiveDecided, totalRounds } from "../_shared/sim/store.ts";
import {
  type ApiStandingRowLite, buildPlayersFromApi, buildSyntheticPlayers, fetchRecentLineup, fetchSquad, ratingsFromStandings, saveTeamPlayers,
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
      case "stop_leagues": return json(await stopLeagues(db, body));
      case "set_scenario": return json(await setScenario(db, body));
      case "clear_scenario": {
        await db.from("sim_matches").update({ scenario: null }).eq("fixture_id", Number(body.fixture_id));
        return json({ ok: true });
      }
      case "update_settings": return json(await updateSettings(db, body));
      case "import_squads": return json(await importSquads(db, body.league_id ? Number(body.league_id) : null, !!body.force));
      case "init_ratings": return json(await initRatings(db, Number(body.league_id), !!body.overwrite));
      case "set_rating": return json(await setRating(db, body));
      case "start_test_matches": return json(await startTestMatches(db));
      case "stop_test_matches": return json(await stopTestMatches(db));
      case "set_live_score": return json(await setLiveScore(db, body));
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
  const [lRes, sRes, tRes] = await Promise.all([
    db.rpc("sim_league_status"),
    db.from("sim_settings").select("*").eq("id", 1).single(),
    db.from("fixtures").select("id, status_short").eq("league_id", TEST_LEAGUE_ID).eq("archived", false),
  ]);
  if (lRes.error) throw lRes.error;
  const out = (lRes.data ?? [])
    .filter((l: Record<string, unknown>) => Number(l.id) !== TEST_LEAGUE_ID)
    .map((l: Record<string, unknown>) => ({
      ...l, teams: Number(l.teams), players: Number(l.players), upcoming: Number(l.upcoming), played: Number(l.played),
    }));
  const testRows = tRes.data ?? [];
  const testLive = testRows.filter((f) => ["1H", "HT", "2H", "NS"].includes(String(f.status_short))).length;
  return {
    ok: true,
    settings: sRes.data,
    leagues: out,
    test_matches: { count: testRows.length, live: testLive },
  };
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
  const { data: have } = await db.from("players").select("team_id, api_id").in("team_id", teamIds);
  const realN = new Map<number, number>();
  const fakeN = new Map<number, number>();
  for (const r of have ?? []) {
    const id = r.team_id as number;
    if (r.api_id != null) realN.set(id, (realN.get(id) ?? 0) + 1);
    else fakeN.set(id, (fakeN.get(id) ?? 0) + 1);
  }
  // Gerçek kadrosu yeterince olan takımdan uydurma isimleri sil
  const mixed = teamIds.filter((id) => (realN.get(id) ?? 0) >= 11 && (fakeN.get(id) ?? 0) > 0);
  for (const teamId of mixed) {
    await db.from("players").delete().eq("team_id", teamId).is("api_id", null);
    fakeN.delete(teamId);
  }

  const todo = force
    ? teamIds
    : teamIds.filter((id) => (realN.get(id) ?? 0) < 11);
  if (!todo.length) return { ok: true, imported: 0, synthetic: 0, skipped: teamIds.length, cleaned: mixed.length };

  const { data: ratings } = await db.from("team_ratings").select("team_id, attack, midfield, defense, goalkeeper").in("team_id", todo);
  const overall = new Map((ratings ?? []).map((r) => [r.team_id as number, (Number(r.attack) + Number(r.midfield) + Number(r.defense) + Number(r.goalkeeper)) / 4]));

  const key = apiKey();
  const api = key ? new ApiFootball(key) : null;
  let imported = 0, synthetic = 0, skipped = 0;
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
    if (rows) {
      await saveTeamPlayers(db, teamId, rows, true);
      imported++;
      continue;
    }
    // API varken uydurma kadro yazma; sonraki import dener.
    if (api) { skipped++; continue; }
    await saveTeamPlayers(db, teamId, buildSyntheticPlayers(teamId, ov), true);
    synthetic++;
  }
  await log(db, "sim-admin", true, `kadro: API ${imported}, sentetik ${synthetic}, atlandı ${skipped}`, api?.requests ?? 0);
  return { ok: true, imported, synthetic, remaining: skipped, requests: api?.requests ?? 0, cleaned: mixed.length };
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
  const pool = (all ?? []).filter((l) => l.id !== TEST_LEAGUE_ID && (!wanted || wanted.has(l.id)));
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

  const cup = isCupLeague(leagueId);
  let apiFixtures = 0;
  let calendar: CalendarResult | null = null;
  if (realCalendar) {
    const key = apiKey();
    if (key) {
      try {
        const api = new ApiFootball(key);
        const fx = await fetchSeasonFixtures(api, leagueId, Number(league.season));
        const stageFx = cup ? filterCupMainFixtures(fx) : fx;
        apiFixtures = stageFx.length;
        const fromStage = teamsFromFixtures(stageFx);
        if (cup && fromStage.length >= 8) {
          teams.length = 0;
          teams.push(...fromStage);
        } else {
          const extra = fromStage.filter((t) => !teams.some((x) => x.id === t.id));
          if (extra.length) {
            await upsertChunked(db, "teams", extra.map((t) => ({ id: t.id, name: t.name, logo: t.logo })), "id");
            teams.push(...extra);
          }
        }
        if (fromStage.length) {
          await upsertChunked(db, "teams", fromStage.map((t) => ({ id: t.id, name: t.name, logo: t.logo })), "id");
        }
        calendar = planFromApiFixtures(stageFx, teams.map((t) => t.id), leagueId, startAt, seed);
      } catch (e) {
        console.warn(`fixtures ${leagueId}: ${errMsg(e)}`);
      }
    }
  }

  if (cup) {
    await db.from("league_teams").delete().eq("league_id", leagueId);
    await upsertChunked(db, "league_teams", teams.map((t) => ({ league_id: leagueId, team_id: t.id })), "league_id,team_id");
  }

  await initRatings(db, leagueId, false);
  await db.from("team_ratings").update({ sim_played: 0, sim_points: 0, sim_gf: 0, sim_ga: 0, sim_form: "" }).in("team_id", teams.map((t) => t.id));

  // 2) Kadrolar: her lig başlangıcında API'den güncel kadro (ayrılanlar düşer)
  const squads = await importSquads(db, leagueId, true, Number(body.squad_budget_ms ?? 110_000));

  // 3) Eski fikstürler (API ya da önceki simülasyon) arşive
  const archived = await archiveLeagueFixtures(db, leagueId);
  await db.from("player_stats").delete().eq("league_id", leagueId);

  // 4) Yeni fikstür: gerçek sezon (varsayılan) veya hızlı test takvimi
  if (!calendar) {
    if (cup) {
      calendar = planFromRhythm(teams.map((t) => t.id), leagueId, { ...cfg, double_round: false }, seed);
      calendar.matches = calendar.matches.filter((m) => m.round <= 8);
      calendar.estimated = calendar.matches.length;
    } else if (realCalendar || cfg.round_interval_hours >= 24) {
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

  const teamIdSet = new Set(teams.map((t) => t.id));
  const { data: otherFx } = await db.from("fixtures")
    .select("home_team_id, away_team_id, date")
    .eq("is_sim", true)
    .eq("archived", false)
    .neq("league_id", leagueId)
    .in("status_short", ["NS", "1H", "HT", "2H"]);
  const busy: { teamId: number; date: Date }[] = [];
  for (const f of otherFx ?? []) {
    const d = new Date(f.date as string);
    if (Number.isNaN(d.getTime())) continue;
    if (teamIdSet.has(f.home_team_id as number)) busy.push({ teamId: f.home_team_id as number, date: d });
    if (teamIdSet.has(f.away_team_id as number)) busy.push({ teamId: f.away_team_id as number, date: d });
  }
  if (busy.length) {
    calendar.matches = resolveTeamClashes(calendar.matches, busy, { uefa: isUefaClubCup(leagueId) });
    calendar.estimated = calendar.matches.filter((m) => m.estimated).length;
  }

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

/** Aktif ligleri sırayla durdurur (fikstür arşiv + kupon iadesi). */
async function stopLeagues(db: SupabaseClient, body: Record<string, unknown>) {
  const { data: all, error } = await db.from("leagues").select("id, name, sim_started_at").order("sort_order");
  if (error) throw error;
  const wanted = Array.isArray(body.league_ids) && body.league_ids.length
    ? new Set((body.league_ids as unknown[]).map(Number))
    : null;
  const pool = (all ?? []).filter((l) => l.id !== TEST_LEAGUE_ID && (!wanted || wanted.has(l.id)));
  const todo = pool.filter((l) => l.sim_started_at);
  const skipped = pool.filter((l) => !l.sim_started_at).map((l) => ({ id: l.id, name: l.name, reason: "zaten kapalı" }));
  const stopped: { id: number; name: string; archived: number }[] = [];
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
      const r = await stopLeague(db, l.id);
      stopped.push({ id: l.id, name: l.name, archived: r.archived });
    } catch (e) {
      failed.push({ id: l.id, name: l.name, error: errMsg(e) });
    }
  }

  const msg = `hepsi durdu: ${stopped.length} durdu, ${skipped.length} atlandı, ${failed.length} hata`;
  await log(db, "sim-admin", failed.length === 0, msg, 0);
  return { ok: failed.length === 0, stopped, skipped, failed };
}

/** API'den güncel kadro çekip yazar (ayrılan oyuncular düşer). */
async function ensureRealSquads(db: SupabaseClient, teamIds: number[]): Promise<number[]> {
  if (!teamIds.length) return [];
  const key = apiKey();
  if (!key) {
    const { data: existing } = await db.from("players").select("team_id, api_id").in("team_id", teamIds);
    const realCount = new Map<number, number>();
    for (const r of existing ?? []) {
      if (r.api_id != null) realCount.set(r.team_id as number, (realCount.get(r.team_id as number) ?? 0) + 1);
    }
    return teamIds.filter((id) => (realCount.get(id) ?? 0) >= 11);
  }

  const api = new ApiFootball(key);
  const { data: ratings } = await db.from("team_ratings").select("team_id, attack, midfield, defense, goalkeeper").in("team_id", teamIds);
  const overall = new Map((ratings ?? []).map((r) => [
    r.team_id as number,
    (Number(r.attack) + Number(r.midfield) + Number(r.defense) + Number(r.goalkeeper)) / 4,
  ]));

  const ok: number[] = [];
  for (const teamId of teamIds) {
    try {
      const squad = await fetchSquad(api, teamId);
      if (!squad || squad.length < 11) continue;
      await saveTeamPlayers(db, teamId, buildPlayersFromApi(teamId, overall.get(teamId) ?? 62, squad), true);
      ok.push(teamId);
    } catch (e) {
      console.warn(`squad ${teamId}: ${errMsg(e)}`);
    }
  }
  return ok;
}

/** 10 rastgele canlı test maçı — puan / krallık / forma yazılmaz. Gerçek kadrolar tercih edilir. */
async function startTestMatches(db: SupabaseClient) {
  const now = new Date();
  await db.from("leagues").upsert({
    id: TEST_LEAGUE_ID,
    name: "Test Maçları",
    country: "Test",
    season: now.getFullYear(),
    sort_order: 999,
    is_active: false,
    sim_started_at: now.toISOString(),
  }, { onConflict: "id" });

  await archiveLeagueFixtures(db, TEST_LEAGUE_ID);

  const { data: pl } = await db.from("players").select("team_id, api_id");
  const realN = new Map<number, number>();
  const fakeIds: number[] = [];
  for (const r of pl ?? []) {
    const id = r.team_id as number;
    if (r.api_id != null) realN.set(id, (realN.get(id) ?? 0) + 1);
    else fakeIds.push(id);
  }
  const fakeSet = new Set(fakeIds);
  for (const teamId of [...realN.keys()]) {
    if ((realN.get(teamId) ?? 0) >= 11 && fakeSet.has(teamId)) {
      await db.from("players").delete().eq("team_id", teamId).is("api_id", null);
    }
  }
  let ids = [...realN.entries()].filter(([, n]) => n >= 11).map(([id]) => id);
  if (ids.length < 20) {
    const { data: ts } = await db.from("teams").select("id");
    const extra = (ts ?? []).map((t) => t.id as number).filter((id) => !ids.includes(id));
    const filled = await ensureRealSquads(db, extra.slice(0, 48));
    ids = [...new Set([...ids, ...filled])];
  }
  const rng = new Rng(hashSeed("test-batch", now.toISOString()));
  ids = rng.shuffle(ids);
  if (ids.length < 2) {
    throw new Error("Test maçı için gerçek kadrolu yeterli takım yok. Lig başlatıp kadroların API'den gelmesini bekleyin.");
  }
  const n = Math.min(10, Math.floor(ids.length / 2));
  if (n < 1) throw new Error("Test maçı için yeterli takım yok");
  const used = ids.slice(0, n * 2);
  await ensureRealSquads(db, used);

  const recents = new Map<number, NonNullable<Awaited<ReturnType<typeof fetchRecentLineup>>>>();
  const key = apiKey();
  if (key) {
    const api = new ApiFootball(key);
    await mapLimit(used, 3, async (teamId) => {
      try {
        const lu = await fetchRecentLineup(api, teamId);
        if (lu) recents.set(teamId, lu);
      } catch (e) {
        console.warn(`lineup ${teamId}: ${errMsg(e)}`);
      }
    });
  }

  const [{ data: teamRows }, settings, ratings, players] = await Promise.all([
    db.from("teams").select("id, name, logo").in("id", used),
    loadSettings(db),
    loadRatings(db, used),
    loadPlayers(db, used),
  ]);
  const teams = new Map((teamRows ?? []).map((t) => [t.id as number, t as TeamInfo]));

  const { data: maxRow } = await db.from("fixtures").select("id").gte("id", SIM_ID_BASE).order("id", { ascending: false }).limit(1);
  let nextId = Math.max(SIM_ID_BASE, Number(maxRow?.[0]?.id ?? SIM_ID_BASE)) + 1;

  const created: { id: number; home: string; away: string }[] = [];
  for (let i = 0; i < n; i++) {
    const home = used[i * 2], away = used[i * 2 + 1];
    const id = nextId++;
    const { error: fxErr } = await db.from("fixtures").insert({
      id,
      league_id: TEST_LEAGUE_ID,
      season: now.getFullYear(),
      round: "Test Maçları",
      date: now.toISOString(),
      status_short: "1H",
      status_long: "First Half",
      elapsed: 1,
      home_team_id: home,
      away_team_id: away,
      home_goals: 0,
      away_goals: 0,
      is_sim: true,
      archived: false,
      settled: false,
      live_odds_at: now.toISOString(),
      updated_at: now.toISOString(),
    });
    if (fxErr) throw fxErr;

    const seed = hashSeed("test-match", id, now.toISOString());
    const exp = fixtureExpectation(ratings, home, away, 34);
    const script = generateScript({
      seed,
      kickoff: now,
      home: { id: home, name: teams.get(home)?.name ?? "Ev", players: players.get(home) ?? [], recent: recents.get(home) ?? null },
      away: { id: away, name: teams.get(away)?.name ?? "Dep", players: players.get(away) ?? [], recent: recents.get(away) ?? null },
      exp,
      scenario: null,
    });
    const { error: smErr } = await db.from("sim_matches").upsert({
      fixture_id: id, seed, scenario: null, script, facts: script.facts,
      kickoff_at: now.toISOString(), revealed: 0, last_minute: 0, odds_minute: 1, suspended_until: null,
    }, { onConflict: "fixture_id" });
    if (smErr) throw smErr;

    const rows = priceOdds(id, computeProbabilities(exp, { ...PRE_STATE, phase: "1H", t: 1 }), settings.live_margin, true);
    await replaceOdds(db, id, rows);
    await writeDetails(db, { id, home_team_id: home, away_team_id: away }, script, teams, 0, false);
    created.push({ id, home: teams.get(home)?.name ?? String(home), away: teams.get(away)?.name ?? String(away) });
  }

  await log(db, "sim-admin", true, `test: ${created.length} canlı maç`, 0);
  return { ok: true, matches: created };
}

async function stopTestMatches(db: SupabaseClient) {
  const archived = await archiveLeagueFixtures(db, TEST_LEAGUE_ID);
  await db.from("leagues").update({ sim_started_at: null, odds_dirty_at: null }).eq("id", TEST_LEAGUE_ID);
  await log(db, "sim-admin", true, `test durdu: ${archived} maç`, 0);
  return { ok: true, archived };
}

function parseScenarioGoals(
  raw: unknown,
  htH: number,
  htA: number,
  ftH: number,
  ftA: number,
): ScenarioGoal[] {
  const incoming = Array.isArray(raw) ? raw : [];
  const parsed: ScenarioGoal[] = [];
  for (const row of incoming) {
    const r = row as { side?: unknown; half?: unknown; at?: unknown; minute?: unknown; timing?: unknown };
    const side = r?.side === "away" ? "away" as const : r?.side === "home" ? "home" as const : null;
    const half = Number(r?.half) === 2 ? 2 as const : Number(r?.half) === 1 ? 1 as const : null;
    if (!side || !half) continue;
    let at: ScenarioGoal["at"];
    if (r.at === "stoppage" || r.timing === "stoppage") at = "stoppage";
    else if (r.at === "random" || r.timing === "random") at = undefined;
    else {
      const m = Number(r.at ?? r.minute);
      if (Number.isFinite(m) && m > 0) at = Math.round(m);
    }
    parsed.push(at !== undefined ? { side, half, at } : { side, half });
  }
  const spec: { side: "home" | "away"; half: 1 | 2; n: number }[] = [
    { side: "home", half: 1, n: htH },
    { side: "away", half: 1, n: htA },
    { side: "home", half: 2, n: Math.max(0, ftH - htH) },
    { side: "away", half: 2, n: Math.max(0, ftA - htA) },
  ];
  const out: ScenarioGoal[] = [];
  for (const c of spec) {
    const pool = parsed.filter((g) => g.side === c.side && g.half === c.half);
    for (let i = 0; i < c.n; i++) out.push(pool[i] ?? { side: c.side, half: c.half });
  }
  return out;
}

const LIVE_SCORE_STATUSES = new Set(["1H", "HT", "2H"]);

// ---------------------------------------------------------------------

/** Canlı maçın o anki skorunu değiştirir (gol ekler / son golü siler), oranları yeniler. */
async function setLiveScore(db: SupabaseClient, body: Record<string, unknown>) {
  const fixtureId = Number(body.fixture_id);
  const wantH = Math.round(Number(body.home_goals));
  const wantA = Math.round(Number(body.away_goals));
  if (!Number.isFinite(fixtureId) || !Number.isFinite(wantH) || !Number.isFinite(wantA)) throw new Error("fixture_id ve skor gerekli");
  if (wantH < 0 || wantA < 0 || wantH > 12 || wantA > 12) throw new Error("Skor 0–12 aralığında olmalı");

  const { data: f, error } = await db.from("fixtures")
    .select("id, league_id, status_short, home_team_id, away_team_id, date")
    .eq("id", fixtureId).eq("is_sim", true).eq("archived", false).single();
  if (error) throw error;
  if (f.status_short === "NS") {
    const { data: existing } = await db.from("sim_matches").select("seed, scenario").eq("fixture_id", fixtureId).maybeSingle();
    const prev = (existing?.scenario ?? null) as Scenario | null;
    const locked = prev?.locked === true
      || (prev?.locked !== false && prev?.note === "admin skor");
    const seed = existing?.seed ? Number(existing.seed) : hashSeed("match", fixtureId, f.date);
    if (body.mode === "unlock") {
      const sc: Scenario = prev
        ? { ...prev, locked: false }
        : { ht_home: 0, ht_away: 0, ft_home: wantH, ft_away: wantA, locked: false };
      const { error: upErr } = await db.from("sim_matches").upsert({ fixture_id: fixtureId, seed, scenario: sc }, { onConflict: "fixture_id" });
      if (upErr) throw upErr;
      return { ok: true, home_goals: sc.ft_home, away_goals: sc.ft_away, elapsed: null, status: "NS", scenario: sc };
    }
    if (locked) throw new Error("Skor kilitli. Önce kilidi aç.");
    const htH = Number.isFinite(Number(body.ht_home))
      ? Math.max(0, Math.min(wantH, Math.round(Number(body.ht_home))))
      : Math.min(wantH, prev && prev.ft_home >= wantH ? Math.min(prev.ht_home, wantH) : Math.floor(wantH * 0.45));
    const htA = Number.isFinite(Number(body.ht_away))
      ? Math.max(0, Math.min(wantA, Math.round(Number(body.ht_away))))
      : Math.min(wantA, prev && prev.ft_away >= wantA ? Math.min(prev.ht_away, wantA) : Math.floor(wantA * 0.45));
    const goals = parseScenarioGoals(body.goals, htH, htA, wantH, wantA);
    const sc: Scenario = {
      ht_home: htH, ht_away: htA, ft_home: wantH, ft_away: wantA,
      note: prev?.note ?? "admin skor",
      locked: true,
      goals,
    };
    const { error: upErr } = await db.from("sim_matches").upsert({ fixture_id: fixtureId, seed, scenario: sc }, { onConflict: "fixture_id" });
    if (upErr) throw upErr;
    await log(db, "sim-admin", true, `senaryo ${fixtureId}: İY ${htH}-${htA} MS ${wantH}-${wantA}`, 0);
    return { ok: true, home_goals: wantH, away_goals: wantA, elapsed: null, status: "NS", scenario: sc };
  }
  if (!LIVE_SCORE_STATUSES.has(f.status_short)) throw new Error("Sadece canlı veya başlamamış maçlarda skor değiştirilebilir");

  const [{ data: sm, error: smErr }, settings] = await Promise.all([
    db.from("sim_matches").select("seed, script, kickoff_at").eq("fixture_id", fixtureId).maybeSingle(),
    loadSettings(db),
  ]);
  if (smErr) throw smErr;
  if (!sm?.script || !sm.kickoff_at) throw new Error("Bu maçın senaryosu yok");

  const script0 = sm.script as Script;
  const now = new Date();
  const clock = matchClock(new Date(sm.kickoff_at), now, script0.stoppage, settings);
  if (clock.phase === "FT") throw new Error("Maç bitti, skor değiştirilemez");

  const mode = body.mode === "inject" || body.mode === "drop_admin" || body.mode === "unlock"
    ? body.mode
    : "plan";
  const locked = script0.scenario?.locked === true
    || (script0.scenario?.locked !== false && script0.scenario?.note === "admin skor");
  if (locked && mode !== "unlock") {
    throw new Error("Skor kilitli. Önce kilidi aç.");
  }

  const snap0 = snapshot(script0, clock.key);
  const curH = snap0.h1 + snap0.h2, curA = snap0.a1 + snap0.a2;
  if (mode === "plan" && (wantH < curH || wantA < curA)) {
    throw new Error(`Olmuş gol geri alınamaz. Plan en az ${curH}-${curA} olmalı.`);
  }

  const seed = Number(sm.seed) || fixtureId;
  const extraAts: { side: "home" | "away"; key: number }[] = [];
  if (Array.isArray(body.minutes)) {
    for (const row of body.minutes as { side?: unknown; minute?: unknown; extra?: unknown; half?: unknown }[]) {
      const side = row?.side === "away" ? "away" as const : row?.side === "home" ? "home" as const : null;
      const m = Number(row?.minute);
      const x = Number(row?.extra ?? 0);
      if (!side || !Number.isFinite(m) || m <= 0) continue;
      const half = Number(row?.half) === 2 ? 2 : Number(row?.half) === 1 ? 1 : null;
      const extra = Number.isFinite(x) ? x : 0;
      const key = half === 1
        ? Math.max(1, Math.min(45, m)) + extra
        : half === 2
          ? 100 + Math.max(46, Math.min(90, m <= 45 ? 46 : m)) + extra
          : elapsedToKey(m, extra);
      if (mode !== "drop_admin" && key < clock.key) throw new Error(`Gol dakikası ${clock.elapsed}' altına inemez.`);
      extraAts.push({ side, key });
    }
  }
  const minute = Number(body.minute);
  const extra = Number(body.extra ?? 0);
  const wantKey = Number.isFinite(minute) && minute > 0
    ? elapsedToKey(minute, Number.isFinite(extra) ? extra : 0)
    : clock.key;
  if (mode === "plan" && extraAts.length === 0 && wantKey < clock.key) {
    throw new Error(`Gol dakikası ${clock.elapsed}' altına inemez.`);
  }

  let script: Script;
  if (mode === "unlock") {
    const prev = script0.scenario;
    script = {
      ...script0,
      scenario: {
        ht_home: prev?.ht_home ?? script0.facts.h1,
        ht_away: prev?.ht_away ?? script0.facts.a1,
        ft_home: prev?.ft_home ?? script0.facts.h1 + script0.facts.h2,
        ft_away: prev?.ft_away ?? script0.facts.a1 + script0.facts.a2,
        note: prev?.note,
        goals: prev?.goals,
        locked: false,
      },
    };
  } else if (mode === "inject") {
    if (!extraAts.length) throw new Error("Eklenecek gol yok");
    script = injectLiveGoals(script0, { nowKey: clock.key, extraAts, nonce: seed });
  } else if (mode === "drop_admin") {
    if (extraAts.length !== 1) throw new Error("Silinecek gol gerekli");
    script = dropAdminGoal(script0, { nowKey: clock.key, side: extraAts[0].side, key: extraAts[0].key });
  } else {
    script = rewriteRemainingScore(script0, {
      nowKey: clock.key,
      goalKey: extraAts.length ? undefined : wantKey,
      extraAts: extraAts.length ? extraAts : undefined,
      wantHome: wantH, wantAway: wantA, nonce: seed,
    });
  }

  const snap = snapshot(script, clock.key);
  const home = snap.h1 + snap.h2, away = snap.a1 + snap.a2;
  const pastFirstHalf = clock.phase === "HT" || clock.phase === "2H";

  const [{ data: teamRows }, ratings, leagues] = await Promise.all([
    db.from("teams").select("id, name, logo").in("id", [f.home_team_id, f.away_team_id]),
    loadRatings(db, [f.home_team_id, f.away_team_id]),
    loadLeagues(db),
  ]);
  const teams = new Map((teamRows ?? []).map((t) => [t.id as number, t as TeamInfo]));
  const league = leagues.get(f.league_id);
  const exp = fixtureExpectation(ratings, f.home_team_id, f.away_team_id, totalRounds(league));
  const state: LiveState = {
    phase: clock.phase, t: clock.abs,
    h1: snap.h1, a1: snap.a1, h2: snap.h2, a2: snap.a2,
    corners: snap.corners, corners1h: snap.corners1h, penalty: snap.penalty,
    redHome: snap.redHome, redAway: snap.redAway,
  };
  const rows = priceOdds(fixtureId, computeProbabilities(exp, state), settings.live_margin, true);
  const scoredNow = home !== curH || away !== curA;
  const hold = Math.max(5, Number(settings.goal_suspend_seconds) || 40);
  const until = new Date(now.getTime() + hold * 1000);

  if (scoredNow) {
    await lockLiveBetting(db, fixtureId, until, now);
  }

  await Promise.all([
    db.from("sim_matches").update({
      script, facts: script.facts, scenario: script.scenario,
      revealed: snap.events.length, last_minute: clock.abs,
      odds_minute: clock.abs,
      suspended_until: scoredNow ? until.toISOString() : null,
    }).eq("fixture_id", fixtureId),
    db.from("fixtures").update({
      home_goals: home, away_goals: away,
      ht_home: pastFirstHalf ? snap.h1 : null,
      ht_away: pastFirstHalf ? snap.a1 : null,
      live_odds_at: scoredNow ? null : now.toISOString(),
      updated_at: now.toISOString(),
    }).eq("id", fixtureId),
    writeDetails(db, { id: fixtureId, home_team_id: f.home_team_id, away_team_id: f.away_team_id }, script, teams, clock.key, false),
    scoredNow ? Promise.resolve() : replaceOdds(db, fixtureId, rows),
  ]);

  if (clock.phase === "1H" || clock.phase === "HT" || clock.phase === "2H") {
    await settleLiveDecided(db, fixtureId, {
      h1: snap.h1, a1: snap.a1, h2: snap.h2, a2: snap.a2,
      corners: snap.corners, corners1h: snap.corners1h, penalty: snap.penalty,
    }, clock.phase, home, away);
  }

  await log(db, "sim-admin", true, `plan ${fixtureId}: şu an ${home}-${away} → MS ${wantH}-${wantA}`, 0);
  return { ok: true, home_goals: home, away_goals: away, plan_home: wantH, plan_away: wantA, elapsed: clock.elapsed, status: clock.status };
}

async function setScenario(db: SupabaseClient, body: Record<string, unknown>) {
  const fixtureId = Number(body.fixture_id);
  const ht_home = Math.max(0, Math.min(9, Number(body.ht_home ?? 0)));
  const ht_away = Math.max(0, Math.min(9, Number(body.ht_away ?? 0)));
  const ft_home = Math.max(0, Math.min(12, Number(body.ft_home ?? 0)));
  const ft_away = Math.max(0, Math.min(12, Number(body.ft_away ?? 0)));
  const sc: Scenario = {
    ht_home, ht_away, ft_home, ft_away,
    note: typeof body.note === "string" ? body.note.slice(0, 200) : undefined,
    goals: body.goals !== undefined ? parseScenarioGoals(body.goals, ht_home, ht_away, ft_home, ft_away) : undefined,
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
