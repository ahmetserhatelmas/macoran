import Ionicons from '@expo/vector-icons/Ionicons';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { interpolateClock, useLiveNow } from '@/lib/liveClock';
import { simAdmin } from '@/lib/queries';
import { colors, radius, spacing } from '@/lib/theme';
import type { FixtureWithRelations, SimScenario } from '@/types/db';

type ScriptGoal = {
  time: { half: 1 | 2; minute: number; extra: number | null };
  side: 'home' | 'away';
  type: string;
  detail: string;
  admin?: boolean;
};

function eventKey(e: { time: { half: 1 | 2; minute: number; extra: number | null } }) {
  return (e.time.half === 1 ? 0 : 100) + e.time.minute + (e.time.extra ?? 0);
}

function clientNowKey(status: string, elapsed: number) {
  if (status === 'HT') return 99;
  if (status === '2H') return 100 + Math.max(1, elapsed);
  return Math.max(1, elapsed);
}

function fmtGoalMin(e: { time: { minute: number; extra: number | null } }) {
  return e.time.extra ? `${e.time.minute}+${e.time.extra}'` : `${e.time.minute}'`;
}

function remainingScriptGoals(events: ScriptGoal[] | undefined, status: string, elapsed: number) {
  const now = clientNowKey(status, elapsed);
  return (events ?? [])
    .filter((e) => e.admin && e.type === 'Goal' && e.detail !== 'Missed Penalty' && eventKey(e) > now)
    .sort((a, b) => eventKey(a) - eventKey(b));
}

type GoalMode = 'random' | 'minute' | 'stoppage';
type NsSlot = { key: string; side: 'home' | 'away'; half: 1 | 2; mode: GoalMode; minute: string };

type LiveSlot = { key: string; side: 'home' | 'away'; half: 1 | 2; mode: 'minute' | 'stoppage'; minute: string };

function defaultLiveHalf(status: string): 1 | 2 {
  return status === '1H' ? 1 : 2;
}

function defaultLiveMin(status: string, elapsed: number, half: 1 | 2) {
  if (half === 1) return String(status === '1H' ? Math.max(1, elapsed) : 45);
  return String(status === '2H' ? Math.max(46, elapsed) : 46);
}

function parseLiveMin(t: string, half: 1 | 2, status: string, elapsed: number) {
  const n = parseInt(t.replace(/[^\d]/g, '').slice(0, 3), 10);
  if (half === 1) {
    const floor = status === '1H' ? Math.max(1, elapsed) : 1;
    return Number.isFinite(n) ? Math.max(floor, Math.min(45, n)) : floor;
  }
  const floor = status === '2H' ? Math.max(46, elapsed) : 46;
  if (!Number.isFinite(n)) return floor;
  return Math.max(floor, Math.min(90, n <= 45 ? floor : n));
}

function resizeLiveSlots(
  prev: LiveSlot[],
  nH: number,
  nA: number,
  status: string,
  elapsed: number,
): LiveSlot[] {
  const half = defaultLiveHalf(status);
  const fill = (side: 'home' | 'away', i: number): LiveSlot => ({
    key: `${side}-${half}-${i}`,
    side,
    half,
    mode: 'minute',
    minute: defaultLiveMin(status, elapsed, half),
  });
  const homes = prev.filter((s) => s.side === 'home');
  const aways = prev.filter((s) => s.side === 'away');
  while (homes.length < nH) homes.push(fill('home', homes.length));
  while (aways.length < nA) aways.push(fill('away', aways.length));
  return [...homes.slice(0, nH), ...aways.slice(0, nA)];
}

function parseNsMin(t: string, half: 1 | 2) {
  const n = parseInt(t.replace(/[^\d]/g, '').slice(0, 3), 10);
  if (half === 1) return Number.isFinite(n) ? Math.max(1, Math.min(45, n)) : 20;
  return Number.isFinite(n) ? Math.max(46, Math.min(90, n <= 45 ? 46 : n)) : 70;
}

function defaultNsMin(half: 1 | 2) {
  return half === 1 ? '20' : '70';
}

