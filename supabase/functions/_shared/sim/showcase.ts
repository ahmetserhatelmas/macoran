// Vitrin hesabı: akışta ve sıralamada görünen, adminin açıp sildiği kuponlar.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

type LegIn = { fixture_id?: unknown; won?: unknown };

const FINISHED = new Set(["FT", "AET", "PEN"]);

function istanbulStart(kind: "day" | "week"): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(new Date());
  const y = Number(parts.find((p) => p.type === "year")!.value);
  const m = Number(parts.find((p) => p.type === "month")!.value);
  const d = Number(parts.find((p) => p.type === "day")!.value);
  const midnight = new Date(Date.UTC(y, m - 1, d, -3, 0, 0));
  if (kind === "day") return midnight.toISOString();
  const back: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  const wd = parts.find((p) => p.type === "weekday")!.value;
  return new Date(midnight.getTime() - (back[wd] ?? 0) * 86_400_000).toISOString();
}

function cleanName(raw: unknown): string {
  const name = String(raw ?? "").trim();
  if (!/^[\p{L}\p{N}_]{3,20}$/u.test(name)) throw new Error("Kullanıcı adı 3-20 karakter, harf rakam veya alt çizgi olmalı");
  return name;
}

async function showcaseOrThrow(db: SupabaseClient, userId: string) {
  const { data, error } = await db.from("profiles").select("id, is_showcase").eq("id", userId).maybeSingle();
  if (error) throw error;
  if (!data?.is_showcase) throw new Error("Bu hesap vitrin hesabı değil");
  return data;
}

export async function showcaseList(db: SupabaseClient) {
  const { data: profiles, error } = await db.from("profiles").select("id, username").eq("is_showcase", true).order("created_at", { ascending: false });
  if (error) throw error;
  const ids = (profiles ?? []).map((p) => p.id as string);
  if (!ids.length) return { accounts: [] };
  const { data: bets, error: bErr } = await db
    .from("bets")
    .select("id, user_id, stake, payout, total_odd, status, settled_at, created_at, bet_selections(home_name, away_name, selection, odd, status, result_home, result_away)")
    .in("user_id", ids)
    .order("created_at", { ascending: false });
  if (bErr) throw bErr;
  const { data: shares, error: sErr } = await db.from("shared_coupons").select("bet_id, note, show_stake").in("user_id", ids);
  if (sErr) throw sErr;
  const shareByBet = new Map((shares ?? []).map((s) => [s.bet_id as string, s]));
  const weekFrom = istanbulStart("week");
  const dayFrom = istanbulStart("day");
  return {
    accounts: (profiles ?? []).map((p) => {
      const mine = (bets ?? []).filter((b) => b.user_id === p.id);
      const wonSum = (from: string | null) => mine
        .filter((b) => (b.status === "won" || b.status === "cashed") && (from == null || String(b.settled_at ?? "") >= from))
        .reduce((a, b) => a + Number(b.payout ?? 0), 0);
      return {
        id: p.id,
        username: p.username,
        day: Math.round(wonSum(dayFrom) * 100) / 100,
        week: Math.round(wonSum(weekFrom) * 100) / 100,
        total: Math.round(wonSum(null) * 100) / 100,
        coupons: mine.map((b) => {
          const share = shareByBet.get(b.id as string);
          return {
            bet_id: b.id,
            status: b.status,
            stake: Number(b.stake),
            payout: Number(b.payout ?? 0),
            total_odd: Number(b.total_odd),
            settled_at: b.settled_at,
            note: share?.note ?? null,
            show_stake: share?.show_stake !== false,
            legs: ((b.bet_selections ?? []) as {
              home_name: string | null; away_name: string | null; selection: string; odd: number;
              status: string; result_home: number | null; result_away: number | null;
            }[]).map((s) => ({
              home: s.home_name,
              away: s.away_name,
              selection: s.selection,
              odd: Number(s.odd),
              status: s.status,
              score: s.result_home != null ? `${s.result_home}-${s.result_away}` : null,
            })),
          };
        }),
      };
    }),
  };
}

export async function showcaseCreateUser(db: SupabaseClient, body: Record<string, unknown>) {
  const username = cleanName(body.username);
  const { data: taken } = await db.from("profiles").select("id").eq("username", username).maybeSingle();
  if (taken) throw new Error("Bu kullanıcı adı alınmış");
  const email = `vitrin.${crypto.randomUUID().slice(0, 8)}@macoran.app`;
  const password = crypto.randomUUID() + crypto.randomUUID();
  const { data, error } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { username },
  });
  if (error || !data.user) throw new Error(error?.message ?? "Hesap açılamadı");
  const { error: upErr } = await db.from("profiles").update({ is_showcase: true, username }).eq("id", data.user.id);
  if (upErr) {
    await db.auth.admin.deleteUser(data.user.id);
    throw upErr;
  }
  return { ok: true, id: data.user.id, username };
}

