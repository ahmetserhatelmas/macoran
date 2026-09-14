import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { TeamLogo } from '@/components/TeamLogo';
import { filterLeagues } from '@/components/LeaguePicker';
import { Badge, EmptyState, Header, IconButton, Input, Loading, Muted, Screen } from '@/components/ui';
import { ago } from '@/lib/format';
import { type PlayerStatRow, useLeagueLiveFixtures, useLeagues, usePlayerStats, useStandings } from '@/lib/queries';
import { overlayLiveStandings, type LiveStandingRow } from '@/lib/standings';
import { colors, radius, spacing } from '@/lib/theme';
import type { League, StandingRow } from '@/types/db';

export default function StandingsScreen() {
  const { data: leagues = [], isLoading: leaguesLoading } = useLeagues();
  const [leagueId, setLeagueId] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const league = leagues.find((l) => l.id === leagueId) ?? null;
  const filtered = useMemo(() => filterLeagues(leagues, query), [leagues, query]);

  if (!league) {
    return (
      <Screen>
        <Header title="Puan Durumu" subtitle={`${leagues.length} lig`} />
        <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.sm }}>
          <Input
            icon="search"
            placeholder="Lig veya ülke ara…"
            value={query}
            onChangeText={setQuery}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            clearButtonMode="while-editing"
          />
        </View>
        {leaguesLoading ? (
          <Loading />
        ) : (
          <FlatList
            data={filtered}
            keyExtractor={(l) => String(l.id)}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ padding: spacing.lg, paddingTop: spacing.xs, paddingBottom: 40, gap: spacing.sm }}
            renderItem={({ item }) => <LeagueItem league={item} onPress={() => setLeagueId(item.id)} />}
            ListEmptyComponent={<EmptyState icon="search-outline" title="Lig bulunamadı" subtitle={`“${query}” ile eşleşen lig yok.`} />}
          />
        )}
      </Screen>
    );
  }

  return <LeagueTable league={league} onBack={() => setLeagueId(null)} />;
}

function LeagueItem({ league, onPress }: { league: League; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.leagueItem, pressed && { backgroundColor: colors.surface2 }]}>
      <View style={styles.leagueLogoWrap}>
        {league.logo ? <Image source={{ uri: league.logo }} style={styles.leagueLogo} contentFit="contain" cachePolicy="memory-disk" /> : null}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.leagueName} numberOfLines={1}>
          {league.name}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {league.flag ? <Image source={{ uri: league.flag }} style={styles.flag} contentFit="cover" cachePolicy="memory-disk" /> : null}
          <Muted>{league.country ?? ''}</Muted>
        </View>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textDim} />
    </Pressable>
  );
}

type LeagueTab = 'table' | 'goals' | 'assists';
const LEAGUE_TABS: { key: LeagueTab; label: string }[] = [
  { key: 'table', label: 'Puan Durumu' },
  { key: 'goals', label: 'Gol Krallığı' },
  { key: 'assists', label: 'Asist Krallığı' },
];

