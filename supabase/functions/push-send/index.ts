// Bildirim satırı düşünce Expo Push API ile iOS/Android cihaza iletir
import { adminClient, authorize, errMsg, json } from "../_shared/db.ts";

interface Payload {
  user_id?: string;
  title?: string;
  body?: string;
  type?: string;
  ref_id?: string | null;
  fixture_id?: number | null;
  id?: string | null;
}

/** Android 8+ kanal sesi kilitlenir; tür başına ayrı kanal + paketlenmiş wav. */
function soundForType(type?: string): { sound: string; channelId: string } {
  switch (type) {
    case "kickoff":
      return { sound: "kickoff.wav", channelId: "macoran-kickoff" };
    case "goal":
      return { sound: "goal.wav", channelId: "macoran-goal" };
    case "ft":
      return { sound: "fulltime.wav", channelId: "macoran-ft" };
    case "ht":
      return { sound: "ht.wav", channelId: "macoran-ht" };
    case "penalty":
      return { sound: "foul.wav", channelId: "macoran-foul" };
    case "pen_miss":
      return { sound: "miss.wav", channelId: "macoran-miss" };
    default:
      return { sound: "default", channelId: "macoran" };
  }
}

interface Ticket {
  status?: string;
  id?: string;
  message?: string;
  details?: { error?: string };
}

Deno.serve(async (req) => {
  const db = adminClient();
  if (!(await authorize(req, db))) return json({ error: "unauthorized" }, 401);

  let body: Payload = {};
  try {
    body = (await req.json()) as Payload;
  } catch {
    return json({ error: "invalid json" }, 400);
  }
  if (!body.user_id || !body.title) return json({ ok: true, skipped: "empty" });

  const { data: rows, error } = await db.from("push_tokens").select("token").eq("user_id", body.user_id);
  if (error) return json({ error: errMsg(error) }, 500);
  const tokens = (rows ?? []).map((r) => r.token as string).filter(Boolean);
  if (!tokens.length) return json({ ok: true, sent: 0 });

  const audio = soundForType(body.type);
  const messages = tokens.map((to) => ({
    to,
    sound: audio.sound,
    channelId: audio.channelId,
    priority: "high",
    ttl: 3600,
    title: body.title,
    body: body.body ?? "",
    data: {
      type: body.type ?? "",
      fixture_id: body.fixture_id ?? null,
      ref_id: body.ref_id ?? null,
      id: body.id ?? null,
    },
  }));

  const res = await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Accept-encoding": "gzip, deflate",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(messages),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) return json({ error: "expo push failed", detail: out }, 502);

  const tickets: Ticket[] = Array.isArray(out?.data) ? out.data : [out?.data];
  const stale = new Set<string>();
  const receiptIds: string[] = [];
  for (let i = 0; i < tickets.length; i++) {
    const t = tickets[i];
    if (t?.status === "error" && t?.details?.error === "DeviceNotRegistered") {
      stale.add(tokens[i]);
    } else if (t?.status === "ok" && t.id) {
      receiptIds.push(t.id);
    }
  }

  if (receiptIds.length) {
    await new Promise((r) => setTimeout(r, 2500));
    const recRes = await fetch("https://exp.host/--/api/v2/push/getReceipts", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ ids: receiptIds }),
    });
    const rec = await recRes.json().catch(() => ({}));
    const data = (rec?.data ?? {}) as Record<string, Ticket>;
    for (let i = 0; i < tickets.length; i++) {
      const id = tickets[i]?.id;
      if (!id) continue;
      const r = data[id];
      if (r?.status === "error" && r?.details?.error === "DeviceNotRegistered") {
        stale.add(tokens[i]);
      }
    }
  }

  if (stale.size) await db.from("push_tokens").delete().in("token", [...stale]);

  return json({ ok: true, sent: tokens.length, stale: stale.size });
});
