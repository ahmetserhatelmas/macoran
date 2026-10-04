import { useEffect, useState } from 'react';

import { isLive } from '@/lib/markets';

export type LiveClock = { elapsed: number | null; extra: number };

/**
 * Tick durunca fixtures.elapsed donuyor. Son güncellemeden beri geçen süreyle
 * dakikayı duvara göre ilerlet; 45/90'da uzatma (extra) birikir.
 */
export function interpolateClock(
  status: string,
  elapsed: number | null,
  extra: number | null | undefined,
  updatedAt: string | null | undefined,
  nowMs = Date.now(),
  secondsPerMinute = 60,
): LiveClock {
  const baseExtra = Math.max(0, extra ?? 0);
  if (elapsed == null) return { elapsed, extra: 0 };
  if (status === 'HT') return { elapsed: 45, extra: 0 };
  if (!isLive(status)) return { elapsed: elapsed > 90 ? 90 : elapsed, extra: elapsed > 90 ? elapsed - 90 : baseExtra };

  const t0 = updatedAt ? Date.parse(updatedAt) : NaN;
  const spm = Math.max(1, secondsPerMinute);
  const add = Number.isFinite(t0) ? Math.max(0, (nowMs - t0) / 1000 / spm) : 0;

  if (status === '1H') {
    const e = Math.min(elapsed, 45);
    const baked = elapsed > 45 ? elapsed - 45 : 0;
    const t = e + Math.max(baseExtra, baked) + add;
    if (t < 45) return { elapsed: Math.floor(t), extra: 0 };
    return { elapsed: 45, extra: Math.min(12, Math.max(0, Math.floor(t - 45))) };
  }
  if (status === '2H') {
    const e = Math.min(elapsed, 90);
    const baked = elapsed > 90 ? elapsed - 90 : 0;
    const t = e + Math.max(baseExtra, baked) + add;
    if (t < 90) return { elapsed: Math.floor(t), extra: 0 };
    return { elapsed: 90, extra: Math.min(12, Math.max(0, Math.floor(t - 90))) };
  }
  if (status === 'ET') return { elapsed: Math.min(120, Math.floor(elapsed + add)), extra: 0 };
  return { elapsed, extra: baseExtra };
}

/** Eski çağrılar için: sadece dakika (uzatma elapsed'e eklenmez). */
export function interpolateElapsed(
  status: string,
  elapsed: number | null,
  updatedAt: string | null | undefined,
  nowMs = Date.now(),
  secondsPerMinute = 60,
  extra?: number | null,
): number | null {
  return interpolateClock(status, elapsed, extra, updatedAt, nowMs, secondsPerMinute).elapsed;
}

export function formatLiveMinute(status: string, elapsed: number | null, extra = 0): string {
  if (status === 'HT') return 'Devre';
  if (status === '1H' && extra > 0) return `45+${extra}'`;
  if (status === '2H' && extra > 0) return `90+${extra}'`;
  if (status === '1H' || status === '2H' || status === 'ET' || status === 'LIVE') return `${elapsed ?? ''}'`;
  return '';
}

let liveNow = Date.now();
let liveTimer: ReturnType<typeof setInterval> | null = null;
const liveSubs = new Set<() => void>();

function startLiveTicker() {
  if (liveTimer) return;
  liveTimer = setInterval(() => {
    liveNow = Date.now();
    liveSubs.forEach((fn) => fn());
  }, 1000);
}

function stopLiveTicker() {
  if (liveTimer) {
    clearInterval(liveTimer);
    liveTimer = null;
  }
}

/** Canlı kart/ekranlar için ortak 1 sn ticker (çoklu setInterval yok). */
export function useLiveNow(enabled: boolean) {
  const [, bump] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const onTick = () => bump((n) => n + 1);
    liveSubs.add(onTick);
    startLiveTicker();
    return () => {
      liveSubs.delete(onTick);
      if (liveSubs.size === 0) stopLiveTicker();
    };
  }, [enabled]);
  return enabled ? liveNow : Date.now();
}
