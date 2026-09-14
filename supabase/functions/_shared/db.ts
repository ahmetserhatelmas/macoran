import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

export function adminClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(url, key, { auth: { persistSession: false } });
}

export function apiKey(): string {
  return Deno.env.get("API_FOOTBALL_KEY") ?? "";
}

/**
 * Sadece şu çağrılar kabul edilir:
 *  - x-cron-secret başlığı CRON_SECRET ile eşleşen (pg_cron)
 *  - Authorization: Bearer <service role key>
 *  - Authorization: Bearer <admin kullanıcının JWT'si>
 */
export async function authorize(req: Request, db: SupabaseClient): Promise<boolean> {
  const cronSecret = Deno.env.get("CRON_SECRET");
  const headerSecret = req.headers.get("x-cron-secret");
  if (cronSecret && headerSecret && headerSecret === cronSecret) return true;

  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token) return false;
  if (token === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) return true;

  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) return false;
  const { data: p } = await db.from("profiles").select("is_admin").eq("id", data.user.id).single();
  return !!p?.is_admin;
}

export async function log(db: SupabaseClient, job: string, ok: boolean, message: string, requests: number) {
  await db.from("sync_logs").insert({ job, ok, message: message.slice(0, 2000), requests });
  // Log tablosunu şişirme: 30 günden eski kayıtları sil (kullanım paneli 7 gün gösterir)
  const cutoff = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  await db.from("sync_logs").delete().lt("created_at", cutoff);
}

/** Hata nesnesini okunabilir mesaja çevirir (PostgrestError düz nesne olabilir). */
export function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object") {
    const o = e as Record<string, unknown>;
    const parts = [o.message, o.details, o.hint, o.code].filter((x) => typeof x === "string" && x);
    if (parts.length) return parts.join(" | ");
    try { return JSON.stringify(e); } catch { /* ignore */ }
  }
  return String(e);
}

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function getActiveLeagues(db: SupabaseClient) {
  const { data, error } = await db
    .from("leagues")
    .select("id, season, name")
    .eq("is_active", true)
    .order("sort_order");
  if (error) throw error;
  return data as { id: number; season: number; name: string }[];
}

/** Büyük upsert'leri parçalara böl */
export async function upsertChunked(
  db: SupabaseClient,
  table: string,
  rows: Record<string, unknown>[],
  onConflict?: string,
  size = 500,
) {
  const parts: Record<string, unknown>[][] = [];
  for (let i = 0; i < rows.length; i += size) parts.push(rows.slice(i, i + size));
  // Parçalar paralel gider (en fazla 4 eşzamanlı istek)
  for (let i = 0; i < parts.length; i += 4) {
    const results = await Promise.all(
      parts.slice(i, i + 4).map((part) => db.from(table).upsert(part, onConflict ? { onConflict } : undefined)),
    );
    for (const { error } of results) if (error) throw new Error(`${table} upsert: ${error.message}`);
  }
}
