import { useEffect, useMemo, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { BalancePill } from '@/components/BalancePill';
import { BetslipBar } from '@/components/BetslipBar';
import { FixtureCard } from '@/components/FixtureCard';
import { LeagueChips } from '@/components/LeagueChips';
import { EmptyState, Header, Loading, Screen } from '@/components/ui';
import { useLeagues, useLiveFixtures } from '@/lib/queries';
import { colors, spacing } from '@/lib/theme';
import { useBetslip } from '@/store/betslip';
import { useFavorites } from '@/store/favorites';

export default function LiveScreen() {
  const [leagueId, setLeagueId] = useState<number | null>(null);
  const { data: leagues = [] } = useLeagues();
  const { data: fixtures, isLoading, refetch, isRefetching } = useLiveFixtures();
  const syncOdds = useBetslip((s) => s.syncOdds);

  useEffect(() => {
    if (fixtures) syncOdds(fixtures.flatMap((f) => f.odds));
  }, [fixtures, syncOdds]);

  // Sadece canlı maçı olan ligleri göster (test ligi is_active=false olduğu için fikstürden eklenir)
  const liveLeagues = useMemo(() => {
    const ids = new Set((fixtures ?? []).map((f) => f.league_id));
    const out = leagues.filter((l) => ids.has(l.id));
    for (const f of fixtures ?? []) {
      if (out.some((l) => l.id === f.league_id)) continue;
      if (f.league) out.push(f.league);
    }
    return out;
  }, [leagues, fixtures]);

  const favIds = useFavorites((s) => s.ids);
  const list = useMemo(() => {
    const rows = (fixtures ?? []).filter((f) => !leagueId || f.league_id === leagueId);
    const fav = new Set(favIds);
    return [...rows].sort((a, b) => Number(fav.has(b.id)) - Number(fav.has(a.id)) || a.date.localeCompare(b.date));
  }, [fixtures, leagueId, favIds]);

  return (
    <Screen>
      <Header
        title="Canlı"
        subtitle={fixtures?.length ? `${fixtures.length} maç oynanıyor` : 'Şu an canlı maç yok'}
        right={<BalancePill />}
      />
      {liveLeagues.length > 1 ? <LeagueChips leagues={liveLeagues} selected={leagueId} onSelect={setLeagueId} /> : null}

      <View style={styles.hint}>
        <View style={styles.dot} />
        <Text style={styles.hintText}>Skorlar ve oranlar 15 saniyede bir güncellenir · Canlı bahis açık</Text>
      </View>

      {isLoading ? (
        <Loading />
      ) : (
        <FlatList
          data={list}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => <FixtureCard fixture={item} showLeague />}
          contentContainerStyle={{ paddingBottom: 120, paddingTop: spacing.sm }}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />}
          ListEmptyComponent={
            <EmptyState icon="radio-outline" title="Canlı maç yok" subtitle="Takip ettiğimiz 20 ligde şu an oynanan maç bulunmuyor." />
          }
        />
      )}
      <BetslipBar />
    </Screen>
  );
}

const styles = StyleSheet.create({
  hint: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.live },
  hintText: { color: colors.textMuted, fontSize: 12 },
});
