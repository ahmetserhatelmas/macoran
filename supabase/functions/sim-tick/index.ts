// Simülasyon kalbi (pg_cron: her 15 sn)
//  1) Saati gelen maçları başlat: kadro + tam maç script'i üret, canlı oranları aç
//  2) Canlı maçları ilerlet: olayları açıkla, skor/istatistik/anlatım yaz,
//     gol/kırmızı/penaltıda oranları askıya al, sonra yeni canlı oranlar
//  3) Biten maçlar: kuponları sonuçlandır, oyuncu istatistikleri, sakatlık/ceza,
//     takım formu, puan durumu
//  4) Maç öncesi oranları üret / güç değiştiğinde yenile
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { adminClient, authorize, errMsg, json, log, upsertChunked } from "../_shared/db.ts";
import { matchClock } from "../_shared/sim/clock.ts";
import { computeStandings, type TeamInfo } from "../_shared/sim/league.ts";
import { type Facts, settleSelection } from "../_shared/sim/markets.ts";
import { computeProbabilities, type LiveState, type OddRow, PRE_STATE, priceOdds } from "../_shared/sim/model.ts";
import { hashSeed } from "../_shared/sim/rng.ts";
import { countUpTo, generateScript, type Scenario, type Script, type SimEvent, snapshot } from "../_shared/sim/script.ts";
import {
  acquireTickLock, deleteOdds, fixtureExpectation, type LeagueSim, loadLeagues, loadPlayers, loadRatings, loadSettings,
  mapLimit, releaseTickLock, replaceOdds, type SimSettings, totalRounds,
} from "../_shared/sim/store.ts";
import type { RatingRow } from "../_shared/sim/model.ts";

/** Tick boyunca paylaşılan önbellek (takımlar, güçler) */
interface Ctx {
  db: SupabaseClient;
  settings: SimSettings;
  leagues: Map<number, LeagueSim>;
  teams: Map<number, TeamInfo>;
  ratings: Map<number, RatingRow>;
  now: Date;
}
const CONCURRENCY = 6;

interface FixtureRow {
  id: number; league_id: number; season: number; date: string; status_short: string; elapsed: number | null;
  home_team_id: number; away_team_id: number; home_goals: number | null; away_goals: number | null;
  ht_home: number | null; ht_away: number | null;
}
interface SimMatchRow {
  fixture_id: number; seed: number; scenario: Scenario | null; script: Script | null; kickoff_at: string | null;
  revealed: number; last_minute: number; odds_minute: number; suspended_until: string | null;
}

const LIVE = ["1H", "HT", "2H"];
const PREMATCH_WINDOW_DAYS = 3;
const PREMATCH_BATCH = 40;

