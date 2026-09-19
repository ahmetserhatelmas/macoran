import Ionicons from '@expo/vector-icons/Ionicons';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { TeamLogo } from '@/components/TeamLogo';
import { Badge, EmptyState, Header, IconButton, Loading, Muted, Screen } from '@/components/ui';
import { dateTime } from '@/lib/format';
import { interpolateClock, useLiveNow } from '@/lib/liveClock';
import { statusLabel } from '@/lib/markets';
import { simAdmin, useAdminLiveFixtures } from '@/lib/queries';
import { colors, radius, spacing } from '@/lib/theme';
import { useAuth } from '@/store/auth';

/**
 * Canlı ve henüz başlamamış maçlara skor müdahalesi.
 * Canlıda planlanan maç sonu yazılır (olmuş gol silinmez). Başlamamışta senaryo yazılır.
 */
export default function AdminLiveScoreScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const isAdmin = useAuth((s) => s.profile?.is_admin);
  const { data: fixtures = [], isLoading, refetch, isRefetching } = useAdminLiveFixtures();
  const [busy, setBusy] = useState<number | null>(null);
  const hasLive = fixtures.some((x) => x.status_short !== 'NS');
  const clockNow = useLiveNow(hasLive);

  useEffect(() => {
    if (isAdmin === false) router.replace('/(tabs)');
  }, [isAdmin, router]);

  const setScore = async (id: number, home: number, away: number) => {
    if (busy) return;
    setBusy(id);
    try {
      await simAdmin('set_live_score', { fixture_id: id, home_goals: home, away_goals: away });
      await Promise.all([
        refetch(),
        qc.invalidateQueries({ queryKey: ['fixtures'] }),
        qc.invalidateQueries({ queryKey: ['fixture', id] }),
        qc.invalidateQueries({ queryKey: ['fixture-detail', id] }),
        qc.invalidateQueries({ queryKey: ['admin', 'upcoming'] }),
      ]);
    } catch (e) {
      Alert.alert('Hata', e instanceof Error ? e.message : String(e));
      await refetch();
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen>
      <Header
        title="Skor müdahalesi"
        subtitle="Planlanan sonucu yaz · olmuş gol geri alınmaz"
        left={<IconButton icon="chevron-back" onPress={() => router.back()} />}
      />
      {isLoading ? (
        <Loading />
      ) : (
        <FlatList
          data={fixtures}
          keyExtractor={(f) => String(f.id)}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />}
          contentContainerStyle={{ padding: spacing.lg, paddingTop: 0, paddingBottom: 40, gap: spacing.sm, flexGrow: 1 }}
          ListEmptyComponent={
            <EmptyState icon="radio-outline" title="Maç yok" subtitle="Canlı veya yaklaşan simülasyon maçları burada görünür." />
          }
          renderItem={({ item: f }) => {
            const live = f.status_short !== 'NS';
            const clock = interpolateClock(f.status_short, f.elapsed, f.elapsed_extra, f.updated_at, clockNow);
            const elapsed = clock.elapsed;
            const sc = f.sim_matches?.scenario;
            const facts = f.sim_matches?.facts;
            const curH = f.home_goals ?? 0;
            const curA = f.away_goals ?? 0;
            const planH = live
              ? (facts ? facts.h1 + facts.h2 : sc?.ft_home ?? curH)
              : (sc?.ft_home ?? 0);
            const planA = live
              ? (facts ? facts.a1 + facts.a2 : sc?.ft_away ?? curA)
              : (sc?.ft_away ?? 0);
            const locked = busy === f.id;
            const scripted = !live && !!sc;
            const frozen = live && planH === curH && planA === curA;
            return (
              <View style={[styles.card, locked && { opacity: 0.7 }, (scripted || (live && !frozen)) && styles.scripted]}>
                <View style={styles.meta}>
                  <Muted style={{ fontSize: 11, flex: 1 }} numberOfLines={1}>
                    {f.league?.name ?? ''} {f.round ? `· ${f.round}` : ''}
                  </Muted>
                  {live ? (
                    <Badge
                      text={statusLabel(f.status_short, elapsed, clock.extra)}
                      color="rgba(239,68,68,0.15)"
                      textColor={colors.live}
                      dot
                    />
                  ) : (
                    <Badge
                      text={dateTime(f.date)}
                      color={scripted ? 'rgba(34,197,94,0.15)' : colors.surface3}
                      textColor={scripted ? colors.success : colors.textMuted}
                    />
                  )}
                </View>
                {live ? (
                  <Text style={styles.nowScore}>
                    Şu an {curH}–{curA}
                    {frozen ? ' · bu skorda kalır' : ` · plan ${planH}–${planA}`}
                  </Text>
                ) : null}
                <View style={styles.row}>
                  <View style={styles.team}>
                    <TeamLogo uri={f.home.logo} size={28} name={f.home.name} />
                    <Text style={styles.teamName} numberOfLines={2}>
                      {f.home.name}
                    </Text>
                  </View>
                  <View style={styles.scoreBlock}>
                    <Stepper
                      value={planH}
                      min={live ? curH : 0}
                      disabled={locked}
                      onChange={(v) => setScore(f.id, v, planA)}
                    />
                    <Text style={styles.dash}>–</Text>
                    <Stepper
                      value={planA}
                      min={live ? curA : 0}
                      disabled={locked}
                      onChange={(v) => setScore(f.id, planH, v)}
                    />
                  </View>
                  <View style={[styles.team, { alignItems: 'flex-end' }]}>
                    <TeamLogo uri={f.away.logo} size={28} name={f.away.name} />
                    <Text style={[styles.teamName, { textAlign: 'right' }]} numberOfLines={2}>
                      {f.away.name}
                    </Text>
                  </View>
                </View>
                <Muted style={{ fontSize: 11, textAlign: 'center' }}>
                  {live
                    ? frozen
                      ? 'Kalan goller iptal. Yeni gol yazarsan maç içinde gelir.'
                      : 'Planı şu anki skora çekersen olmuş goller durur, gerisi iptal olur.'
                    : scripted
                      ? `Maç bu skorla oynanır (İY ${sc!.ht_home}-${sc!.ht_away}).`
                      : 'Skor yazılmazsa motor kendi üretir.'}
                </Muted>
                <Pressable onPress={() => router.push(`/match/${f.id}`)} hitSlop={8}>
                  <Muted style={{ fontSize: 11, textAlign: 'center' }}>Maç detayını aç</Muted>
                </Pressable>
              </View>
            );
          }}
        />
      )}
    </Screen>
  );
}

