// Gerçek sezon fikstürü + ligin tipik maç günlerine göre tahmin.
// API tarihleri start_at'e haftalık hizalanır (gün/saat korunur).
// UEFA kulüp kupaları (2/3/848) Salı–Çarşamba–Perşembe'ye kilitlenir.
// Tarihi belirsiz veya hiç yayınlanmamış haftalar ritme göre doldurulur.

import type { ApiFixture } from "../api.ts";
import { singleRoundRobin, type ScheduleConfig, type ScheduledMatch } from "./league.ts";
import { Rng } from "./rng.ts";

export interface PlannedMatch extends ScheduledMatch {
  roundLabel: string;
  venue?: string | null;
  estimated?: boolean;
}

export interface CalendarResult {
  matches: PlannedMatch[];
  source: "api" | "rhythm";
  estimated: number;
}

/** ISO weekday 1=Pzt … 7=Paz, saat ligin yerel diliminde */
interface Slot {
  dow: number;
  hour: number;
  minute: number;
}

interface Rhythm {
  /** ligin yerel UTC ofseti (dk); DST yok sayılır, tahmin için yeter */
  tz: number;
  slots: Slot[];
  midweek?: Slot[];
  weekGapDays: number;
}

const CUPS = new Set([2, 3, 848, 13]);

const SAT_SUN: Slot[] = [
  { dow: 6, hour: 16, minute: 0 },
  { dow: 6, hour: 19, minute: 0 },
  { dow: 7, hour: 16, minute: 0 },
  { dow: 7, hour: 19, minute: 0 },
];
const FRI_MON_EU: Slot[] = [
  { dow: 5, hour: 20, minute: 30 },
  { dow: 6, hour: 15, minute: 30 },
  { dow: 6, hour: 18, minute: 30 },
  { dow: 7, hour: 15, minute: 30 },
  { dow: 7, hour: 17, minute: 30 },
];
const MID_TW: Slot[] = [
  { dow: 2, hour: 20, minute: 0 },
  { dow: 3, hour: 20, minute: 0 },
];
const MID_UCL: Slot[] = [
  { dow: 2, hour: 18, minute: 45 },
  { dow: 2, hour: 21, minute: 0 },
  { dow: 3, hour: 18, minute: 45 },
  { dow: 3, hour: 21, minute: 0 },
];
/** Şampiyonlar / Avrupa / Konferans: Salı–Perşembe */
const MID_UEFA: Slot[] = [
  ...MID_UCL,
  { dow: 4, hour: 18, minute: 45 },
  { dow: 4, hour: 21, minute: 0 },
];

const TZ = {
  tr: 180,
  uk: 60,
  eu: 120,
  pt: 60,
  br: -180,
  ar: -180,
  us: -240,
  mx: -360,
  sa: 180,
  jp: 540,
  kr: 540,
  az: 240,
};