Deno.serve(async (req) => {
  const db = adminClient();
  if (!(await authorize(req, db))) return json({ error: "unauthorized" }, 401);

  // Üst üste binen tick'ler (bir önceki hâlâ sürüyorsa) atlanır
  if (!(await acquireTickLock(db, 90))) return json({ ok: true, skipped: "locked" });

  const started: string[] = [];
  const finished: string[] = [];
  let liveCount = 0, priced = 0;
  const t0 = Date.now();
  try {
    const now = new Date();
    const [settings, leagues, dueRes, liveRes] = await Promise.all([
      loadSettings(db),
      loadLeagues(db),
      db.from("fixtures").select("*")
        .eq("is_sim", true).eq("archived", false).eq("status_short", "NS")
        .lte("date", now.toISOString()).order("date").limit(40),
      db.from("fixtures").select("*")
        .eq("is_sim", true).eq("archived", false).in("status_short", LIVE)
        .order("date").limit(80),
    ]);
    if (dueRes.error) throw dueRes.error;
    if (liveRes.error) throw liveRes.error;

    const due = ((dueRes.data ?? []) as FixtureRow[]).filter((f) => leagues.get(f.league_id)?.sim_started_at);
    const liveRows = (liveRes.data ?? []) as FixtureRow[];
    liveCount = liveRows.length;

    // Tick boyunca ortak önbellek
    const teamIds = [...new Set([...due, ...liveRows].flatMap((f) => [f.home_team_id, f.away_team_id]))];
    const [teams, ratings, smRes] = await Promise.all([
      loadTeams(db, teamIds),
      loadRatings(db, teamIds),
      liveRows.length
        ? db.from("sim_matches").select("*").in("fixture_id", liveRows.map((f) => f.id))
        : Promise.resolve({ data: [] as unknown[], error: null }),
    ]);
    if (smRes.error) throw smRes.error;
    const ctx: Ctx = { db, settings, leagues, teams, ratings, now };
    const smMap = new Map((smRes.data ?? []).map((s) => [Number((s as SimMatchRow).fixture_id), s as SimMatchRow]));

    // ------------------------------------------------------------------
    // 1) Başlaması gereken maçlar
    // ------------------------------------------------------------------
    await mapLimit(due, CONCURRENCY, async (f) => {
      await startMatch(ctx, f, leagues.get(f.league_id)!);
      started.push(String(f.id));
    });

    // ------------------------------------------------------------------
    // 2) Canlı maçlar
    // ------------------------------------------------------------------
    await mapLimit(liveRows, CONCURRENCY, async (f) => {
      const sm = smMap.get(f.id);
      if (!sm?.script || !sm.kickoff_at) {
        // script yok: yeniden başlat
        const league = leagues.get(f.league_id);
        if (league) await startMatch(ctx, f, league);
        return;
      }
      const done = await advanceMatch(ctx, f, sm);
      if (done) finished.push(String(f.id));
    });

    // ------------------------------------------------------------------
    // 3) Maç öncesi oranlar
    // ------------------------------------------------------------------
    priced = await refreshPrematch(db, leagues, settings, now);

    const ms = Date.now() - t0;
    const msg = `canlı ${liveCount}${started.length ? `, başladı ${started.length}` : ""}${finished.length ? `, bitti ${finished.length}` : ""}${priced ? `, oran ${priced}` : ""} (${ms} ms)`;
    await db.from("sim_settings").update({ last_tick_at: now.toISOString(), last_tick_message: msg }).eq("id", 1);
    if (started.length || finished.length) await log(db, "sim-tick", true, msg, 0);
    return json({ ok: true, live: liveCount, started, finished, priced, ms });
  } catch (e) {
    const msg = errMsg(e);
    await log(db, "sim-tick", false, msg, 0);
    await db.from("sim_settings").update({ last_tick_at: new Date().toISOString(), last_tick_message: `HATA: ${msg.slice(0, 200)}` }).eq("id", 1);
    return json({ ok: false, error: msg }, 500);
  } finally {
    await releaseTickLock(db);
  }
});

// =====================================================================
// Maç başlatma
// =====================================================================
async function startMatch(ctx: Ctx, f: FixtureRow, league: LeagueSim) {
  const { db, settings, teams, ratings, now } = ctx;
  const teamIds = [f.home_team_id, f.away_team_id];
  const [players, smRes] = await Promise.all([
    loadPlayers(db, teamIds),
    db.from("sim_matches").select("seed, scenario").eq("fixture_id", f.id).maybeSingle(),
  ]);
  const smRow = smRes.data;
  const seed = smRow?.seed ? Number(smRow.seed) : hashSeed("match", f.id, f.date);
  const scenario = (smRow?.scenario ?? null) as Scenario | null;

  const exp = fixtureExpectation(ratings, f.home_team_id, f.away_team_id, totalRounds(league));
  const script = generateScript({
    seed, kickoff: now,
    home: { id: f.home_team_id, name: teams.get(f.home_team_id)?.name ?? "Ev", players: players.get(f.home_team_id) ?? [] },
    away: { id: f.away_team_id, name: teams.get(f.away_team_id)?.name ?? "Dep", players: players.get(f.away_team_id) ?? [] },
    exp, scenario,
  });

  const { error: smErr } = await db.from("sim_matches").upsert({
    fixture_id: f.id, seed, scenario, script, facts: script.facts,
    kickoff_at: now.toISOString(), revealed: 0, last_minute: 0, odds_minute: 1, suspended_until: null,
  }, { onConflict: "fixture_id" });
  if (smErr) throw smErr;

  // Cezalı oyuncular bu maçı kaçırdı -> ceza düşer
  const suspended = [...(players.get(f.home_team_id) ?? []), ...(players.get(f.away_team_id) ?? [])].filter((p) => p.suspended_matches > 0);

  // Canlı oranlar (1. dakika)
  const state: LiveState = { ...PRE_STATE, phase: "1H", t: 1 };
  const rows = priceOdds(f.id, computeProbabilities(exp, state), settings.live_margin, true);

  await Promise.all([
    ...suspended.map((p) => db.from("players").update({ suspended_matches: Math.max(0, p.suspended_matches - 1) }).eq("id", p.id)),
    db.from("fixtures").update({
      status_short: "1H", status_long: "First Half", elapsed: 1, home_goals: 0, away_goals: 0,
      ht_home: null, ht_away: null, ft_home: null, ft_away: null, live_odds_at: now.toISOString(), updated_at: now.toISOString(),
    }).eq("id", f.id),
    writeDetails(db, f, script, teams, 0, false),
    replaceOdds(db, f.id, rows),
  ]);
}