function Stepper({
  value,
  onChange,
  disabled,
  min = 0,
}: {
  value: number;
  onChange: (n: number) => void;
  disabled?: boolean;
  min?: number;
}) {
  return (
    <View style={styles.stepper}>
      <Pressable
        onPress={() => onChange(Math.max(min, value - 1))}
        disabled={disabled || value <= min}
        style={({ pressed }) => [styles.stepBtn, (disabled || value <= min) && { opacity: 0.35 }, pressed && { opacity: 0.7 }]}
      >
        <Ionicons name="remove" size={18} color={colors.text} />
      </Pressable>
      <Text style={styles.score}>{value}</Text>
      <Pressable
        onPress={() => onChange(Math.min(12, value + 1))}
        disabled={disabled || value >= 12}
        style={({ pressed }) => [styles.stepBtn, (disabled || value >= 12) && { opacity: 0.35 }, pressed && { opacity: 0.7 }]}
      >
        <Ionicons name="add" size={18} color={colors.text} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  scripted: { borderColor: 'rgba(34,197,94,0.4)' },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  team: { flex: 1, gap: 6 },
  teamName: { color: colors.text, fontWeight: '700', fontSize: 13 },
  nowScore: { color: colors.text, fontWeight: '800', fontSize: 13, textAlign: 'center' },
  scoreBlock: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dash: { color: colors.textMuted, fontSize: 20, fontWeight: '800', marginHorizontal: 2 },
  stepper: { alignItems: 'center', gap: 4 },
  stepBtn: {
    width: 36,
    height: 32,
    borderRadius: radius.sm,
    backgroundColor: colors.surface3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  score: { color: colors.text, fontSize: 26, fontWeight: '900', fontVariant: ['tabular-nums'], minWidth: 28, textAlign: 'center' },
});