/** Lig id → tipik maç günleri (API tarihi yoksa / belirsizse). */
const RHYTHM: Record<number, Rhythm> = {
  203: { // Süper Lig: Cuma–Pazartesi
    tz: TZ.tr, weekGapDays: 7,
    slots: [
      { dow: 5, hour: 20, minute: 0 },
      { dow: 6, hour: 13, minute: 0 },
      { dow: 6, hour: 16, minute: 0 },
      { dow: 6, hour: 19, minute: 0 },
      { dow: 7, hour: 16, minute: 0 },
      { dow: 7, hour: 19, minute: 0 },
      { dow: 1, hour: 20, minute: 0 },
    ],
    midweek: MID_TW,
  },
  204: { tz: TZ.tr, weekGapDays: 7, slots: SAT_SUN, midweek: MID_TW },
  39: { // Premier League
    tz: TZ.uk, weekGapDays: 7,
    slots: [
      { dow: 6, hour: 12, minute: 30 },
      { dow: 6, hour: 15, minute: 0 },
      { dow: 6, hour: 17, minute: 30 },
      { dow: 7, hour: 14, minute: 0 },
      { dow: 7, hour: 16, minute: 30 },
      { dow: 1, hour: 20, minute: 0 },
    ],
    midweek: [{ dow: 2, hour: 20, minute: 0 }, { dow: 3, hour: 19, minute: 30 }],
  },
  140: {
    tz: TZ.eu, weekGapDays: 7,
    slots: [
      { dow: 5, hour: 21, minute: 0 },
      { dow: 6, hour: 14, minute: 0 },
      { dow: 6, hour: 16, minute: 15 },
      { dow: 6, hour: 18, minute: 30 },
      { dow: 6, hour: 21, minute: 0 },
      { dow: 7, hour: 14, minute: 0 },
      { dow: 7, hour: 16, minute: 15 },
      { dow: 7, hour: 18, minute: 30 },
      { dow: 7, hour: 21, minute: 0 },
      { dow: 1, hour: 21, minute: 0 },
    ],
    midweek: MID_TW,
  },
  135: {
    tz: TZ.eu, weekGapDays: 7,
    slots: [
      { dow: 6, hour: 15, minute: 0 },
      { dow: 6, hour: 18, minute: 0 },
      { dow: 6, hour: 20, minute: 45 },
      { dow: 7, hour: 12, minute: 30 },
      { dow: 7, hour: 15, minute: 0 },
      { dow: 7, hour: 18, minute: 0 },
      { dow: 7, hour: 20, minute: 45 },
      { dow: 1, hour: 20, minute: 45 },
    ],
    midweek: MID_TW,
  },
  78: { tz: TZ.eu, weekGapDays: 7, slots: FRI_MON_EU, midweek: MID_TW },
  79: { tz: TZ.eu, weekGapDays: 7, slots: FRI_MON_EU, midweek: MID_TW },
  61: {
    tz: TZ.eu, weekGapDays: 7,
    slots: [
      { dow: 5, hour: 20, minute: 45 },
      { dow: 6, hour: 17, minute: 0 },
      { dow: 6, hour: 21, minute: 0 },
      { dow: 7, hour: 15, minute: 0 },
      { dow: 7, hour: 17, minute: 0 },
      { dow: 7, hour: 20, minute: 45 },
    ],
    midweek: MID_TW,
  },
  62: { tz: TZ.eu, weekGapDays: 7, slots: SAT_SUN.map((s) => ({ ...s })), midweek: MID_TW },
  88: {
    tz: TZ.eu, weekGapDays: 7,
    slots: [
      { dow: 5, hour: 20, minute: 0 },
      { dow: 6, hour: 16, minute: 30 },
      { dow: 6, hour: 18, minute: 45 },
      { dow: 6, hour: 20, minute: 0 },
      { dow: 7, hour: 14, minute: 30 },
      { dow: 7, hour: 16, minute: 45 },
    ],
  },
  94: {
    tz: TZ.pt, weekGapDays: 7,
    slots: [
      { dow: 5, hour: 20, minute: 15 },
      { dow: 6, hour: 15, minute: 30 },
      { dow: 6, hour: 18, minute: 0 },
      { dow: 6, hour: 20, minute: 30 },
      { dow: 7, hour: 18, minute: 0 },
      { dow: 7, hour: 20, minute: 30 },
    ],
  },
  144: { tz: TZ.eu, weekGapDays: 7, slots: SAT_SUN, midweek: MID_TW },
  179: {
    tz: TZ.uk, weekGapDays: 7,
    slots: [
      { dow: 6, hour: 15, minute: 0 },
      { dow: 7, hour: 12, minute: 0 },
      { dow: 7, hour: 15, minute: 0 },
    ],
  },
  40: {
    tz: TZ.uk, weekGapDays: 7,
    slots: [
      { dow: 5, hour: 20, minute: 0 },
      { dow: 6, hour: 12, minute: 30 },
      { dow: 6, hour: 15, minute: 0 },
      { dow: 7, hour: 12, minute: 0 },
    ],
  },
  141: { tz: TZ.eu, weekGapDays: 7, slots: SAT_SUN, midweek: MID_TW },
  136: { tz: TZ.eu, weekGapDays: 7, slots: SAT_SUN, midweek: MID_TW },
  218: { tz: TZ.eu, weekGapDays: 7, slots: SAT_SUN },
  197: { tz: TZ.eu, weekGapDays: 7, slots: SAT_SUN },
  71: {
    tz: TZ.br, weekGapDays: 7,
    slots: [
      { dow: 6, hour: 16, minute: 0 },
      { dow: 6, hour: 18, minute: 30 },
      { dow: 6, hour: 21, minute: 0 },
      { dow: 7, hour: 16, minute: 0 },
      { dow: 7, hour: 18, minute: 30 },
      { dow: 7, hour: 20, minute: 0 },
    ],
    midweek: [{ dow: 3, hour: 19, minute: 30 }, { dow: 4, hour: 20, minute: 0 }],
  },
  128: { tz: TZ.ar, weekGapDays: 7, slots: SAT_SUN.concat([{ dow: 1, hour: 21, minute: 0 }]), midweek: MID_TW },
  253: { tz: TZ.us, weekGapDays: 7, slots: SAT_SUN },
  262: {
    tz: TZ.mx, weekGapDays: 7,
    slots: [
      { dow: 5, hour: 19, minute: 0 },
      { dow: 6, hour: 17, minute: 0 },
      { dow: 6, hour: 19, minute: 0 },
      { dow: 6, hour: 21, minute: 0 },
      { dow: 7, hour: 12, minute: 0 },
      { dow: 7, hour: 18, minute: 0 },
    ],
  },
  307: {
    tz: TZ.sa, weekGapDays: 7,
    slots: [
      { dow: 4, hour: 18, minute: 0 },
      { dow: 4, hour: 21, minute: 0 },
      { dow: 5, hour: 17, minute: 0 },
      { dow: 5, hour: 19, minute: 30 },
      { dow: 5, hour: 22, minute: 0 },
      { dow: 6, hour: 17, minute: 0 },
      { dow: 6, hour: 19, minute: 30 },
    ],
  },
  98: {
    tz: TZ.jp, weekGapDays: 7,
    slots: [
      { dow: 6, hour: 14, minute: 0 },
      { dow: 6, hour: 19, minute: 0 },
      { dow: 7, hour: 14, minute: 0 },
      { dow: 7, hour: 16, minute: 0 },
    ],
  },
  292: { tz: TZ.kr, weekGapDays: 7, slots: SAT_SUN },
  419: { tz: TZ.az, weekGapDays: 7, slots: SAT_SUN.concat([{ dow: 5, hour: 20, minute: 0 }]) },
  2: { tz: TZ.eu, weekGapDays: 14, slots: MID_UEFA },
  3: { tz: TZ.eu, weekGapDays: 14, slots: MID_UEFA },
  848: { tz: TZ.eu, weekGapDays: 14, slots: MID_UEFA },
  13: { tz: TZ.br, weekGapDays: 14, slots: MID_UCL },
};