export async function showcaseRename(db: SupabaseClient, body: Record<string, unknown>) {
  const userId = String(body.user_id ?? "");
  await showcaseOrThrow(db, userId);
  const username = cleanName(body.username);
  const { data: taken } = await db.from("profiles").select("id").eq("username", username).neq("id", userId).maybeSingle();
  if (taken) throw new Error("Bu kullanıcı adı alınmış");
  const { error } = await db.from("profiles").update({ username }).eq("id", userId);
  if (error) throw error;
  return { ok: true, username };
}

export async function showcaseDeleteUser(db: SupabaseClient, body: Record<string, unknown>) {
  const userId = String(body.user_id ?? "");
  await showcaseOrThrow(db, userId);
  const { error } = await db.auth.admin.deleteUser(userId);
  if (error) throw new Error(error.message);
  return { ok: true };
}

/** Bu kuponun ödemesi, hesabı seçilen listenin birincisi yapacak tutar. */
async function payoutToLead(db: SupabaseClient, board: "day" | "week" | "total", userId: string, ignoreBetId: string | null) {
  const from = board === "total" ? null : istanbulStart(board);
  let q = db.from("bets").select("id, user_id, payout").in("status", ["won", "cashed"]);
  if (from) q = q.gte("settled_at", from);
  const { data, error } = await q;
  if (error) throw error;
  const sums = new Map<string, number>();
  for (const row of data ?? []) {
    if (ignoreBetId && row.id === ignoreBetId) continue;
    const id = row.user_id as string;
    sums.set(id, (sums.get(id) ?? 0) + Number(row.payout ?? 0));
  }
  let top = 0;
  for (const [id, sum] of sums) if (id !== userId && sum > top) top = sum;
  const mine = sums.get(userId) ?? 0;
  return Math.max(50, Math.round((top - mine + 250) * 100) / 100);
}

function resultPick(home: number, away: number, won: boolean): "1" | "X" | "2" {
  const actual: "1" | "X" | "2" = home > away ? "1" : home < away ? "2" : "X";
  if (won) return actual;
  if (actual === "X") return "1";
  return actual === "1" ? "2" : "1";
}

export async function showcaseCreateCoupon(db: SupabaseClient, body: Record<string, unknown>) {
  const userId = String(body.user_id ?? "");
  await showcaseOrThrow(db, userId);
  const legsIn = (Array.isArray(body.legs) ? body.legs : []) as LegIn[];
  if (legsIn.length < 1 || legsIn.length > 8) throw new Error("1 ile 8 maç seç");
  const stake = Math.round(Number(body.stake) * 100) / 100;
  if (!Number.isFinite(stake) || stake < 10 || stake > 100_000) throw new Error("Tutar 10 ile 100.000 arasında olmalı");
  const ids = [...new Set(legsIn.map((l) => Number(l.fixture_id)).filter((n) => n > 0))];
  const { data: fixtures, error } = await db
    .from("fixtures")
    .select("id, date, status_short, home_goals, away_goals, home:teams!home_team_id(name), away:teams!away_team_id(name), league:leagues(name)")
    .in("id", ids);
  if (error) throw error;
  const byId = new Map((fixtures ?? []).map((f) => [Number(f.id), f]));
  const legs = legsIn.map((raw) => {
    const f = byId.get(Number(raw.fixture_id));
    if (!f || !FINISHED.has(String(f.status_short)) || f.home_goals == null || f.away_goals == null) {
      throw new Error("Sadece sonucu belli maçlar eklenebilir");
    }
    const won = raw.won !== false;
    const home = f.home as { name?: string } | { name?: string }[] | null;
    const away = f.away as { name?: string } | { name?: string }[] | null;
    const league = f.league as { name?: string } | { name?: string }[] | null;
    const homeName = Array.isArray(home) ? home[0]?.name : home?.name;
    const awayName = Array.isArray(away) ? away[0]?.name : away?.name;
    const leagueName = Array.isArray(league) ? league[0]?.name : league?.name;
    return {
      fixture_id: Number(f.id),
      won,
      selection: resultPick(Number(f.home_goals), Number(f.away_goals), won),
      home_name: homeName ?? "",
      away_name: awayName ?? "",
      league_name: leagueName ?? "",
      fixture_date: f.date as string,
      result_home: Number(f.home_goals),
      result_away: Number(f.away_goals),
    };
  });
  const allWon = legs.every((l) => l.won);
  const place = body.place === "day" || body.place === "week" || body.place === "total" ? body.place : null;
  if (place && !allWon) throw new Error("Sıralamaya girmek için bütün maçların tutması gerekir");
  let payout = 0;
  if (allWon) {
    if (place) payout = Math.max(stake + 50, await payoutToLead(db, place, userId, null));
    else {
      payout = Math.round(Number(body.payout) * 100) / 100;
      if (!Number.isFinite(payout) || payout < stake) throw new Error("Kazanç, tutardan büyük olmalı");
    }
  }
  const totalOdd = allWon ? Math.round((payout / stake) * 1000) / 1000 : 1.8;
  const eachOdd = Math.round(Math.pow(totalOdd, 1 / legs.length) * 1000) / 1000;
  const now = new Date().toISOString();
  const { data: bet, error: betErr } = await db.from("bets").insert({
    user_id: userId,
    stake,
    total_odd: totalOdd,
    potential_win: Math.round(stake * totalOdd * 100) / 100,
    payout: allWon ? payout : 0,
    status: allWon ? "won" : "lost",
    created_at: now,
    settled_at: now,
  }).select("id").single();
  if (betErr) throw betErr;
  const { error: selErr } = await db.from("bet_selections").insert(legs.map((l) => ({
    bet_id: bet.id,
    fixture_id: l.fixture_id,
    market: "1X2",
    selection: l.selection,
    line: 0,
    odd: eachOdd,
    is_live: false,
    home_name: l.home_name,
    away_name: l.away_name,
    league_name: l.league_name,
    fixture_date: l.fixture_date,
    status: l.won ? "won" : "lost",
    result_home: l.result_home,
    result_away: l.result_away,
  })));
  if (selErr) throw selErr;
  const note = String(body.note ?? "").trim().slice(0, 160) || null;
  const { error: shareErr } = await db.from("shared_coupons").insert({
    user_id: userId,
    bet_id: bet.id,
    note,
    show_stake: body.show_stake !== false,
  });
  if (shareErr) throw shareErr;
  return { ok: true, bet_id: bet.id, status: allWon ? "won" : "lost", payout: allWon ? payout : 0 };
}

