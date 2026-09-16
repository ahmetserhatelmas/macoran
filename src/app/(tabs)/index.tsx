import { useEffect, useMemo, useState } from 'react';
import { RefreshControl, SectionList, StyleSheet, Text, View } from 'react-native';

import { BalancePill } from '@/components/BalancePill';
import { BetslipBar } from '@/components/BetslipBar';
import { DateBar } from '@/components/DateBar';
import { FixtureCard } from '@/components/FixtureCard';
import { LeagueChips } from '@/components/LeagueChips';
import { LeaguePicker } from '@/components/LeaguePicker';
import { EmptyState, Header, IconButton, Loading, Screen } from '@/components/ui';
import { dayjs } from '@/lib/format';
import { useFixturesByDate, useLeagues, useLiveFixtures } from '@/lib/queries';
import { colors, spacing } from '@/lib/theme';
import { useBetslip } from '@/store/betslip';
import { useFavorites } from '@/store/favorites';
import type { FixtureWithRelations } from '@/types/db';

export default function MatchesScreen() {
  const [date, setDate] = useState(() => dayjs().startOf('day'));
  const [leagueId, setLeagueId] = useState<number | null>(null);
  const [liveOnly, setLiveOnly] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const { data: leagues = [] } = useLeagues();
  const selectLeague = (id: number | null) => {
    setLiveOnly(false);
    setLeagueId(id);
  };
  const byDate = useFixturesByDate(date, leagueId);
  const live = useLiveFixtures();
  const liveCount = live.data?.length ?? 0;
  // Canlı filtresi açıkken tarih yerine o an oynanan tüm maçlar gösterilir
  const { data: fixtures, isLoading, refetch, isRefetching } = liveOnly ? live : byDate;
  const syncOdds = useBetslip((s) => s.syncOdds);

  // Kupondaki oranları ekrandaki güncel oranlarla eşitle
  useEffect(() => {
    if (fixtures) syncOdds(fixtures.flatMap((f) => f.odds));
  }, [fixtures, syncOdds]);

  const favIds = useFavorites((s) => s.ids);
  const sections = useMemo(() => {
    if (!fixtures) return [];
    const fav = new Set(favIds);
    const favored = fixtures.filter((f) => fav.has(f.id));
    const rest = fixtures.filter((f) => !fav.has(f.id));
    const map = new Map<number, { title: string; logo: string | null; country: string | null; order: number; data: FixtureWithRelations[] }>();
    for (const f of rest) {
      if (!map.has(f.league_id)) {
        map.set(f.league_id, { title: f.league.name, logo: f.league.logo, country: f.league.country, order: f.league.sort_order, data: [] });
      }
      map.get(f.league_id)!.data.push(f);
    }
    const leagues = [...map.values()].sort((a, b) => a.order - b.order);
    if (!favored.length) return leagues;
    return [{ title: 'Favoriler', logo: null, country: null, order: -1, data: favored }, ...leagues];
  }, [fixtures, favIds]);

  return (
    <Screen>
      <Header
        title="Maçlar"
        subtitle={liveOnly ? `${fixtures?.length ?? 0} canlı maç` : `${fixtures?.length ?? 0} maç`}
        right={
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
            <IconButton icon="search" onPress={() => setPickerOpen(true)} />
            <BalancePill />
          </View>
        }
      />
      {liveOnly ? null : <DateBar value={date} onChange={setDate} />}
      <LeagueChips
        leagues={leagues}
        selected={leagueId}
        onSelect={selectLeague}
        live={{ active: liveOnly, count: liveCount, onPress: () => setLiveOnly((v) => !v) }}
        onOpenPicker={() => setPickerOpen(true)}
      />
      <LeaguePicker visible={pickerOpen} onClose={() => setPickerOpen(false)} leagues={leagues} selected={leagueId} onSelect={selectLeague} />

      {isLoading ? (
        <Loading />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item, section }) => <FixtureCard fixture={item} showLeague={section.order === -1} />}
          renderSectionHeader={({ section }) => (
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, section.order === -1 && { color: colors.gold }]}>{section.title}</Text>
              {section.country ? <Text style={styles.sectionCountry}>{section.country}</Text> : null}
            </View>
          )}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={{ paddingBottom: 120 }}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />}
          ListEmptyComponent={
            liveOnly ? (
              <EmptyState icon="radio-outline" title="Şu an canlı maç yok" subtitle="Maçlar başladığında burada görünür." />
            ) : (
              <EmptyState title="Bu tarihte maç yok" subtitle="Başka bir gün veya lig seçin." />
            )
          }
          initialNumToRender={12}
          windowSize={7}
        />
      )}
      <BetslipBar />
    </Screen>
  );
}

const styles = StyleSheet.create({
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  sectionTitle: { color: colors.text, fontSize: 15, fontWeight: '800' },
  sectionCountry: { color: colors.textDim, fontSize: 12 },
});
