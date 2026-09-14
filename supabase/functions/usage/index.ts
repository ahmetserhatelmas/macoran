// API-Football istek kullanımı + senkron istatistikleri (sadece admin).
// GET /functions/v1/usage  (Authorization: Bearer <admin JWT>)
import { adminClient, apiKey, authorize, json, errMsg } from "../_shared/db.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface LogRow { job: string; ok: boolean; requests: number; message: string; created_at: string }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const db = adminClient();
  if (!(await authorize(req, db))) return json({ error: "unauthorized" }, 401);

  try {
    // 1) API-Football hesap durumu (1 istek)
    const statusRes = await fetch("https://v3.football.api-sports.io/status", {
      headers: { "x-apisports-key": apiKey() },
    });
    const statusJson = await statusRes.json();
    const status = statusJson.response ?? null;

    // 2) Son 7 günün senkron logları
    const since = new Date(Date.now() - 7 * 86400000).toISOString();
    const { data, error } = await db
      .from("sync_logs")
      .select("job, ok, requests, message, created_at")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(20000);
    if (error) throw error;
    const logs = (data ?? []) as LogRow[];

    const now = new Date();
    const todayKey = now.toISOString().slice(0, 10); // UTC gün (API-Football kotası UTC'de sıfırlanır)

    const perJobToday: Record<string, { runs: number; requests: number; errors: number }> = {};
    const daily: Record<string, number> = {};
    const hourly: Record<string, number> = {};
    const lastRun: Record<string, LogRow> = {};
    const errors: LogRow[] = [];

    for (let i = 0; i < 7; i++) daily[new Date(now.getTime() - i * 86400000).toISOString().slice(0, 10)] = 0;
    for (let i = 0; i < 24; i++) hourly[new Date(now.getTime() - i * 3600000).toISOString().slice(0, 13)] = 0;

    for (const l of logs) {
      const day = l.created_at.slice(0, 10);
      const hour = l.created_at.slice(0, 13);
      if (day in daily) daily[day] += l.requests;
      if (hour in hourly) hourly[hour] += l.requests;
      if (day === todayKey) {
        perJobToday[l.job] ??= { runs: 0, requests: 0, errors: 0 };
        perJobToday[l.job].runs++;
        perJobToday[l.job].requests += l.requests;
        if (!l.ok) perJobToday[l.job].errors++;
      }
      if (!lastRun[l.job]) lastRun[l.job] = l;
      if (!l.ok && errors.length < 15) errors.push(l);
    }

    // 3) DB sayıları
    const [fx, live, odds, users, bets, openBets] = await Promise.all([
      db.from("fixtures").select("id", { count: "exact", head: true }),
      db.from("fixtures").select("id", { count: "exact", head: true }).in("status_short", ["1H", "HT", "2H", "ET", "BT", "P", "SUSP", "INT", "LIVE"]),
      db.from("odds").select("fixture_id", { count: "exact", head: true }),
      db.from("profiles").select("id", { count: "exact", head: true }),
      db.from("bets").select("id", { count: "exact", head: true }),
      db.from("bets").select("id", { count: "exact", head: true }).eq("status", "pending"),
    ]);

    const todayLogged = Object.values(perJobToday).reduce((a, b) => a + b.requests, 0);
    const minuteOfDay = now.getUTCHours() * 60 + now.getUTCMinutes();
    const projected = minuteOfDay > 0 && status ? Math.round((status.requests.current / minuteOfDay) * 1440) : null;

    return new Response(
      JSON.stringify({
        generated_at: now.toISOString(),
        api: status,                 // account, subscription, requests {current, limit_day}
        projected_today: projected,  // günün sonunda tahmini toplam
        today_logged: todayLogged,   // sync_logs'a göre bugün
        per_job_today: perJobToday,
        daily: Object.entries(daily).sort().map(([day, requests]) => ({ day, requests })),
        hourly: Object.entries(hourly).sort().map(([hour, requests]) => ({ hour, requests })),
        last_run: lastRun,
        errors,
        db: {
          fixtures: fx.count ?? 0,
          live: live.count ?? 0,
          odds: odds.count ?? 0,
          users: users.count ?? 0,
          bets: bets.count ?? 0,
          open_bets: openBets.count ?? 0,
        },
      }),
      { headers: { ...CORS, "Content-Type": "application/json" } },
    );
  } catch (e) {
    const msg = errMsg(e);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...CORS, "Content-Type": "application/json" } });
  }
});