const DEFAULT_RHYTHM: Rhythm = {
  tz: TZ.tr,
  weekGapDays: 7,
  slots: [
    { dow: 5, hour: 20, minute: 0 },
    { dow: 6, hour: 16, minute: 0 },
    { dow: 6, hour: 19, minute: 0 },
    { dow: 7, hour: 16, minute: 0 },
    { dow: 7, hour: 19, minute: 0 },
  ],
  midweek: MID_TW,
};

export function leagueRhythm(leagueId: number): Rhythm {
  return RHYTHM[leagueId] ?? DEFAULT_RHYTHM;
}

export function isCupLeague(leagueId: number): boolean {
  return CUPS.has(leagueId);
}

/** UEFA kulüp kupaları: Salı / Çarşamba / Perşembe */
export function isUefaClubCup(leagueId: number): boolean {
  return leagueId === 2 || leagueId === 3 || leagueId === 848;
}

/**
 * Kupa ana aşaması: lig/grup. Ön eleme, play-off ve eleme turları dışarıda.
 * UCL/UEL/UECL "League Stage", Libertadores "Group Stage".
 */
export function isCupMainStageRound(raw: string | null | undefined): boolean {
  if (!raw) return false;
  if (/qualif|preliminary|pre.?elim/i.test(raw)) return false;
  if (/knockout|round of\s*\d+|8th final|quarter-?final|semi-?final|(?:^|\s)finals?$/i.test(raw)) return false;
  if (/play-?offs?/i.test(raw)) return false;
  return true;
}