// =====================================================================
// Canlı ilerletme
// =====================================================================
async function advanceMatch(ctx: Ctx, f: FixtureRow, sm: SimMatchRow): Promise<boolean> {
  const { db, settings, teams, ratings, now } = ctx;
  const league = ctx.leagues.get(f.league_id);
  const script = sm.script!;
  const clock = matchClock(new Date(sm.kickoff_at!), now, script.stoppage, settings);
  const snap = snapshot(script, clock.key);

  // Yeni açıklanan olaylar
  const newEvents = snap.events.slice(sm.revealed);
  const trigger = newEvents.some((e) =>
    (e.type === "Goal") || (e.type === "Card" && (e.detail === "Red Card" || e.detail === "Second Yellow card")) || (e.type === "Var")
  );

  const homeGoals = snap.h1 + snap.h2, awayGoals = snap.a1 + snap.a2;
  const pastFirstHalf = clock.phase === "HT" || clock.phase === "2H" || clock.phase === "FT";
  const fixtureUpdate: Record<string, unknown> = {
    status_short: clock.status,
    status_long: clock.status === "1H" ? "First Half" : clock.status === "HT" ? "Halftime" : clock.status === "2H" ? "Second Half" : "Match Finished",
    elapsed: clock.elapsed,
    home_goals: homeGoals, away_goals: awayGoals,
    ht_home: pastFirstHalf ? snap.h1 : null, ht_away: pastFirstHalf ? snap.a1 : null,
    updated_at: now.toISOString(),
  };

  if (clock.phase === "FT") {
    fixtureUpdate.ft_home = homeGoals;
    fixtureUpdate.ft_away = awayGoals;
    fixtureUpdate.live_odds_at = null;
    // Yalnızca canlıdan FT'ye geçişi yapan tick maçı bitirir (çift sonuçlandırma olmaz)
    const { data: cas, error: casErr } = await db.from("fixtures").update(fixtureUpdate).eq("id", f.id).in("status_short", LIVE).select("id");
    if (casErr) throw casErr;
    if (!cas?.length) return false;
    await Promise.all([
      writeDetails(db, f, script, teams, 999, true),
      deleteOdds(db, f.id),
      db.from("sim_matches").update({ revealed: script.events.length, last_minute: clock.abs, suspended_until: null }).eq("fixture_id", f.id),
    ]);
    await finishMatch(db, f, script, league, now);
    return true;
  }

  // Askı yönetimi: gol / kırmızı / VAR -> tüm oranlar askıya alınır, süre bitince yeniden fiyatlanır
  let suspendedUntil = sm.suspended_until ? new Date(sm.suspended_until) : null;
  if (trigger) suspendedUntil = new Date(now.getTime() + settings.goal_suspend_seconds * 1000);
  const isSuspended = !!suspendedUntil && suspendedUntil > now;
  const reprice = !isSuspended && (clock.abs !== sm.odds_minute || suspendedUntil !== null);

  const smUpdate: Record<string, unknown> = { revealed: snap.events.length, last_minute: clock.abs };
  const writes: PromiseLike<unknown>[] = [];

  const minuteChanged = clock.abs !== sm.last_minute;
  if (minuteChanged || newEvents.length) writes.push(writeDetails(db, f, script, teams, clock.key, false));

  if (trigger) {
    writes.push(db.from("odds").update({ suspended: true, updated_at: now.toISOString() }).eq("fixture_id", f.id).eq("suspended", false));
  }
  if (isSuspended) {
    smUpdate.suspended_until = suspendedUntil!.toISOString();
  } else if (reprice) {
    const exp = fixtureExpectation(ratings, f.home_team_id, f.away_team_id, totalRounds(league));
    const state: LiveState = {
      phase: clock.phase, t: clock.abs,
      h1: snap.h1, a1: snap.a1, h2: snap.h2, a2: snap.a2,
      corners: snap.corners, corners1h: snap.corners1h, penalty: snap.penalty,
      redHome: snap.redHome, redAway: snap.redAway,
    };
    const rows = priceOdds(f.id, computeProbabilities(exp, state), settings.live_margin, true);
    fixtureUpdate.live_odds_at = now.toISOString();
    writes.push(replaceOdds(db, f.id, rows));
    smUpdate.odds_minute = clock.abs;
    smUpdate.suspended_until = null;
  }
  writes.push(
    db.from("fixtures").update(fixtureUpdate).eq("id", f.id),
    db.from("sim_matches").update(smUpdate).eq("fixture_id", f.id),
  );

  await Promise.all(writes);
  return false;
}