function syncNsSlots(prev: NsSlot[], htH: number, htA: number, ftH: number, ftA: number): NsSlot[] {
  const spec: { side: 'home' | 'away'; half: 1 | 2; n: number }[] = [
    { side: 'home', half: 1, n: htH },
    { side: 'away', half: 1, n: htA },
    { side: 'home', half: 2, n: Math.max(0, ftH - htH) },
    { side: 'away', half: 2, n: Math.max(0, ftA - htA) },
  ];
  const next: NsSlot[] = [];
  for (const s of spec) {
    const old = prev.filter((p) => p.side === s.side && p.half === s.half);
    for (let i = 0; i < s.n; i++) {
      next.push(old[i] ?? { key: `${s.side}-${s.half}-${i}`, side: s.side, half: s.half, mode: 'random', minute: defaultNsMin(s.half) });
    }
  }
  return next;
}

function slotsFromScenario(sc: SimScenario): NsSlot[] {
  const fromSc: NsSlot[] = (sc.goals ?? []).map((g, i) => ({
    key: `${g.side}-${g.half}-${i}`,
    side: g.side,
    half: g.half,
    mode: g.at === 'stoppage' ? 'stoppage' : typeof g.at === 'number' ? 'minute' : 'random',
    minute: typeof g.at === 'number' ? String(g.at) : defaultNsMin(g.half),
  }));
  return syncNsSlots(fromSc, sc.ht_home, sc.ht_away, sc.ft_home, sc.ft_away);
}

function fmtNsAt(s: NsSlot) {
  if (s.mode === 'stoppage') return s.half === 1 ? "45+" : "90+";
  if (s.mode === 'minute') return `${s.minute}'`;
  return 'rastgele';
}

function nsScenarioSig(sc: SimScenario | null | undefined) {
  if (!sc) return '';
  const goals = (sc.goals ?? []).map((g) => `${g.side}${g.half}:${g.at ?? 'r'}`).join(',');
  return `${sc.ht_home}-${sc.ht_away}-${sc.ft_home}-${sc.ft_away}-${sc.locked ? 1 : 0}-${goals}`;
}

/**
 * Maç detayında admin skor: canlıda her yeni golün dakikası ayrı; başlamamışta İY/MS + gol dakikası.
 */