function LeagueTable({ league, onBack }: { league: League; onBack: () => void }) {
  const { data, isLoading } = useStandings(league.id);
  const liveFx = useLeagueLiveFixtures(league.id);
  const [tab, setTab] = useState<LeagueTab>('table');
  const groups = useMemo(
    () => overlayLiveStandings(data?.data ?? [], liveFx.data ?? []),
    [data?.data, liveFx.data],
  );
  const liveCount = groups.reduce((n, g) => n + g.filter((r) => r.live).length, 0);

  return (
    <Screen>
      <Header
        title={league.name}
        subtitle={`${league.country ?? ''} · ${league.season}/${(league.season + 1) % 100}`}
        left={<IconButton icon="chevron-back" onPress={onBack} />}
      />

      <View style={styles.tabs}>
        {LEAGUE_TABS.map((t) => (
          <Pressable key={t.key} onPress={() => setTab(t.key)} style={[styles.tab, tab === t.key && styles.tabActive]}>
            <Text style={[styles.tabText, tab === t.key && styles.tabTextActive]}>{t.label}</Text>
          </Pressable>
        ))}
      </View>

      {tab !== 'table' ? (
        <PlayerRanking leagueId={league.id} kind={tab} />
      ) : isLoading ? (
        <Loading />
      ) : !data?.data?.length ? (
        <EmptyState icon="podium-outline" title="Puan durumu henüz yok" subtitle="Lig başlatıldığında tablo burada oluşur." />
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 40, gap: spacing.lg }}>
          {groups.map((group, gi) => (
            <View key={gi} style={styles.table}>
              {groups.length > 1 ? <Text style={styles.groupTitle}>{group[0]?.group}</Text> : null}
              <View style={[styles.row, styles.headRow]}>
                <Text style={[styles.rank, styles.head]}>#</Text>
                <Text style={[styles.team, styles.head]}>Takım</Text>
                <Text style={[styles.num, styles.head]}>O</Text>
                <Text style={[styles.num, styles.head]}>G</Text>
                <Text style={[styles.num, styles.head]}>B</Text>
                <Text style={[styles.num, styles.head]}>M</Text>
                <Text style={[styles.num, styles.head, { width: 34 }]}>AV</Text>
                <Text style={[styles.num, styles.head, styles.pts]}>P</Text>
              </View>
              {group.map((r: LiveStandingRow, i) => (
                <View
                  key={r.team.id}
                  style={[styles.row, i % 2 === 1 && { backgroundColor: colors.surface2 }, r.live && styles.liveRow]}
                >
                  <View style={styles.rankWrap}>
                    <View style={[styles.rankBar, { backgroundColor: zoneColor(r.description) }]} />
                    <Text style={styles.rank}>{r.rank}</Text>
                  </View>
                  <View style={styles.teamWrap}>
                    <TeamLogo uri={r.team.logo} size={20} name={r.team.name} />
                    <Text style={styles.teamName} numberOfLines={1}>
                      {r.team.name}
                    </Text>
                    {r.live ? (
                      <Badge
                        text="Canlı"
                        color="rgba(239,68,68,0.15)"
                        textColor={colors.live}
                        style={styles.liveBadge}
                      />
                    ) : null}
                  </View>
                  <Text style={styles.num}>{r.all.played}</Text>
                  <Text style={styles.num}>{r.all.win}</Text>
                  <Text style={styles.num}>{r.all.draw}</Text>
                  <Text style={styles.num}>{r.all.lose}</Text>
                  <Text style={[styles.num, { width: 34 }]}>{r.goalsDiff > 0 ? `+${r.goalsDiff}` : r.goalsDiff}</Text>
                  <Text style={[styles.num, styles.pts]}>{r.points}</Text>
                </View>
              ))}
            </View>
          ))}
          <Legend rows={groups.flat()} />
          <Muted style={{ textAlign: 'center' }}>
            {liveCount
              ? `Canlı maçlar tabloya yansıtılıyor · ${ago(data.updated_at)}`
              : `Son güncelleme: ${ago(data.updated_at)}`}
          </Muted>
        </ScrollView>
      )}
    </Screen>
  );
}

function PlayerRanking({ leagueId, kind }: { leagueId: number; kind: 'goals' | 'assists' }) {
  const { data = [], isLoading } = usePlayerStats(leagueId, kind);
  if (isLoading) return <Loading />;
  if (!data.length) {
    return (
      <EmptyState
        icon={kind === 'goals' ? 'football-outline' : 'git-branch-outline'}
        title={kind === 'goals' ? 'Henüz gol atılmadı' : 'Henüz asist yok'}
        subtitle="Maçlar oynandıkça sıralama burada oluşur."
      />
    );
  }
  return (
    <FlatList
      data={data}
      keyExtractor={(r) => String(r.player_id)}
      contentContainerStyle={{ padding: spacing.lg, paddingBottom: 40 }}
      ListHeaderComponent={
        <View style={[styles.row, styles.headRow, styles.playerHead]}>
          <Text style={[styles.rank, styles.head]}>#</Text>
          <Text style={[styles.team, styles.head]}>Oyuncu</Text>
          <Text style={[styles.num, styles.head, { width: 30 }]}>O</Text>
          <Text style={[styles.num, styles.head, styles.pts]}>{kind === 'goals' ? 'G' : 'A'}</Text>
        </View>
      }
      renderItem={({ item: r, index }) => <PlayerRow r={r} index={index} kind={kind} last={index === data.length - 1} />}
    />
  );
}