// =====================================================================
// Maç sonu
// =====================================================================
async function finishMatch(db: SupabaseClient, f: FixtureRow, script: Script, league: LeagueSim | undefined, now: Date) {
  const facts: Facts = script.facts;
  const ftH = facts.h1 + facts.h2, ftA = facts.a1 + facts.a2;

  // 1) Kuponlar
  const { data: sels, error: selErr } = await db.from("bet_selections").select("id, market, selection, line").eq("fixture_id", f.id).eq("status", "pending");
  if (selErr) throw selErr;
  const results = (sels ?? []).map((s) => ({ id: s.id, status: settleSelection(s.market, s.selection, Number(s.line), facts) }));
  const { error: settleErr } = await db.rpc("sim_settle_fixture", { p_fixture_id: f.id, p_results: results, p_home: ftH, p_away: ftA });
  if (settleErr) throw settleErr;

  // 2) Oyuncu istatistikleri + 3) takım formu (paralel)
  await Promise.all([
    applyPlayerStats(db, f, script, now),
    ...(["home", "away"] as const).map((side) => updateTeamForm(db, f, side, ftH, ftA, now)),
  ]);

  // 4) Puan durumu + 5) güçler değişti -> ligin maç öncesi oranları yenilensin
  await Promise.all([
    rebuildStandings(db, f.league_id, league),
    db.from("leagues").update({ odds_dirty_at: now.toISOString() }).eq("id", f.league_id),
  ]);
}

async function updateTeamForm(db: SupabaseClient, f: FixtureRow, side: "home" | "away", ftH: number, ftA: number, now: Date) {
  const teamId = side === "home" ? f.home_team_id : f.away_team_id;
  const gf = side === "home" ? ftH : ftA, ga = side === "home" ? ftA : ftH;
  const pts = gf > ga ? 3 : gf === ga ? 1 : 0;
  const ch = gf > ga ? "W" : gf === ga ? "D" : "L";
  const { data: r } = await db.from("team_ratings").select("sim_played, sim_points, sim_gf, sim_ga, sim_form").eq("team_id", teamId).maybeSingle();
  if (r) {
    await db.from("team_ratings").update({
      sim_played: r.sim_played + 1, sim_points: r.sim_points + pts, sim_gf: r.sim_gf + gf, sim_ga: r.sim_ga + ga,
      sim_form: ((r.sim_form ?? "") + ch).slice(-10), updated_at: now.toISOString(),
    }).eq("team_id", teamId);
  } else {
    await db.from("team_ratings").insert({
      team_id: teamId, league_id: f.league_id, sim_played: 1, sim_points: pts, sim_gf: gf, sim_ga: ga, sim_form: ch, source: "default",
    });
  }
}