export function AdminScorePad({ fixture: f }: { fixture: FixtureWithRelations }) {
  const qc = useQueryClient();
  const live = f.status_short === '1H' || f.status_short === 'HT' || f.status_short === '2H';
  const clockNow = useLiveNow(live);
  const clock = interpolateClock(f.status_short, f.elapsed, f.elapsed_extra, f.updated_at, clockNow);
  const nowMin = clock.elapsed ?? 1;
  const curH = f.home_goals ?? 0;
  const curA = f.away_goals ?? 0;
  const sc = f.sim_matches?.scenario;
  const [draftH, setDraftH] = useState(() => (live ? (f.home_goals ?? 0) : (sc?.ft_home ?? 0)));
  const [draftA, setDraftA] = useState(() => (live ? (f.away_goals ?? 0) : (sc?.ft_away ?? 0)));
  const [htH, setHtH] = useState(sc?.ht_home ?? 0);
  const [htA, setHtA] = useState(sc?.ht_away ?? 0);
  const [nsSlots, setNsSlots] = useState<NsSlot[]>(() => (sc ? slotsFromScenario(sc) : []));
  const [liveSlots, setLiveSlots] = useState<LiveSlot[]>([]);
  const [liveMode, setLiveMode] = useState<'inject' | 'plan'>('inject');
  const [busy, setBusy] = useState(false);
  const queue = useRef(Promise.resolve());
  const board = useRef({ h: curH, a: curA });
  board.current = { h: curH, a: curA };

  const remaining = remainingScriptGoals(f.sim_matches?.script?.events, f.status_short, nowMin);
  const [lockedOverride, setLockedOverride] = useState<boolean | null>(null);
  const serverLocked = sc?.locked === true || (sc?.locked !== false && sc?.note === 'admin skor');
  const scoreLocked = lockedOverride ?? serverLocked;

  useEffect(() => {
    if (lockedOverride === null) return;
    if (lockedOverride === serverLocked) setLockedOverride(null);
  }, [lockedOverride, serverLocked]);
  const showPlan = liveMode === 'plan' || scoreLocked;
  const remH = remaining.filter((g) => g.side === 'home').length;
  const remA = remaining.filter((g) => g.side === 'away').length;
  const pendingH = liveSlots.filter((s) => s.side === 'home').length;
  const pendingA = liveSlots.filter((s) => s.side === 'away').length;
  const planH = showPlan ? remH : 0;
  const planA = showPlan ? remA : 0;
  const home = live ? curH + planH + pendingH : draftH;
  const away = live ? curA + planA + pendingA : draftA;

  const nsSig = nsScenarioSig(sc);
  useEffect(() => {
    if (live) return;
    if (sc) {
      setDraftH(sc.ft_home);
      setDraftA(sc.ft_away);
      setHtH(sc.ht_home);
      setHtA(sc.ht_away);
      setNsSlots(slotsFromScenario(sc));
    }
  }, [live, nsSig]);

  const setLiveDraft = (wantH: number, wantA: number) => {
    const floorH = curH + planH;
    const floorA = curA + planA;
    const h = Math.max(wantH, floorH);
    const a = Math.max(wantA, floorA);
    setDraftH(h);
    setDraftA(a);
    setLiveSlots((ms) => resizeLiveSlots(ms, h - floorH, a - floorA, f.status_short, nowMin));
  };

  const setNsFt = (wantH: number, wantA: number) => {
    const h = Math.max(0, wantH);
    const a = Math.max(0, wantA);
    const nextHtH = Math.min(htH, h);
    const nextHtA = Math.min(htA, a);
    setDraftH(h);
    setDraftA(a);
    setHtH(nextHtH);
    setHtA(nextHtA);
    setNsSlots((s) => syncNsSlots(s, nextHtH, nextHtA, h, a));
  };

  const setNsHt = (wantH: number, wantA: number) => {
    const nextHtH = Math.max(0, wantH);
    const nextHtA = Math.max(0, wantA);
    const h = Math.max(home, nextHtH);
    const a = Math.max(away, nextHtA);
    setHtH(nextHtH);
    setHtA(nextHtA);
    setDraftH(h);
    setDraftA(a);
    setNsSlots((s) => syncNsSlots(s, nextHtH, nextHtA, h, a));
  };

  const refresh = () =>
    Promise.all([
      qc.refetchQueries({ queryKey: ['fixture', f.id] }),
      qc.invalidateQueries({ queryKey: ['fixture-detail', f.id] }),
      qc.invalidateQueries({ queryKey: ['fixtures'] }),
      qc.invalidateQueries({ queryKey: ['admin'] }),
    ]);

  const patchScenario = (scenario: SimScenario) => {
    const apply = (old: FixtureWithRelations | undefined) => {
      if (!old) return old;
      return {
        ...old,
        sim_matches: {
          scenario,
          facts: old.sim_matches?.facts ?? null,
          script: old.sim_matches?.script,
        },
      };
    };
    qc.setQueryData<FixtureWithRelations>(['fixture', f.id, 'admin'], apply);
    qc.setQueryData<FixtureWithRelations>(['fixture', f.id, 'pub'], apply);
    setLockedOverride(scenario.locked === true);
  };

  const applyNs = () => {
    if (scoreLocked) return;
    setBusy(true);
    queue.current = queue.current
      .then(async () => {
        const res = await simAdmin<{ scenario?: SimScenario }>('set_live_score', {
          fixture_id: f.id,
          home_goals: home,
          away_goals: away,
          ht_home: htH,
          ht_away: htA,
          goals: nsSlots.map((s) => ({
            side: s.side,
            half: s.half,
            at: s.mode === 'stoppage' ? 'stoppage' : s.mode === 'minute' ? parseNsMin(s.minute, s.half) : 'random',
          })),
        });
        if (res.scenario) patchScenario(res.scenario);
        else setLockedOverride(true);
        await refresh();
      })
      .catch((e) => {
        Alert.alert('Hata', e instanceof Error ? e.message : String(e));
      })
      .finally(() => setBusy(false));
  };

  const toMinutes = (rows: ScriptGoal[]) =>
    rows.map((g) => ({ side: g.side, half: g.time.half, minute: g.time.minute, extra: g.time.extra ?? 0 }));

  const extrasFromSlots = () =>
    liveSlots.map((s) => ({
      side: s.side,
      half: s.half,
      minute: s.mode === 'stoppage' ? (s.half === 1 ? 45 : 90) : parseLiveMin(s.minute, s.half, f.status_short, nowMin),
      extra: s.mode === 'stoppage' ? 1 : 0,
    }));

  const writePlan = (
    keep: ScriptGoal[],
    extraNew: { side: 'home' | 'away'; half: 1 | 2; minute: number; extra: number }[] = [],
  ) => {
    const h = curH + keep.filter((g) => g.side === 'home').length + extraNew.filter((g) => g.side === 'home').length;
    const a = curA + keep.filter((g) => g.side === 'away').length + extraNew.filter((g) => g.side === 'away').length;
    setBusy(true);
    queue.current = queue.current
      .then(async () => {
        const res = await simAdmin<{ home_goals: number; away_goals: number }>('set_live_score', {
          fixture_id: f.id,
          mode: 'plan',
          home_goals: Math.max(h, board.current.h),
          away_goals: Math.max(a, board.current.a),
          minutes: [...toMinutes(keep), ...extraNew],
        });
        setLiveSlots([]);
        setDraftH(res.home_goals);
        setDraftA(res.away_goals);
        setLockedOverride(true);
        await refresh();
      })
      .catch((e) => {
        Alert.alert('Hata', e instanceof Error ? e.message : String(e));
        setDraftH(board.current.h);
        setDraftA(board.current.a);
        setLiveSlots([]);
      })
      .finally(() => setBusy(false));
  };

  const applyLive = () => {
    if (scoreLocked) return;
    const extras = extrasFromSlots();
    if (liveMode === 'inject') {
      if (!extras.length) return;
      const h = curH + extras.filter((g) => g.side === 'home').length;
      const a = curA + extras.filter((g) => g.side === 'away').length;
      setBusy(true);
      queue.current = queue.current
        .then(async () => {
          const res = await simAdmin<{ home_goals: number; away_goals: number }>('set_live_score', {
            fixture_id: f.id,
            mode: 'inject',
            home_goals: Math.max(h, board.current.h),
            away_goals: Math.max(a, board.current.a),
            minutes: extras,
          });
          setLiveSlots([]);
          setDraftH(res.home_goals);
          setDraftA(res.away_goals);
          await refresh();
        })
        .catch((e) => {
          Alert.alert('Hata', e instanceof Error ? e.message : String(e));
          setDraftH(board.current.h);
          setDraftA(board.current.a);
          setLiveSlots([]);
        })
        .finally(() => setBusy(false));
      return;
    }
    writePlan(remaining, extras);
  };

  const dropRemaining = (g: ScriptGoal) => {
    if (scoreLocked) return;
    setBusy(true);
    queue.current = queue.current
      .then(async () => {
        await simAdmin('set_live_score', {
          fixture_id: f.id,
          mode: 'drop_admin',
          home_goals: board.current.h,
          away_goals: board.current.a,
          minutes: [{ side: g.side, half: g.time.half, minute: g.time.minute, extra: g.time.extra ?? 0 }],
        });
        await refresh();
      })
      .catch((e) => {
        Alert.alert('Hata', e instanceof Error ? e.message : String(e));
      })
      .finally(() => setBusy(false));
  };

  const dropNsSlot = (key: string) => {
    if (scoreLocked) return;
    const next = nsSlots.filter((s) => s.key !== key);
    if (next.length === nsSlots.length) return;
    setNsSlots(next);
    setHtH(next.filter((s) => s.side === 'home' && s.half === 1).length);
    setHtA(next.filter((s) => s.side === 'away' && s.half === 1).length);
    setDraftH(next.filter((s) => s.side === 'home').length);
    setDraftA(next.filter((s) => s.side === 'away').length);
  };

  const unlockScore = () => {
    setBusy(true);
    queue.current = queue.current
      .then(async () => {
        const res = await simAdmin<{ scenario?: SimScenario }>('set_live_score', {
          fixture_id: f.id,
          mode: 'unlock',
          home_goals: live ? board.current.h : home,
          away_goals: live ? board.current.a : away,
        });
        if (res.scenario) patchScenario(res.scenario);
        else setLockedOverride(false);
        setLiveSlots([]);
        await refresh();
      })
      .catch((e) => {
        Alert.alert('Hata', e instanceof Error ? e.message : String(e));
      })
      .finally(() => setBusy(false));
  };

  const minH = live ? curH + planH : 0;
  const minA = live ? curA + planA : 0;
  const pending = liveSlots.length;
  const hint = live
    ? scoreLocked
      ? 'Skor kilitli. Yeni gol veya skor için önce kilidi aç.'
      : liveMode === 'inject'
        ? pending
          ? 'Gol eklenir, simülasyon kaldığı yerden devam eder.'
          : remaining.length
            ? 'Sadece senin yazdığın kalan goller. Çarpı ile geri alırsın.'
            : 'Artı ile gol at. Motor kendi akışına devam eder.'
        : pending
          ? 'Kalan sim golleri iptal olur; maç bu skorla biter.'
          : 'Skoru kilitle: bundan sonra gol olmaz (sen yazmazsan).'
    : scoreLocked
      ? 'Senaryo kilitli. Gol silmek veya skor değiştirmek için önce kilidi aç.'
      : 'Rastgele seçiliyse dakika motor atar. Uzatma = 45+ / 90+.';

  const patchSlot = (key: string, patch: Partial<NsSlot>) =>
    setNsSlots((rows) => rows.map((s) => (s.key === key ? { ...s, ...patch } : s)));

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>{scoreLocked ? 'Admin skor · kilitli' : 'Admin skor'}</Text>
      {live ? (
        <>
          <View style={styles.seg}>
            <SegBtn
              label="Gol at"
              on={liveMode === 'inject' && !scoreLocked}
              disabled={scoreLocked}
              onPress={() => {
                setLiveMode('inject');
                setLiveSlots([]);
                setDraftH(curH);
                setDraftA(curA);
              }}
            />
            <SegBtn
              label="Maç sonu"
              on={liveMode === 'plan' || scoreLocked}
              disabled={scoreLocked}
              onPress={() => {
                setLiveMode('plan');
                setLiveSlots([]);
                setDraftH(curH);
                setDraftA(curA);
              }}
            />
          </View>
          <View style={styles.row}>
            <Stepper value={home} min={minH} disabled={scoreLocked} onChange={(v) => setLiveDraft(v, away)} />
            <Text style={styles.dash}>–</Text>
            <Stepper value={away} min={minA} disabled={scoreLocked} onChange={(v) => setLiveDraft(home, v)} />
          </View>
        </>
      ) : (
        <>
          <Text style={styles.sub}>İlk yarı</Text>
          <View style={styles.row}>
            <Stepper value={htH} min={0} disabled={scoreLocked} onChange={(v) => setNsHt(v, htA)} />
            <Text style={styles.dash}>–</Text>
            <Stepper value={htA} min={0} disabled={scoreLocked} onChange={(v) => setNsHt(htH, v)} />
          </View>
          <Text style={styles.sub}>Maç sonu</Text>
          <View style={styles.row}>
            <Stepper value={home} min={htH} disabled={scoreLocked} onChange={(v) => setNsFt(v, away)} />
            <Text style={styles.dash}>–</Text>
            <Stepper value={away} min={htA} disabled={scoreLocked} onChange={(v) => setNsFt(home, v)} />
          </View>
        </>
      )}
      {live && remaining.length ? (
        <View style={styles.goals}>
          <Text style={styles.minLabel}>Kalan goller</Text>
          {remaining.map((g, i) => (
            <View key={`${g.side}-${eventKey(g)}-${i}`} style={styles.minRow}>
              <Text style={styles.goalSide} numberOfLines={1}>
                {g.side === 'home' ? f.home.name : f.away.name} · {g.time.half === 1 ? 'İY' : '2Y'}
              </Text>
              <Text style={styles.planMin}>{fmtGoalMin(g)}</Text>
              <Pressable
                hitSlop={8}
                disabled={busy || scoreLocked}
                onPress={() => dropRemaining(g)}
                style={({ pressed }) => [styles.delBtn, (busy || pressed) && { opacity: 0.5 }]}
              >
                <Ionicons name="close" size={16} color={colors.danger} />
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}
      {live && pending && !scoreLocked ? (
        <View style={styles.goals}>
          <Text style={styles.minLabel}>Gol dakikaları</Text>
          {liveSlots.map((s) => (
            <LiveGoalRow
              key={s.key}
              slot={s}
              team={s.side === 'home' ? f.home.name : f.away.name}
              status={f.status_short}
              elapsed={nowMin}
              onChange={(patch) => setLiveSlots((rows) => rows.map((x) => (x.key === s.key ? { ...x, ...patch } : x)))}
            />
          ))}
          <Pressable
            onPress={applyLive}
            disabled={busy}
            style={({ pressed }) => [styles.apply, (busy || pressed) && { opacity: 0.7 }]}
          >
            <Text style={styles.applyTxt}>
              {busy ? 'Yazılıyor…' : liveMode === 'inject' ? 'Golü yaz' : 'Skoru kilitle'}
            </Text>
          </Pressable>
        </View>
      ) : live && scoreLocked ? (
        <Pressable
          onPress={unlockScore}
          disabled={busy}
          style={({ pressed }) => [styles.unlock, (busy || pressed) && { opacity: 0.7 }]}
        >
          <Text style={styles.unlockTxt}>{busy ? 'Açılıyor…' : 'Kilidi aç'}</Text>
        </Pressable>
      ) : live && liveMode === 'plan' ? (
        <Pressable
          onPress={applyLive}
          disabled={busy}
          style={({ pressed }) => [styles.apply, (busy || pressed) && { opacity: 0.7 }]}
        >
          <Text style={styles.applyTxt}>{busy ? 'Yazılıyor…' : 'Skoru kilitle'}</Text>
        </Pressable>
      ) : live ? (
        <Text style={styles.minNow}>şu an {clock.extra > 0 ? `${nowMin}+${clock.extra}'` : `${nowMin}'`}</Text>
      ) : nsSlots.length ? (
        <View style={styles.goals}>
          <Text style={styles.minLabel}>Goller</Text>
          {scoreLocked
            ? nsSlots.map((s) => (
                <View key={s.key} style={styles.minRow}>
                  <Text style={styles.goalSide} numberOfLines={1}>
                    {s.side === 'home' ? f.home.name : f.away.name} · {s.half === 1 ? 'İY' : '2Y'}
                  </Text>
                  <Text style={styles.planMin}>{fmtNsAt(s)}</Text>
                </View>
              ))
            : nsSlots.map((s) => (
                <NsGoalRow
                  key={s.key}
                  slot={s}
                  team={s.side === 'home' ? f.home.name : f.away.name}
                  onMode={(mode) => patchSlot(s.key, { mode })}
                  onMinute={(minute) => patchSlot(s.key, { minute, mode: 'minute' })}
                  onDelete={() => dropNsSlot(s.key)}
                />
              ))}
        </View>
      ) : null}
      {!live && scoreLocked ? (
        <Pressable
          onPress={unlockScore}
          disabled={busy}
          style={({ pressed }) => [styles.unlock, (busy || pressed) && { opacity: 0.7 }]}
        >
          <Text style={styles.unlockTxt}>{busy ? 'Açılıyor…' : 'Kilidi aç'}</Text>
        </Pressable>
      ) : !live ? (
        <Pressable
          onPress={applyNs}
          disabled={busy}
          style={({ pressed }) => [styles.apply, (busy || pressed) && { opacity: 0.7 }]}
        >
          <Text style={styles.applyTxt}>{busy ? 'Yazılıyor…' : 'Senaryoyu yaz'}</Text>
        </Pressable>
      ) : null}
      <Text style={styles.hint}>{hint}</Text>
    </View>
  );
}

function NsGoalRow({
  slot,
  team,
  onMode,
  onMinute,
  onDelete,
}: {
  slot: NsSlot;
  team: string;
  onMode: (m: GoalMode) => void;
  onMinute: (t: string) => void;
  onDelete?: () => void;
}) {
  const halfLabel = slot.half === 1 ? 'İY' : '2Y';
  const stopLabel = slot.half === 1 ? '45+' : '90+';
  return (
    <View style={styles.nsGoal}>
      <View style={styles.minRow}>
        <Text style={styles.goalSide} numberOfLines={1}>
          {team} · {halfLabel}
        </Text>
        {onDelete ? (
          <Pressable hitSlop={8} onPress={onDelete} style={({ pressed }) => [styles.delBtn, pressed && { opacity: 0.5 }]}>
            <Ionicons name="close" size={16} color={colors.danger} />
          </Pressable>
        ) : null}
      </View>
      <View style={styles.seg}>
        <SegBtn label="Rastgele" on={slot.mode === 'random'} onPress={() => onMode('random')} />
        <SegBtn label="Dk" on={slot.mode === 'minute'} onPress={() => onMode('minute')} />
        <SegBtn label="Uzatma" on={slot.mode === 'stoppage'} onPress={() => onMode('stoppage')} />
      </View>
      {slot.mode === 'minute' ? (
        <View style={styles.minRow}>
          <TextInput
            value={slot.minute}
            onChangeText={(t) => onMinute(t.replace(/[^\d]/g, '').slice(0, 3))}
            onBlur={() => onMinute(String(parseNsMin(slot.minute, slot.half)))}
            keyboardType="number-pad"
            maxLength={3}
            style={styles.minInput}
            placeholder={slot.half === 1 ? '1–45' : '46–90'}
            placeholderTextColor={colors.textDim}
          />
          <Text style={styles.minNow}>'</Text>
        </View>
      ) : slot.mode === 'stoppage' ? (
        <Text style={styles.stopHint}>{stopLabel} uzatmada</Text>
      ) : (
        <Text style={styles.stopHint}>dakika rastgele</Text>
      )}
    </View>
  );
}

function SegBtn({
  label,
  on,
  onPress,
  disabled,
}: {
  label: string;
  on: boolean;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[styles.segBtn, on && styles.segOn, disabled && { opacity: 0.35 }]}
    >
      <Text style={[styles.segTxt, on && styles.segTxtOn]}>{label}</Text>
    </Pressable>
  );
}

function LiveGoalRow({
  slot,
  team,
  status,
  elapsed,
  onChange,
}: {
  slot: LiveSlot;
  team: string;
  status: string;
  elapsed: number;
  onChange: (patch: Partial<LiveSlot>) => void;
}) {
  const iyLocked = status === 'HT' || status === '2H';
  return (
    <View style={styles.nsGoal}>
      <Text style={styles.goalSide} numberOfLines={1}>
        {team}
      </Text>
      <View style={styles.seg}>
        <SegBtn
          label="İY"
          on={slot.half === 1}
          disabled={iyLocked}
          onPress={() => onChange({ half: 1, minute: defaultLiveMin(status, elapsed, 1) })}
        />
        <SegBtn
          label="2Y"
          on={slot.half === 2}
          onPress={() => onChange({ half: 2, minute: defaultLiveMin(status, elapsed, 2) })}
        />
        <SegBtn label="Dk" on={slot.mode === 'minute'} onPress={() => onChange({ mode: 'minute' })} />
        <SegBtn label="Uzatma" on={slot.mode === 'stoppage'} onPress={() => onChange({ mode: 'stoppage' })} />
      </View>
      {slot.mode === 'minute' ? (
        <View style={styles.minRow}>
          <TextInput
            value={slot.minute}
            onChangeText={(t) => onChange({ minute: t.replace(/[^\d]/g, '').slice(0, 3), mode: 'minute' })}
            onBlur={() => onChange({ minute: String(parseLiveMin(slot.minute, slot.half, status, elapsed)) })}
            keyboardType="number-pad"
            maxLength={3}
            style={styles.minInput}
            placeholder={slot.half === 1 ? '1–45' : '46–90'}
            placeholderTextColor={colors.textDim}
          />
          <Text style={styles.minNow}>'</Text>
        </View>
      ) : (
        <Text style={styles.stopHint}>{slot.half === 1 ? '45+' : '90+'} uzatmada</Text>
      )}
    </View>
  );
}

function Stepper({
  value,
  onChange,
  min,
  disabled,
}: {
  value: number;
  onChange: (n: number) => void;
  min: number;
  disabled?: boolean;
}) {
  const minusOff = disabled || value <= min;
  const plusOff = disabled || value >= 12;
  return (
    <View style={[styles.stepper, disabled && { opacity: 0.5 }]}>
      <Pressable
        onPress={() => onChange(Math.max(min, value - 1))}
        disabled={minusOff}
        style={({ pressed }) => [styles.btn, minusOff && { opacity: 0.35 }, pressed && { opacity: 0.7 }]}
      >
        <Ionicons name="remove" size={18} color={colors.text} />
      </Pressable>
      <Text style={styles.num}>{value}</Text>
      <Pressable
        onPress={() => onChange(Math.min(12, value + 1))}
        disabled={plusOff}
        style={({ pressed }) => [styles.btn, plusOff && { opacity: 0.35 }, pressed && { opacity: 0.7 }]}
      >
        <Ionicons name="add" size={18} color={colors.text} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: spacing.sm,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    gap: spacing.sm,
    alignItems: 'center',
  },
  title: { color: colors.gold, fontSize: 11, fontWeight: '800', letterSpacing: 0.4, textTransform: 'uppercase' },
  sub: { color: colors.textMuted, fontSize: 11, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dash: { color: colors.textMuted, fontSize: 22, fontWeight: '800' },
  hint: { color: colors.textMuted, fontSize: 11, textAlign: 'center', lineHeight: 15, paddingHorizontal: spacing.sm },
  goals: { alignSelf: 'stretch', gap: 10, paddingHorizontal: spacing.sm },
  nsGoal: { gap: 6, paddingBottom: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  minRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  minLabel: { color: colors.textMuted, fontSize: 12, fontWeight: '700', textAlign: 'center' },
  goalSide: { color: colors.text, fontSize: 13, fontWeight: '700', flex: 1 },
  minInput: {
    width: 52,
    height: 34,
    borderRadius: radius.sm,
    backgroundColor: colors.surface3,
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  minNow: { color: colors.info, fontSize: 11, fontWeight: '700' },
  planMin: { color: colors.gold, fontSize: 14, fontWeight: '800', fontVariant: ['tabular-nums'] },
  delBtn: {
    width: 28,
    height: 28,
    borderRadius: radius.sm,
    backgroundColor: colors.surface3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stopHint: { color: colors.textDim, fontSize: 11 },
  seg: { flexDirection: 'row', gap: 6 },
  segBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.sm,
    backgroundColor: colors.surface3,
  },
  segOn: { backgroundColor: colors.primary },
  segTxt: { color: colors.textMuted, fontSize: 11, fontWeight: '800' },
  segTxtOn: { color: colors.primaryText },
  apply: {
    alignSelf: 'center',
    backgroundColor: colors.primary,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
    marginTop: 4,
  },
  applyTxt: { color: colors.primaryText, fontSize: 13, fontWeight: '800' },
  unlock: {
    alignSelf: 'center',
    backgroundColor: colors.surface3,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
    marginTop: 4,
    borderWidth: 1,
    borderColor: colors.gold,
  },
  unlockTxt: { color: colors.gold, fontSize: 13, fontWeight: '800' },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  btn: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    backgroundColor: colors.surface3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  num: { color: colors.text, fontSize: 28, fontWeight: '900', fontVariant: ['tabular-nums'], minWidth: 28, textAlign: 'center' },
});