const POS_LABEL: Record<string, string> = { GK: 'KL', DEF: 'DEF', MID: 'OS', FWD: 'FOR' };

function PlayerRow({ r, index, kind, last }: { r: PlayerStatRow; index: number; kind: 'goals' | 'assists'; last: boolean }) {
  const main = kind === 'goals' ? r.goals : r.assists;
  return (
    <View style={[styles.row, styles.playerRow, index % 2 === 1 && { backgroundColor: colors.surface2 }, last && styles.playerLast]}>
      <Text style={[styles.rank, index < 3 && { color: colors.gold }]}>{index + 1}</Text>
      <View style={styles.teamWrap}>
        <TeamLogo uri={r.player.team?.logo} size={22} name={r.player.team?.name ?? ''} />
        <View style={{ flex: 1 }}>
          <Text style={styles.teamName} numberOfLines={1}>
            {r.player.name}
          </Text>
          <Muted style={{ fontSize: 11 }} numberOfLines={1}>
            {r.player.team?.name} · {POS_LABEL[r.player.position] ?? r.player.position}
          </Muted>
        </View>
      </View>
      <Text style={[styles.num, { width: 30 }]}>{r.apps}</Text>
      <Text style={[styles.num, styles.pts]}>{main}</Text>
    </View>
  );
}

function zoneColor(desc: string | null) {
  if (!desc) return 'transparent';
  const d = desc.toLowerCase();
  if (d.includes('champions league')) return colors.info;
  if (d.includes('europa league')) return colors.warn;
  if (d.includes('conference')) return colors.success;
  if (d.includes('relegation')) return colors.danger;
  if (d.includes('promotion')) return colors.primary;
  if (d.includes('play')) return colors.gold;
  return colors.textDim;
}

function Legend({ rows }: { rows: StandingRow[] }) {
  const items = [...new Set(rows.map((r) => r.description).filter(Boolean))] as string[];
  if (!items.length) return null;
  return (
    <View style={{ gap: 6 }}>
      {items.map((d) => (
        <View key={d} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: zoneColor(d) }} />
          <Muted>{d}</Muted>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  leagueItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  leagueLogoWrap: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  leagueLogo: { width: 30, height: 30 },
  leagueName: { color: colors.text, fontSize: 15, fontWeight: '700', marginBottom: 2 },
  flag: { width: 14, height: 10, borderRadius: 2 },
  liveRow: { backgroundColor: 'rgba(239,68,68,0.06)' },
  table: { backgroundColor: colors.surface, borderRadius: radius.lg, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  groupTitle: { color: colors.text, fontWeight: '800', padding: spacing.md, paddingBottom: 0 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingRight: spacing.sm },
  headRow: { backgroundColor: colors.surface3 },
  head: { color: colors.textMuted, fontSize: 11, fontWeight: '700' },
  rankWrap: { width: 36, flexDirection: 'row', alignItems: 'center', gap: 6 },
  rankBar: { width: 3, height: 20, borderRadius: 2 },
  rank: { color: colors.textMuted, fontSize: 12, fontWeight: '700', width: 36, textAlign: 'center' },
  team: { flex: 1, paddingLeft: 4 },
  teamWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  teamName: { color: colors.text, fontSize: 13, fontWeight: '600', flex: 1, minWidth: 0 },
  liveBadge: { paddingHorizontal: 6, paddingVertical: 1, flexShrink: 0 },
  num: { color: colors.textMuted, fontSize: 12, width: 26, textAlign: 'center', fontVariant: ['tabular-nums'] },
  pts: { color: colors.text, fontWeight: '800', width: 30 },
  tabs: {
    flexDirection: 'row',
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    padding: 4,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  tab: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: radius.sm },
  tabActive: { backgroundColor: colors.surface3 },
  tabText: { color: colors.textMuted, fontSize: 12, fontWeight: '600' },
  tabTextActive: { color: colors.text, fontWeight: '800' },
  playerHead: { borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  playerRow: { backgroundColor: colors.surface, borderLeftWidth: StyleSheet.hairlineWidth, borderRightWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  playerLast: { borderBottomLeftRadius: radius.lg, borderBottomRightRadius: radius.lg, borderBottomWidth: StyleSheet.hairlineWidth },
});
