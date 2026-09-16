import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';

import { TeamLogo } from '@/components/TeamLogo';
import { EmptyState, Muted } from '@/components/ui';
import type { FixtureEvent, FixtureLineups, LineupPlayer, TeamLineup } from '@/lib/queries';
import { colors, radius, spacing } from '@/lib/theme';

interface Props {
  lineups: FixtureLineups | null | undefined;
  events: FixtureEvent[];
  homeId: number;
}

function shortName(name: string) {
  const parts = name.trim().split(/\s+/);
  return parts[parts.length - 1] ?? name;
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  return (name[0] ?? '?').toUpperCase();
}

function tally(events: FixtureEvent[]) {
  const goals = new Map<number, number>();
  const assists = new Map<number, number>();
  const red = new Set<number>();
  const yellow = new Set<number>();
  for (const e of events) {
    const d = (e.detail ?? '').toLowerCase();
    if (e.type === 'Goal' && !d.includes('own') && !d.includes('missed')) {
      if (e.player?.id) goals.set(e.player.id, (goals.get(e.player.id) ?? 0) + 1);
      if (e.assist?.id) assists.set(e.assist.id, (assists.get(e.assist.id) ?? 0) + 1);
    }
    if (e.type === 'Card' && e.player?.id) {
      if (d.includes('red') || d.includes('second')) red.add(e.player.id);
      else yellow.add(e.player.id);
    }
  }
  return { goals, assists, red, yellow };
}

function findPlayer(lu: TeamLineup, id: number | null, fallbackName: string | null, fallbackPos: LineupPlayer['position']): LineupPlayer {
  const all = [...lu.starters, ...lu.bench];
  const hit = id != null ? all.find((p) => p.id === id) : undefined;
  return hit ?? { id: id ?? -1, name: fallbackName ?? 'Oyuncu', number: null, position: fallbackPos, photo: null };
}

interface Slot {
  player: LineupPlayer;
  cameOn: boolean;
  sentOff: boolean;
}

interface SubRow {
  minute: number;
  extra: number | null;
  out: LineupPlayer;
  inn: LineupPlayer;
}

function currentSide(lu: TeamLineup, events: FixtureEvent[]) {
  const slots: Slot[] = lu.starters.map((p) => ({ player: p, cameOn: false, sentOff: false }));
  const subs: SubRow[] = [];
  const onIds = new Set(lu.starters.map((p) => p.id));

  for (const e of events) {
    if (e.team.id !== lu.team.id) continue;
    const d = (e.detail ?? '').toLowerCase();
    if (e.type === 'subst' && e.player) {
      const idx = slots.findIndex((s) => s.player.id === e.player!.id);
      const inn = findPlayer(lu, e.assist?.id ?? null, e.assist?.name ?? null, slots[idx]?.player.position ?? 'MID');
      if (idx >= 0) {
        subs.push({ minute: e.time.elapsed, extra: e.time.extra, out: slots[idx].player, inn });
        onIds.delete(slots[idx].player.id);
        onIds.add(inn.id);
        slots[idx] = { player: inn, cameOn: true, sentOff: false };
      }
    }
    if (e.type === 'Card' && e.player?.id && (d.includes('red') || d.includes('second'))) {
      const slot = slots.find((s) => s.player.id === e.player!.id);
      if (slot) slot.sentOff = true;
    }
  }

  const bench = lu.bench.filter((p) => !onIds.has(p.id));
  return { slots, subs, bench };
}

function formationRows(formation: string, slots: Slot[]): Slot[][] {
  const parts = formation.split('-').map(Number).filter((n) => Number.isFinite(n) && n > 0);
  // starters sırası: GK, DEF..., MID..., FWD... — değişiklik olsa da slot yeri aynı kalır
  const gk = slots.slice(0, 1);
  const rest = slots.slice(1);
  if (parts.length === 4) {
    const [d, m1, m2, f] = parts;
    return [rest.slice(d + m1 + m2, d + m1 + m2 + f), rest.slice(d + m1, d + m1 + m2), rest.slice(d, d + m1), rest.slice(0, d), gk];
  }
  if (parts.length === 3) {
    const [d, m, f] = parts;
    return [rest.slice(d + m, d + m + f), rest.slice(d, d + m), rest.slice(0, d), gk];
  }
  const def = rest.filter((s) => s.player.position === 'DEF');
  const mid = rest.filter((s) => s.player.position === 'MID');
  const fwd = rest.filter((s) => s.player.position === 'FWD');
  return [fwd, mid, def, gk].filter((r) => r.length);
}

