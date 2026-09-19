// Gerçek zaman -> maç saati dönüşümü.

import type { Phase } from "./model.ts";

export interface ClockSettings {
  seconds_per_minute: number;
  halftime_seconds: number;
}

export interface Clock {
  phase: Phase;
  /** mutlak dakika: 1Y 1..45+st1, 2Y 46..90+st2 (HT'de 45, FT'de 90+st2) */
  abs: number;
  /** olay anahtarı (script.tkey ile karşılaştırılır); HT'de 99 */
  key: number;
  /** ekranda gösterilen dakika (fixtures.elapsed) — 45 / 90 tavan */
  elapsed: number;
  /** uzatma dakikası (45+X / 90+X) */
  extra: number;
  status: "1H" | "HT" | "2H" | "FT";
}

export function matchClock(kickoffAt: Date, now: Date, st: { h1: number; h2: number }, cfg: ClockSettings): Clock {
  const spm = Math.max(1, cfg.seconds_per_minute);
  const s = Math.max(0, (now.getTime() - kickoffAt.getTime()) / 1000);
  const L1 = 45 + st.h1;
  const L2 = 45 + st.h2;
  const firstEnd = L1 * spm;
  const htEnd = firstEnd + Math.max(0, cfg.halftime_seconds);
  const secondEnd = htEnd + L2 * spm;

  if (s < firstEnd) {
    const abs = Math.min(L1, Math.floor(s / spm) + 1);
    return { phase: "1H", abs, key: abs, elapsed: Math.min(abs, 45), extra: Math.max(0, abs - 45), status: "1H" };
  }
  if (s < htEnd) {
    return { phase: "HT", abs: 45, key: 99, elapsed: 45, extra: 0, status: "HT" };
  }
  if (s < secondEnd) {
    const abs = 45 + Math.min(L2, Math.floor((s - htEnd) / spm) + 1);
    return { phase: "2H", abs, key: 100 + abs, elapsed: Math.min(abs, 90), extra: Math.max(0, abs - 90), status: "2H" };
  }
  return { phase: "FT", abs: 90 + st.h2, key: 999, elapsed: 90, extra: 0, status: "FT" };
}