export async function showcaseUpdateCoupon(db: SupabaseClient, body: Record<string, unknown>) {
  const betId = String(body.bet_id ?? "");
  const { data: bet, error } = await db.from("bets").select("id, user_id, status, stake").eq("id", betId).maybeSingle();
  if (error) throw error;
  if (!bet) throw new Error("Kupon bulunamadı");
  await showcaseOrThrow(db, bet.user_id as string);
  const stake = body.stake === undefined ? Number(bet.stake) : Math.round(Number(body.stake) * 100) / 100;
  if (!Number.isFinite(stake) || stake < 10 || stake > 100_000) throw new Error("Tutar 10 ile 100.000 arasında olmalı");
  const won = bet.status === "won" || bet.status === "cashed";
  const place = body.place === "day" || body.place === "week" || body.place === "total" ? body.place : null;
  if (place && !won) throw new Error("Kayıp kupon sıralamaya girmez");
  let payout = 0;
  if (won) {
    payout = place
      ? Math.max(stake + 50, await payoutToLead(db, place, bet.user_id as string, betId))
      : Math.round(Number(body.payout) * 100) / 100;
    if (!Number.isFinite(payout) || payout < stake) throw new Error("Kazanç, tutardan büyük olmalı");
  }
  const totalOdd = won ? Math.round((payout / stake) * 1000) / 1000 : Number(bet.stake) ? 1.8 : 1.8;
  const { error: upErr } = await db.from("bets").update({
    stake,
    payout: won ? payout : 0,
    total_odd: totalOdd,
    potential_win: Math.round(stake * totalOdd * 100) / 100,
    settled_at: new Date().toISOString(),
  }).eq("id", betId);
  if (upErr) throw upErr;
  if (body.note !== undefined || body.show_stake !== undefined) {
    const patch: Record<string, unknown> = {};
    if (body.note !== undefined) patch.note = String(body.note ?? "").trim().slice(0, 160) || null;
    if (body.show_stake !== undefined) patch.show_stake = body.show_stake !== false;
    const { error: sErr } = await db.from("shared_coupons").update(patch).eq("bet_id", betId);
    if (sErr) throw sErr;
  }
  return { ok: true, payout: won ? payout : 0 };
}

export async function showcaseDeleteCoupon(db: SupabaseClient, body: Record<string, unknown>) {
  const betId = String(body.bet_id ?? "");
  const { data: bet, error } = await db.from("bets").select("id, user_id").eq("id", betId).maybeSingle();
  if (error) throw error;
  if (!bet) throw new Error("Kupon bulunamadı");
  await showcaseOrThrow(db, bet.user_id as string);
  const { error: delErr } = await db.from("bets").delete().eq("id", betId);
  if (delErr) throw delErr;
  return { ok: true };
}