function Face({ uri, name, size }: { uri?: string | null; name: string; size: number }) {
  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: 'rgba(0,0,0,0.25)' }}
        contentFit="cover"
        transition={150}
        cachePolicy="memory-disk"
      />
    );
  }
  return (
    <View style={[styles.faceFallback, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={{ color: colors.text, fontSize: size * 0.32, fontWeight: '800' }}>{initials(name)}</Text>
    </View>
  );
}

function Marks({ n, kind }: { n: number; kind: 'goal' | 'assist' }) {
  if (n <= 0) return null;
  return (
    <View style={styles.marks}>
      {Array.from({ length: Math.min(n, 5) }, (_, i) =>
        kind === 'goal' ? (
          <Ionicons key={i} name="football" size={11} color={colors.text} />
        ) : (
          <Text key={i} style={styles.shoe}>
            👟
          </Text>
        ),
      )}
    </View>
  );
}

function PlayerChip({
  slot,
  goals,
  assists,
  yellow,
}: {
  slot: Slot;
  goals: number;
  assists: number;
  yellow: boolean;
}) {
  return (
    <View style={[styles.chip, slot.sentOff && { opacity: 0.45 }]}>
      <View>
        <Face uri={slot.player.photo} name={slot.player.name} size={40} />
        {slot.player.number != null ? (
          <View style={styles.numBadge}>
            <Text style={styles.numText}>{slot.player.number}</Text>
          </View>
        ) : null}
        {slot.cameOn ? (
          <View style={[styles.corner, { backgroundColor: colors.success }]}>
            <Ionicons name="arrow-up" size={8} color={colors.primaryText} />
          </View>
        ) : null}
        {slot.sentOff ? (
          <View style={[styles.corner, { backgroundColor: colors.danger, right: 0, left: undefined }]}>
            <View style={styles.redCard} />
          </View>
        ) : yellow ? (
          <View style={[styles.corner, { backgroundColor: colors.gold, right: 0, left: undefined }]}>
            <View style={styles.yellowCard} />
          </View>
        ) : null}
      </View>
      <Text style={styles.chipName} numberOfLines={1}>
        {shortName(slot.player.name)}
      </Text>
      <View style={styles.markRow}>
        <Marks n={goals} kind="goal" />
        <Marks n={assists} kind="assist" />
      </View>
    </View>
  );
}

function Pitch({
  lu,
  events,
  marks,
}: {
  lu: TeamLineup;
  events: FixtureEvent[];
  marks: ReturnType<typeof tally>;
}) {
  const { slots, subs, bench } = currentSide(lu, events);
  const rows = formationRows(lu.formation, slots);
  return (
    <View style={styles.block}>
      <View style={styles.teamHead}>
        <TeamLogo uri={lu.team.logo} size={22} name={lu.team.name} />
        <Text style={styles.teamTitle} numberOfLines={1}>
          {lu.team.name}
        </Text>
        <View style={styles.formBadge}>
          <Text style={styles.formText}>{lu.formation}</Text>
        </View>
      </View>

      <View style={styles.pitch}>
        <View style={styles.halfway} />
        <View style={styles.centerCircle} />
        {rows.map((row, i) => (
          <View key={i} style={styles.pitchRow}>
            {row.map((slot) => (
              <PlayerChip
                key={slot.player.id}
                slot={slot}
                goals={marks.goals.get(slot.player.id) ?? 0}
                assists={marks.assists.get(slot.player.id) ?? 0}
                yellow={marks.yellow.has(slot.player.id)}
              />
            ))}
          </View>
        ))}
      </View>

      {subs.length ? (
        <View style={styles.subList}>
          {subs.map((s, i) => (
            <View key={`${s.out.id}-${s.inn.id}-${i}`} style={styles.subRow}>
              <Text style={styles.subMin}>
                {s.extra ? `${s.minute}+${s.extra}'` : `${s.minute}'`}
              </Text>
              <Ionicons name="arrow-down" size={12} color={colors.danger} />
              <Text style={styles.subOut} numberOfLines={1}>
                {s.out.name}
              </Text>
              <Ionicons name="arrow-up" size={12} color={colors.success} />
              <Text style={styles.subIn} numberOfLines={1}>
                {s.inn.name}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      {bench.length ? (
        <View style={styles.bench}>
          <Muted style={styles.benchLabel}>Yedekler</Muted>
          <View style={styles.benchWrap}>
            {bench.map((p) => (
              <View key={p.id} style={styles.benchChip}>
                <Face uri={p.photo} name={p.name} size={26} />
                <Text style={styles.benchName} numberOfLines={1}>
                  {p.number != null ? `${p.number} ` : ''}
                  {shortName(p.name)}
                </Text>
                <View style={styles.markRow}>
                  <Marks n={marks.goals.get(p.id) ?? 0} kind="goal" />
                  <Marks n={marks.assists.get(p.id) ?? 0} kind="assist" />
                </View>
              </View>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

export function MatchLineup({ lineups, events, homeId }: Props) {
  if (!lineups?.home?.starters?.length || !lineups?.away?.starters?.length) {
    return (
      <EmptyState
        icon="people-outline"
        title="Kadro yok"
        subtitle="Kadrolar maç başlayınca görünür. Eski test maçlarında yoksa yeni test maçı başlatın."
      />
    );
  }
  const marks = tally(events);
  const first = lineups.home.team.id === homeId ? lineups.home : lineups.away;
  const second = first === lineups.home ? lineups.away : lineups.home;
  return (
    <View style={{ gap: spacing.lg }}>
      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <Ionicons name="football" size={13} color={colors.text} />
          <Muted style={{ fontSize: 11 }}>Gol</Muted>
        </View>
        <View style={styles.legendItem}>
          <Text style={styles.shoe}>👟</Text>
          <Muted style={{ fontSize: 11 }}>Asist</Muted>
        </View>
        <View style={styles.legendItem}>
          <Ionicons name="arrow-up" size={13} color={colors.success} />
          <Muted style={{ fontSize: 11 }}>Girdi</Muted>
        </View>
      </View>
      <Pitch lu={second} events={events} marks={marks} />
      <Pitch lu={first} events={events} marks={marks} />
    </View>
  );
}

const styles = StyleSheet.create({
  legend: { flexDirection: 'row', justifyContent: 'center', gap: spacing.lg },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  shoe: { fontSize: 11, lineHeight: 13 },
  block: { gap: spacing.sm },
  teamHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: 4 },
  teamTitle: { flex: 1, color: colors.text, fontWeight: '800', fontSize: 15 },
  formBadge: { backgroundColor: colors.surface3, paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.full },
  formText: { color: colors.text, fontWeight: '800', fontSize: 12, fontVariant: ['tabular-nums'] },
  pitch: {
    backgroundColor: '#1A3D2C',
    borderRadius: radius.lg,
    paddingVertical: 14,
    paddingHorizontal: 6,
    gap: 8,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.08)',
    minHeight: 280,
    justifyContent: 'space-between',
  },
  halfway: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '50%',
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  centerCircle: {
    position: 'absolute',
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.12)',
    top: '50%',
    left: '50%',
    marginTop: -36,
    marginLeft: -36,
  },
  pitchRow: { flexDirection: 'row', justifyContent: 'space-evenly', alignItems: 'flex-start' },
  chip: { alignItems: 'center', width: 64, gap: 3 },
  faceFallback: { backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' },
  numBadge: {
    position: 'absolute',
    bottom: -2,
    right: -4,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 3,
    borderRadius: 8,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  numText: { color: colors.text, fontSize: 9, fontWeight: '800', fontVariant: ['tabular-nums'] },
  corner: {
    position: 'absolute',
    top: -2,
    left: -2,
    width: 14,
    height: 14,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  redCard: { width: 6, height: 8, borderRadius: 1, backgroundColor: '#fff' },
  yellowCard: { width: 6, height: 8, borderRadius: 1, backgroundColor: colors.bg },
  chipName: { color: colors.text, fontSize: 10, fontWeight: '700', textAlign: 'center', width: '100%' },
  markRow: { flexDirection: 'row', gap: 2, minHeight: 12, alignItems: 'center', justifyContent: 'center' },
  marks: { flexDirection: 'row', gap: 1, alignItems: 'center' },
  subList: { gap: 6, paddingHorizontal: 4 },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  subMin: { color: colors.textMuted, fontSize: 12, fontWeight: '800', width: 36, fontVariant: ['tabular-nums'] },
  subOut: { flex: 1, color: colors.textMuted, fontSize: 12 },
  subIn: { flex: 1, color: colors.text, fontSize: 12, fontWeight: '600' },
  bench: { gap: 8, paddingHorizontal: 4 },
  benchLabel: { fontSize: 11, fontWeight: '700' },
  benchWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  benchChip: { width: 64, alignItems: 'center', gap: 3 },
  benchName: { color: colors.textMuted, fontSize: 10, fontWeight: '600', textAlign: 'center', width: '100%' },
});