export function filterCupMainFixtures<T extends { league?: { round?: string | null } | null }>(fixtures: T[]): T[] {
  return fixtures.filter((f) => isCupMainStageRound(f.league?.round ?? ""));
}

export function parseRoundNum(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const m = raw.match(/(?:regular season|regular season\s*-|hafta|matchday|jornada|round|spieltag)\s*-?\s*(\d+)/i)
    ?? raw.match(/(\d+)\s*$/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function displayRound(raw: string | null | undefined, fallback: number): string {
  if (!raw) return `${fallback}. Hafta`;
  if (/regular season/i.test(raw)) {
    const n = parseRoundNum(raw);
    if (n) return `${n}. Hafta`;
  }
  return raw;
}

function expandSlots(r: Rhythm, n: number): Slot[] {
  const out = [...r.slots];
  if (r.midweek) out.push(...r.midweek);
  const uefaOnly = !r.midweek && r.slots.length > 0 && r.slots.every((s) => s.dow >= 2 && s.dow <= 4);
  let i = 0;
  while (out.length < n) {
    if (uefaOnly) {
      out.push(r.slots[out.length % r.slots.length]);
      continue;
    }
    const base = r.slots[i % r.slots.length];
    const bump = 150 * (1 + Math.floor(i / r.slots.length));
    let minute = base.minute + bump;
    let hour = base.hour + Math.floor(minute / 60);
    minute %= 60;
    let dow = base.dow;
    while (hour >= 24) { hour -= 24; dow = dow === 7 ? 1 : dow + 1; }
    out.push({ dow, hour, minute });
    i++;
  }
  return out.slice(0, n);
}

/** Maç haftasının başlangıç weekday'i (ISO 1–7). Hafta sonu ligleri Perşembe, kupa Salı. */
function weekOriginDow(r: Rhythm): number {
  const dows = r.slots.map((s) => s.dow);
  if (dows.every((d) => d >= 2 && d <= 4)) return Math.min(...dows);
  return 4;
}

/** Lig yereli: bu maç haftasının origin günü 00:00 */
function weekOrigin(anchor: Date, r: Rhythm): Date {
  const origin = weekOriginDow(r);
  const local = new Date(anchor.getTime() + r.tz * 60_000);
  const jsDow = local.getUTCDay(); // 0=Paz
  const iso = jsDow === 0 ? 7 : jsDow;
  const since = (iso - origin + 7) % 7;
  const midnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - r.tz * 60_000;
  return new Date(midnight - since * 86400_000);
}

function slotUtc(origin: Date, slot: Slot, r: Rhythm): Date {
  const start = weekOriginDow(r);
  const days = (slot.dow - start + 7) % 7;
  return new Date(origin.getTime() + days * 86400_000 + (slot.hour * 60 + slot.minute) * 60_000);
}

function applySlots(n: number, weekAnchor: Date, r: Rhythm): Date[] {
  const origin = weekOrigin(weekAnchor, r);
  return expandSlots(r, n).map((s) => slotUtc(origin, s, r));
}

function isVagueDate(d: Date, status?: string): boolean {
  if (status === "TBD") return true;
  return d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0;
}

function alignShift(first: Date, startAt: Date): number {
  const DAY = 86400_000;
  const firstDow = new Date(first.getTime() + 180 * 60_000).getUTCDay();
  const startLocal = new Date(startAt.getTime() + 180 * 60_000);
  const startDow = startLocal.getUTCDay();
  const addDays = (firstDow - startDow + 7) % 7;
  const startMid = Date.UTC(startLocal.getUTCFullYear(), startLocal.getUTCMonth(), startLocal.getUTCDate()) - 180 * 60_000;
  const tod = (first.getTime() - (Date.UTC(
    new Date(first.getTime() + 180 * 60_000).getUTCFullYear(),
    new Date(first.getTime() + 180 * 60_000).getUTCMonth(),
    new Date(first.getTime() + 180 * 60_000).getUTCDate(),
  ) - 180 * 60_000));
  let aligned = startMid + addDays * DAY + tod;
  if (aligned < startAt.getTime()) aligned += 7 * DAY;
  return aligned - first.getTime();
}

const TR_MS = 180 * 60_000;

function trParts(d: Date) {
  const t = new Date(d.getTime() + TR_MS);
  return {
    y: t.getUTCFullYear(), mo: t.getUTCMonth(), da: t.getUTCDate(),
    dow: t.getUTCDay(), h: t.getUTCHours(), mi: t.getUTCMinutes(),
  };
}

function atTr(y: number, mo: number, da: number, h: number, mi: number) {
  return new Date(Date.UTC(y, mo, da, h, mi) - TR_MS);
}

function isUefaDow(dow: number) {
  return dow === 2 || dow === 3 || dow === 4;
}

/** İlk maçın Salı/Çar/Per gününü koru; sezon başlangıcından sonraki ilk o güne hizala. */
function alignUefaShift(first: Date, startAt: Date): number {
  const p = trParts(first);
  const want = isUefaDow(p.dow) ? p.dow : 2;
  const s = trParts(startAt);
  let d = atTr(s.y, s.mo, s.da, p.h, p.mi);
  for (let i = 0; i < 14; i++) {
    if (trParts(d).dow === want && d.getTime() >= startAt.getTime() - 60_000) break;
    d = new Date(d.getTime() + 86400_000);
  }
  return d.getTime() - first.getTime();
}

export function snapToUefaMidweek(d: Date): Date {
  const p = trParts(d);
  const h = p.h >= 17 ? p.h : 21;
  const mi = p.h >= 17 ? p.mi : 0;
  if (isUefaDow(p.dow)) return atTr(p.y, p.mo, p.da, h, mi);
  const add = ((2 - p.dow + 7) % 7) || 7;
  return atTr(p.y, p.mo, p.da + add, h, mi);
}

function nextUefaSlot(t: number): number {
  const p = trParts(new Date(t));
  if (p.dow === 2) return atTr(p.y, p.mo, p.da + 1, p.h, p.mi).getTime();
  if (p.dow === 3) return atTr(p.y, p.mo, p.da + 1, p.h, p.mi).getTime();
  return atTr(p.y, p.mo, p.da + ((2 - p.dow + 7) % 7 || 7), p.h, p.mi).getTime();
}

interface RawRow {
  home: number;
  away: number;
  date: Date;
  vague: boolean;
  roundRaw: string;
  venue: string | null;
}

export function teamsFromFixtures(fixtures: ApiFixture[]): { id: number; name: string; logo: string }[] {
  const m = new Map<number, { id: number; name: string; logo: string }>();
  for (const f of fixtures) {
    if (f.teams?.home?.id) m.set(f.teams.home.id, { id: f.teams.home.id, name: f.teams.home.name, logo: f.teams.home.logo });
    if (f.teams?.away?.id) m.set(f.teams.away.id, { id: f.teams.away.id, name: f.teams.away.name, logo: f.teams.away.logo });
  }
  return [...m.values()];
}

function usableApiRows(fixtures: ApiFixture[], teamIds: Set<number>): RawRow[] {
  const out: RawRow[] = [];
  const seen = new Set<string>();
  for (const f of fixtures) {
    const raw = f.league?.round ?? "";
    if (/friendly/i.test(raw)) continue;
    const home = f.teams?.home?.id;
    const away = f.teams?.away?.id;
    if (!home || !away || home === away) continue;
    if (teamIds.size && (!teamIds.has(home) || !teamIds.has(away))) continue;
    const key = `${raw}|${home}|${away}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const date = new Date(f.fixture.date);
    if (Number.isNaN(date.getTime())) continue;
    out.push({
      home, away, date,
      vague: isVagueDate(date, f.fixture.status?.short),
      roundRaw: raw,
      venue: f.fixture.venue?.name ?? null,
    });
  }
  return out;
}

function resolveRoundDates(rows: RawRow[], r: Rhythm): { date: Date; estimated: boolean }[] {
  if (!rows.length) return [];
  const precise = rows.filter((x) => !x.vague);
  const allSame = rows.every((x) => x.date.getTime() === rows[0].date.getTime());
  if (precise.length === rows.length && !allSame) {
    return rows.map((x) => ({ date: x.date, estimated: false }));
  }
  const anchor = (precise[0] ?? rows[0]).date;
  const slots = applySlots(rows.length, anchor, r);
  // Net tarihli maçların saatini koru; belirsizlere boş slot ver
  const used = new Set<number>();
  const out: { date: Date; estimated: boolean }[] = rows.map(() => ({ date: anchor, estimated: true }));
  rows.forEach((row, i) => {
    if (row.vague || allSame) return;
    out[i] = { date: row.date, estimated: false };
    const nearest = slots.findIndex((s, si) => !used.has(si) && Math.abs(s.getTime() - row.date.getTime()) < 3 * 3600_000);
    if (nearest >= 0) used.add(nearest);
  });
  let si = 0;
  rows.forEach((row, i) => {
    if (!row.vague && !allSame) return;
    while (used.has(si) && si < slots.length) si++;
    out[i] = { date: slots[Math.min(si, slots.length - 1)], estimated: true };
    used.add(si);
    si++;
  });
  return out;
}

function complementMissing(
  existing: PlannedMatch[],
  teamIds: number[],
  r: Rhythm,
  seed: number,
): PlannedMatch[] {
  const have = new Set(existing.map((m) => `${m.home}-${m.away}`));
  const rng = new Rng(seed);
  const first = singleRoundRobin(teamIds, rng);
  const all = [...first, ...first.map((round) => round.map(([h, a]) => [a, h] as [number, number]))];
  const missing: [number, number][][] = [];
  for (const pairs of all) {
    const left = pairs.filter(([h, a]) => !have.has(`${h}-${a}`));
    if (left.length) missing.push(left);
  }
  if (!missing.length) return [];
  const last = existing.reduce((mx, m) => Math.max(mx, m.date.getTime()), 0);
  const startRound = existing.reduce((mx, m) => Math.max(mx, m.round), 0) + 1;
  const extra: PlannedMatch[] = [];
  missing.forEach((pairs, i) => {
    const week = new Date(last + (i + 1) * r.weekGapDays * 86400_000);
    const slots = applySlots(pairs.length, week, r);
    pairs.forEach(([home, away], j) => {
      const round = startRound + i;
      extra.push({
        round, home, away, date: slots[j],
        roundLabel: `${round}. Hafta`,
        estimated: true,
      });
    });
  });
  return extra;
}

/** API fikstüründen plan üretir; yetersizse null (çağıran ritme düşer). */
export function planFromApiFixtures(
  fixtures: ApiFixture[],
  teamIds: number[],
  leagueId: number,
  startAt: Date,
  seed: number,
): CalendarResult | null {
  const known = new Set(teamIds);
  let rows = usableApiRows(fixtures, known);
  if (isCupLeague(leagueId)) rows = rows.filter((r) => isCupMainStageRound(r.roundRaw));
  if (rows.length < Math.max(4, Math.floor(teamIds.length / 2))) return null;

  const groups = new Map<string, RawRow[]>();
  for (const row of rows) {
    const k = row.roundRaw || "?";
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(row);
  }

  const r = leagueRhythm(leagueId);
  const planned: PlannedMatch[] = [];
  const orderedKeys = [...groups.keys()].sort((a, b) => {
    const na = parseRoundNum(a) ?? 9999;
    const nb = parseRoundNum(b) ?? 9999;
    if (na !== nb) return na - nb;
    const da = Math.min(...groups.get(a)!.map((x) => x.date.getTime()));
    const db = Math.min(...groups.get(b)!.map((x) => x.date.getTime()));
    return da - db;
  });

  let seq = 0;
  for (const key of orderedKeys) {
    const g = groups.get(key)!;
    const dates = resolveRoundDates(g, r);
    const n = parseRoundNum(key) ?? ++seq;
    if (parseRoundNum(key)) seq = Math.max(seq, n);
    g.forEach((row, i) => {
      planned.push({
        round: n,
        home: row.home,
        away: row.away,
        date: dates[i].date,
        roundLabel: displayRound(row.roundRaw, n),
        venue: row.venue,
        estimated: dates[i].estimated,
      });
    });
  }

  if (!isCupLeague(leagueId) && teamIds.length >= 8) {
    const expected = teamIds.length * (teamIds.length - 1);
    if (planned.length < expected * 0.8) {
      planned.push(...complementMissing(planned, teamIds, r, seed));
    }
  }

  planned.sort((a, b) => a.date.getTime() - b.date.getTime());
  const anchor = planned.find((m) => !m.estimated) ?? planned[0];
  if (!anchor) return null;
  const shift = isUefaClubCup(leagueId) ? alignUefaShift(anchor.date, startAt) : alignShift(anchor.date, startAt);
  for (const m of planned) {
    m.date = new Date(m.date.getTime() + shift);
    if (isUefaClubCup(leagueId)) m.date = snapToUefaMidweek(m.date);
  }
  return { matches: planned, source: "api", estimated: planned.filter((m) => m.estimated).length };
}

/** API yoksa: Berger + ligin tipik Cuma–Pazar ritmi (her güne maç basılmaz). */
export function planFromRhythm(
  teamIds: number[],
  leagueId: number,
  cfg: ScheduleConfig,
  seed: number,
): CalendarResult {
  const rng = new Rng(seed);
  const first = singleRoundRobin(teamIds, rng);
  const rounds = cfg.double_round
    ? [...first, ...first.map((round) => round.map(([h, a]) => [a, h] as [number, number]))]
    : first;
  const r = leagueRhythm(leagueId);
  const start = new Date(cfg.start_at);
  const matches: PlannedMatch[] = [];
  rounds.forEach((pairs, ri) => {
    const week = new Date(start.getTime() + ri * r.weekGapDays * 86400_000);
    const shuffled = rng.shuffle(pairs);
    const slots = applySlots(shuffled.length, week, r);
    shuffled.forEach(([home, away], i) => {
      matches.push({
        round: ri + 1, home, away, date: slots[i],
        roundLabel: `${ri + 1}. Hafta`,
        estimated: true,
      });
    });
  });
  matches.sort((a, b) => a.date.getTime() - b.date.getTime());
  if (matches[0]) {
    const shift = isUefaClubCup(leagueId) ? alignUefaShift(matches[0].date, start) : alignShift(matches[0].date, start);
    for (const m of matches) {
      m.date = new Date(m.date.getTime() + shift);
      if (isUefaClubCup(leagueId)) m.date = snapToUefaMidweek(m.date);
    }
  }
  return { matches, source: "rhythm", estimated: matches.length };
}

const MIN_REST_MS = 36 * 3600_000;

function localDayKey(d: Date): string {
  const t = new Date(d.getTime() + TR_MS);
  return `${t.getUTCFullYear()}-${t.getUTCMonth()}-${t.getUTCDate()}`;
}

/**
 * Aynı takım lig + kupa (veya iki kupa) aynı gün / 36 saatten yakın oynamasın.
 * Lig maçı +7 gün kayar (gün/saat korunur). UEFA kupası Salı→Çar→Per→sonraki Salı.
 */
export function resolveTeamClashes(
  matches: PlannedMatch[],
  busy: { teamId: number; date: Date }[],
  opts?: { uefa?: boolean },
): PlannedMatch[] {
  const byTeam = new Map<number, number[]>();
  const add = (id: number, t: number) => {
    const arr = byTeam.get(id) ?? [];
    arr.push(t);
    byTeam.set(id, arr);
  };
  for (const b of busy) add(b.teamId, b.date.getTime());

  const clashes = (id: number, t: number) => {
    const day = localDayKey(new Date(t));
    for (const u of byTeam.get(id) ?? []) {
      if (Math.abs(u - t) < MIN_REST_MS) return true;
      if (localDayKey(new Date(u)) === day) return true;
    }
    return false;
  };

  const WEEK = 7 * 86400_000;
  const bump = (t: number) => (opts?.uefa ? nextUefaSlot(t) : t + WEEK);
  const out = matches.map((m) => ({ ...m, date: new Date(m.date.getTime()) }));
  out.sort((a, b) => a.date.getTime() - b.date.getTime());
  for (const m of out) {
    let t = opts?.uefa ? snapToUefaMidweek(m.date).getTime() : m.date.getTime();
    for (let i = 0; i < 16 && (clashes(m.home, t) || clashes(m.away, t)); i++) t = bump(t);
    m.date = new Date(t);
    add(m.home, t);
    add(m.away, t);
  }
  out.sort((a, b) => a.date.getTime() - b.date.getTime());
  return out;
}