async function applyPlayerStats(db: SupabaseClient, f: FixtureRow, script: Script, now: Date) {
  const END = 90 + script.stoppage.h2;
  type Acc = { apps: number; goals: number; assists: number; yellow: number; red: number; minutes: number };
  const acc = new Map<number, Acc>();
  const get = (id: number) => { if (!acc.has(id)) acc.set(id, { apps: 0, goals: 0, assists: 0, yellow: 0, red: 0, minutes: 0 }); return acc.get(id)!; };

  const absOf = (e: SimEvent) => (e.time.half === 1 ? e.time.minute + (e.time.extra ?? 0) : e.time.minute + (e.time.extra ?? 0));
  for (const side of ["home", "away"] as const) {
    const lu = script.lineups[side];
    const onFrom = new Map<number, number>(lu.starters.map((p) => [p.id, 0]));
    const offAt = new Map<number, number>();
    for (const e of script.events) {
      if (e.side !== side) continue;
      if (e.type === "subst" && e.player && e.assist) { offAt.set(e.player.id, absOf(e)); onFrom.set(e.assist.id, absOf(e)); }
      if (e.type === "Card" && (e.detail === "Red Card" || e.detail === "Second Yellow card") && e.player) offAt.set(e.player.id, absOf(e));
    }
    for (const [id, from] of onFrom) {
      const a = get(id);
      a.apps = 1;
      a.minutes = Math.max(1, (offAt.get(id) ?? END) - from);
    }
  }
  for (const e of script.events) {
    if (!e.player) continue;
    if (e.type === "Goal") {
      if (e.detail === "Normal Goal" || e.detail === "Penalty") {
        get(e.player.id).goals++;
        if (e.assist) get(e.assist.id).assists++;
      }
    } else if (e.type === "Card") {
      if (e.detail === "Yellow Card") get(e.player.id).yellow++;
      else get(e.player.id).red++;
    }
  }

  const ids = [...acc.keys()];
  if (!ids.length) return;
  const { data: existing } = await db.from("player_stats").select("*").eq("league_id", f.league_id).in("player_id", ids);
  const ex = new Map((existing ?? []).map((r) => [Number(r.player_id), r]));
  const rows = ids.map((id) => {
    const a = acc.get(id)!, e = ex.get(id);
    return {
      player_id: id, league_id: f.league_id,
      apps: (e?.apps ?? 0) + a.apps, goals: (e?.goals ?? 0) + a.goals, assists: (e?.assists ?? 0) + a.assists,
      yellow: (e?.yellow ?? 0) + a.yellow, red: (e?.red ?? 0) + a.red, minutes: (e?.minutes ?? 0) + a.minutes,
    };
  });
  // Sakatlık ve cezalar
  await Promise.all([
    upsertChunked(db, "player_stats", rows, "player_id,league_id"),
    ...script.injuries.map((inj) =>
      db.from("players").update({ injured_until: new Date(now.getTime() + inj.days * 24 * 3600_000).toISOString() }).eq("id", inj.player_id)),
    ...script.suspensions.map((s) => db.from("players").update({ suspended_matches: s.matches }).eq("id", s.player_id)),
  ]);
}

export async function rebuildStandings(db: SupabaseClient, leagueId: number, league: LeagueSim | undefined) {
  const { data: lt } = await db.from("league_teams").select("team_id, teams(id, name, logo)").eq("league_id", leagueId);
  const teams: TeamInfo[] = (lt ?? []).map((r) => {
    const t = r.teams as unknown as { id: number; name: string; logo: string | null };
    return { id: t.id, name: t.name, logo: t.logo };
  });
  const { data: res } = await db.from("fixtures").select("home_team_id, away_team_id, ft_home, ft_away, date")
    .eq("league_id", leagueId).eq("is_sim", true).eq("archived", false).eq("status_short", "FT");
  const rows = computeStandings(
    teams,
    (res ?? []).map((r) => ({ home_team_id: r.home_team_id, away_team_id: r.away_team_id, home: r.ft_home ?? 0, away: r.ft_away ?? 0, date: r.date })),
    league?.name ?? "Lig",
  );
  await db.from("standings").upsert({ league_id: leagueId, season: league?.season ?? new Date().getFullYear(), data: [rows], updated_at: new Date().toISOString() }, { onConflict: "league_id" });
}

// =====================================================================
// Maç öncesi oranlar
// =====================================================================
async function refreshPrematch(db: SupabaseClient, leagues: Map<number, LeagueSim>, settings: SimSettings, now: Date): Promise<number> {
  const horizon = new Date(now.getTime() + PREMATCH_WINDOW_DAYS * 24 * 3600_000).toISOString();
  const todo: FixtureRow[] = [];

  // a) Hiç fiyatlanmamış maçlar
  const { data: fresh } = await db.from("fixtures").select("*")
    .eq("is_sim", true).eq("archived", false).eq("status_short", "NS")
    .lte("date", horizon).is("live_odds_at", null)
    .order("date").limit(PREMATCH_BATCH);
  todo.push(...((fresh ?? []) as FixtureRow[]));

  // b) Güçleri değişen ligler
  if (todo.length < PREMATCH_BATCH) {
    for (const l of leagues.values()) {
      if (!l.odds_dirty_at || !l.sim_started_at) continue;
      const limit = PREMATCH_BATCH - todo.length;
      if (limit <= 0) break;
      const { data: stale } = await db.from("fixtures").select("*")
        .eq("is_sim", true).eq("archived", false).eq("status_short", "NS").eq("league_id", l.id)
        .lte("date", horizon).lt("live_odds_at", l.odds_dirty_at)
        .order("date").limit(limit);
      const rows = (stale ?? []) as FixtureRow[];
      todo.push(...rows);
      if (rows.length < limit) {
        await db.from("leagues").update({ odds_dirty_at: null }).eq("id", l.id);
      }
    }
  }
  if (!todo.length) return 0;

  const teamIds = [...new Set(todo.flatMap((f) => [f.home_team_id, f.away_team_id]))];
  const ratings = await loadRatings(db, teamIds);
  const allRows: OddRow[] = [];
  for (const f of todo) {
    const exp = fixtureExpectation(ratings, f.home_team_id, f.away_team_id, totalRounds(leagues.get(f.league_id)));
    allRows.push(...priceOdds(f.id, computeProbabilities(exp, PRE_STATE), settings.margin, false));
  }
  await upsertChunked(db, "odds", allRows as unknown as Record<string, unknown>[], "fixture_id,market,selection,line");
  await db.from("fixtures").update({ live_odds_at: now.toISOString() }).in("id", todo.map((f) => f.id));
  return todo.length;
}

