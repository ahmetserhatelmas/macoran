import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { BalancePill } from '@/components/BalancePill';
import { BetCard } from '@/components/BetCard';
import { Button, EmptyState, Header, Loading, Screen } from '@/components/ui';
import { money } from '@/lib/format';
import { useMyBets } from '@/lib/queries';
import { colors, radius, spacing } from '@/lib/theme';
import { useBetslip } from '@/store/betslip';

type Filter = 'all' | 'pending' | 'won' | 'lost';
const FILTER_LABELS: Record<Filter, string> = { all: 'Hepsi', pending: 'Bekleyen', won: 'Kazanan', lost: 'Kaybeden' };

export default function BetsScreen() {
  const router = useRouter();
  const { data: bets, isLoading, refetch, isRefetching } = useMyBets();
  const count = useBetslip((s) => s.selections.length);
  const [filter, setFilter] = useState<Filter>('all');

  const list = useMemo(() => {
    if (!bets) return [];
    if (filter === 'all') return bets;
    return bets.filter((b) => b.status === filter);
  }, [bets, filter]);

  const stats = useMemo(() => {
    const all = bets ?? [];
    const won = all.filter((b) => b.status === 'won').length;
    const lost = all.filter((b) => b.status === 'lost').length;
    // Net: sonuçlanan kuponlar üzerinden (bekleyenlerin tutarı henüz kayıp değil)
    const settled = all.filter((b) => b.status !== 'pending');
    const staked = settled.reduce((a, b) => a + b.stake, 0);
    const returned = settled.reduce((a, b) => a + (b.payout ?? 0), 0);
    return { total: all.length, won, lost, net: returned - staked };
  }, [bets]);

  return (
    <Screen>
      <Header title="Kuponlarım" right={<BalancePill />} />

      {count > 0 ? (
        <View style={styles.openSlip}>
          <View style={{ flex: 1 }}>
            <Text style={styles.openSlipTitle}>Bekleyen kuponun var</Text>
            <Text style={styles.openSlipSub}>{count} seçim hazır, onaylamak için aç.</Text>
          </View>
          <Button title="Kuponu Aç" size="sm" onPress={() => router.push('/betslip')} />
        </View>
      ) : null}

      <View style={styles.stats}>
        <Stat label="Toplam" value={String(stats.total)} />
        <Stat label="Kazanan" value={String(stats.won)} color={colors.success} />
        <Stat label="Kaybeden" value={String(stats.lost)} color={colors.danger} />
        <Stat label="Net" value={money(stats.net, { sign: true })} color={stats.net >= 0 ? colors.success : colors.danger} />
      </View>

      <View style={styles.filters}>
        {(Object.keys(FILTER_LABELS) as Filter[]).map((f) => (
          <Pressable key={f} onPress={() => setFilter(f)} style={[styles.filter, filter === f && styles.filterActive]}>
            <Text style={[styles.filterText, filter === f && styles.filterTextActive]}>{FILTER_LABELS[f]}</Text>
          </Pressable>
        ))}
      </View>

      {isLoading ? (
        <Loading />
      ) : (
        <FlatList
          data={list}
          keyExtractor={(b) => b.id}
          renderItem={({ item }) => <BetCard bet={item} />}
          contentContainerStyle={{ paddingBottom: 40, paddingTop: spacing.sm }}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />}
          ListEmptyComponent={<EmptyState icon="receipt-outline" title="Henüz kupon yok" subtitle="Maçlar sekmesinden oran seçip ilk kuponunu oyna." />}
        />
      )}
    </Screen>
  );
}

function Stat({ label, value, color = colors.text }: { label: string; value: string; color?: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, { color }]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  openSlip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: 'rgba(34,197,94,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.35)',
  },
  openSlipTitle: { color: colors.text, fontWeight: '800' },
  openSlipSub: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  stats: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg },
  stat: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.sm, paddingVertical: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  statLabel: { color: colors.textMuted, fontSize: 11, fontWeight: '600' },
  statValue: { fontSize: 15, fontWeight: '800', marginTop: 4, fontVariant: ['tabular-nums'] },
  filters: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  filter: { paddingHorizontal: 12, height: 32, borderRadius: radius.full, backgroundColor: colors.surface2, justifyContent: 'center', borderWidth: 1, borderColor: colors.border },
  filterActive: { backgroundColor: colors.text, borderColor: colors.text },
  filterText: { color: colors.textMuted, fontSize: 13, fontWeight: '600' },
  filterTextActive: { color: colors.bg },
});