// =====================================================================
// fixture_details (olaylar + istatistikler, API-Football şekli)
// =====================================================================
async function loadTeams(db: SupabaseClient, ids: number[]): Promise<Map<number, TeamInfo>> {
  const { data } = await db.from("teams").select("id, name, logo").in("id", ids);
  return new Map((data ?? []).map((t) => [t.id as number, t as TeamInfo]));
}

async function writeDetails(db: SupabaseClient, f: FixtureRow, script: Script, teams: Map<number, TeamInfo>, k: number, final: boolean) {
  const home = teams.get(f.home_team_id) ?? { id: f.home_team_id, name: "Ev Sahibi", logo: null };
  const away = teams.get(f.away_team_id) ?? { id: f.away_team_id, name: "Deplasman", logo: null };
  const snap = snapshot(script, k);

  const events = snap.events.map((e) => {
    // API-Football: kendi kalesine golde takım = golü atan oyuncunun takımı
    const benefitsHome = e.side === "home";
    const teamSide = e.type === "Goal" && e.detail === "Own Goal" ? !benefitsHome : benefitsHome;
    const t = teamSide ? home : away;
    return {
      time: { elapsed: e.time.minute, extra: e.time.extra },
      team: { id: t.id, name: t.name, logo: t.logo },
      player: { id: e.player?.id ?? null, name: e.player?.name ?? null },
      assist: { id: e.assist?.id ?? null, name: e.assist?.name ?? null },
      type: e.type,
      detail: e.detail,
      comments: e.comments,
    };
  });

  const absMinute = k >= 999 ? 95 : k === 99 ? 47 : k >= 100 ? k - 100 : k;
  const progress = Math.min(1, absMinute / 95);
  const statsFor = (side: "home" | "away", t: TeamInfo) => {
    const s = script.stats[side];
    const shots = countUpTo(s.shots, k), sot = countUpTo(s.sot, k), corners = countUpTo(s.corners, k);
    const fouls = countUpTo(s.fouls, k), offsides = countUpTo(s.offsides, k), saves = countUpTo(s.saves, k);
    const blocked = Math.floor((shots - sot) * 0.3);
    const cards = snap.events.filter((e) => e.side === side && e.type === "Card");
    const yellow = cards.filter((e) => e.detail === "Yellow Card" || e.detail === "Second Yellow card").length;
    const red = cards.filter((e) => e.detail === "Red Card" || e.detail === "Second Yellow card").length;
    const passes = Math.round(s.passes * progress);
    return {
      team: { id: t.id, name: t.name, logo: t.logo },
      statistics: [
        { type: "Ball Possession", value: `${s.possession}%` },
        { type: "Total Shots", value: shots },
        { type: "Shots on Goal", value: sot },
        { type: "Shots off Goal", value: Math.max(0, shots - sot - blocked) },
        { type: "Blocked Shots", value: blocked },
        { type: "Corner Kicks", value: corners },
        { type: "Offsides", value: offsides },
        { type: "Fouls", value: fouls },
        { type: "Yellow Cards", value: yellow },
        { type: "Red Cards", value: red },
        { type: "Goalkeeper Saves", value: saves },
        { type: "Total passes", value: passes },
        { type: "Passes accurate", value: Math.round(passes * s.passAcc / 100) },
        { type: "Passes %", value: `${s.passAcc}%` },
      ],
    };
  };

  const { error } = await db.from("fixture_details").upsert({
    fixture_id: f.id,
    events,
    statistics: [statsFor("home", home), statsFor("away", away)],
    final,
    updated_at: new Date().toISOString(),
  }, { onConflict: "fixture_id" });
  if (error) throw error;
}
