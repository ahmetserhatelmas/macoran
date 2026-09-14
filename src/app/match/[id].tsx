import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { BetslipBar } from '@/components/BetslipBar';
import { MatchStats } from '@/components/MatchStats';
import { MatchTimeline } from '@/components/MatchTimeline';
import { OddButton } from '@/components/OddButton';
import { TeamLogo } from '@/components/TeamLogo';
import { Badge, EmptyState, Header, IconButton, Loading, Muted, Screen } from '@/components/ui';
import { ago, dateTime, dayjs } from '@/lib/format';
import { canBet, groupOdds, isFinished, isLive, MARKET_CATEGORIES, selectionLabel, statusLabel } from '@/lib/markets';
import { useFixture, useFixtureDetail } from '@/lib/queries';
import { colors, radius, spacing } from '@/lib/theme';
import { useBetslip } from '@/store/betslip';
import type { Odd } from '@/types/db';

type Tab = 'odds' | 'stats' | 'timeline';
const TAB_LABELS: Record<Tab, string> = { odds: 'Oranlar', stats: 'İstatistikler', timeline: 'Anlatım' };

export default function MatchScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const fixtureId = Number(id);
  const { data: f, isLoading } = useFixture(fixtureId);
  const toggle = useBetslip((s) => s.toggle);
  const selections = useBetslip((s) => s.selections);
  const syncOdds = useBetslip((s) => s.syncOdds);

  useEffect(() => {
    if (f) syncOdds(f.odds);
  }, [f, syncOdds]);

  const groups = useMemo(() => (f ? groupOdds(f.odds) : []), [f]);
  const [category, setCategory] = useState('all');
  const visibleGroups = useMemo(() => {
    const cat = MARKET_CATEGORIES.find((c) => c.key === category);
    if (!cat?.markets) return groups;
    const set = new Set(cat.markets);
    return groups.filter((g) => set.has(g.market));
  }, [groups, category]);

  const liveNow = f ? isLive(f.status_short) : false;
  const finishedNow = f ? isFinished(f.status_short) : false;
  const detail = useFixtureDetail(fixtureId, liveNow, liveNow || finishedNow);
  const [tabState, setTab] = useState<Tab | null>(null);
  // Bitmiş maçta bahis kapalı olduğundan varsayılan sekme Anlatım
  const tab: Tab = tabState ?? (finishedNow ? 'timeline' : 'odds');

  if (isLoading || !f) {
    return (
      <Screen>
        <Header title="Maç" left={<IconButton icon="chevron-back" onPress={() => router.back()} />} />
        {isLoading ? <Loading /> : <EmptyState title="Maç bulunamadı" />}
      </Screen>
    );
  }

  const live = isLive(f.status_short);
  const finished = isFinished(f.status_short);
  const bettable = canBet(f.status_short);
  const anyLiveOdd = f.odds.some((o) => o.is_live);
  const lastOddChange = f.odds.reduce<string | null>((acc, o) => (!acc || o.updated_at > acc ? o.updated_at : acc), null);
  // Canlıda oranlar değişmese de API ile doğrulanır; o zamanı göster
  const lastUpdate = live && f.live_odds_at && (!lastOddChange || f.live_odds_at > lastOddChange) ? f.live_odds_at : lastOddChange;

  const isSel = (o: Odd) => selections.some((s) => s.fixture_id === f.id && s.market === o.market && s.selection === o.selection && Number(s.line) === Number(o.line));
  const onOdd = (o: Odd) =>
    toggle({
      fixture_id: f.id,
      market: o.market,
      selection: o.selection,
      line: Number(o.line),
      odd: Number(o.odd),
      is_live: o.is_live,
      home_name: f.home.name,
      away_name: f.away.name,
      league_name: f.league.name,
      fixture_date: f.date,
    });

  return (
    <Screen edges={['top']}>
      <Header title={f.league.name} subtitle={f.round ?? undefined} left={<IconButton icon="chevron-back" onPress={() => router.back()} />} />
      <ScrollView contentContainerStyle={{ paddingBottom: 140 }}>
        {/* Skor kartı */}
        <View style={styles.scoreCard}>
          <View style={styles.statusRow}>
            {live ? (
              <Badge text={`CANLI · ${statusLabel(f.status_short, f.elapsed)}`} color="rgba(239,68,68,0.15)" textColor={colors.live} dot />
            ) : finished ? (
              <Badge text={statusLabel(f.status_short, f.elapsed)} color={colors.surface3} textColor={colors.textMuted} />
            ) : (
              <Badge text={f.status_short === 'NS' ? dateTime(f.date) : statusLabel(f.status_short, f.elapsed)} color={colors.surface3} textColor={colors.text} />
            )}
          </View>

          <View style={styles.teamsRow}>
            <View style={styles.teamCol}>
              <TeamLogo uri={f.home.logo} size={64} name={f.home.name} />
              <Text style={styles.teamName} numberOfLines={2}>
                {f.home.name}
              </Text>
            </View>

            <View style={styles.scoreCol}>
              {live || finished || f.home_goals !== null ? (
                <Text style={[styles.score, live && { color: colors.live }]}>
                  {f.home_goals ?? 0} - {f.away_goals ?? 0}
                </Text>
              ) : (
                <Text style={styles.kickoff}>{dayjs(f.date).format('HH:mm')}</Text>
              )}
              {f.ht_home !== null ? <Muted style={{ fontSize: 12 }}>İY {f.ht_home}-{f.ht_away}</Muted> : null}
              {f.pen_home !== null ? <Muted style={{ fontSize: 12 }}>Pen {f.pen_home}-{f.pen_away}</Muted> : null}
            </View>

            <View style={styles.teamCol}>
              <TeamLogo uri={f.away.logo} size={64} name={f.away.name} />
              <Text style={styles.teamName} numberOfLines={2}>
                {f.away.name}
              </Text>
            </View>
          </View>
          {f.venue ? <Muted style={{ textAlign: 'center', fontSize: 12 }}>{f.venue}</Muted> : null}
        </View>

        {/* Sekmeler: Oranlar / İstatistikler / Anlatım */}
        {live || finished ? (
          <View style={styles.tabs}>
            {(Object.keys(TAB_LABELS) as Tab[]).map((t) => (
              <Pressable key={t} onPress={() => setTab(t)} style={[styles.tab, tab === t && styles.tabActive]}>
                <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>{TAB_LABELS[t]}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        {tab === 'stats' ? (
          <View style={{ paddingHorizontal: spacing.lg }}>
            {detail.isLoading ? (
              <Loading />
            ) : (
              <MatchStats stats={detail.data?.statistics ?? []} homeId={f.home_team_id} homeName={f.home.name} awayName={f.away.name} live={live} />
            )}
            {detail.data?.updated_at ? (
              <Muted style={{ fontSize: 11, textAlign: 'center', marginTop: spacing.sm }}>
                Güncelleme {ago(detail.data.updated_at)}
                {live ? ' · 10 sn\u2019de bir yenilenir' : ''}
              </Muted>
            ) : null}
          </View>
        ) : tab === 'timeline' ? (
          <View style={{ paddingHorizontal: spacing.lg }}>
            {detail.isLoading ? (
              <Loading />
            ) : (
              <MatchTimeline
                events={detail.data?.events ?? []}
                homeId={f.home_team_id}
                homeName={f.home.name}
                awayName={f.away.name}
                homeGoals={f.home_goals}
                awayGoals={f.away_goals}
                status={f.status_short}
                elapsed={f.elapsed}
                live={live}
                finished={finished}
              />
            )}
          </View>
        ) : !bettable ? (
          <EmptyState icon="lock-closed-outline" title="Bahis kapalı" subtitle={finished ? 'Maç sona erdi.' : 'Bu maç için bahis alınamıyor.'} />
        ) : groups.length === 0 ? (
          <EmptyState icon="hourglass-outline" title="Oranlar bekleniyor" subtitle={live ? 'Canlı oranlar birkaç saniye içinde gelir.' : 'Bu maç için oranlar henüz yayınlanmadı.'} />
        ) : (
          <View style={{ paddingHorizontal: spacing.lg, gap: spacing.md }}>
            <View style={styles.oddsInfo}>
              <Badge text={anyLiveOdd ? 'Canlı Oranlar' : 'Maç Öncesi Oranlar'} color={anyLiveOdd ? 'rgba(239,68,68,0.15)' : colors.surface3} textColor={anyLiveOdd ? colors.live : colors.textMuted} dot={anyLiveOdd} />
              {lastUpdate ? <Muted style={{ fontSize: 11 }}>Güncelleme {ago(lastUpdate)}</Muted> : null}
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.catRow}>
              {MARKET_CATEGORIES.map((c) => (
                <Pressable key={c.key} onPress={() => setCategory(c.key)} style={[styles.cat, category === c.key && styles.catActive]}>
                  <Text style={[styles.catText, category === c.key && styles.catTextActive]}>{c.label}</Text>
                </Pressable>
              ))}
            </ScrollView>
            {visibleGroups.length === 0 ? (
              <EmptyState icon="funnel-outline" title="Bu kategoride açık pazar yok" subtitle="Maç ilerledikçe kesinleşen pazarlar kapanır." />
            ) : null}
            {visibleGroups.map((g) => (
              <View key={g.key} style={styles.market}>
                <Text style={styles.marketTitle}>{g.title}</Text>
                <View style={styles.marketGrid}>
                  {g.odds.map((o) => (
                    <View key={`${o.market}-${o.selection}-${o.line}`} style={{ width: `${100 / g.columns}%`, padding: 3 }}>
                      <OddButton
                        label={selectionLabel(o.market, o.selection, o.line, f.home.name, f.away.name)}
                        odd={o.odd}
                        suspended={o.suspended}
                        selected={isSel(o)}
                        onPress={() => onOdd(o)}
                      />
                    </View>
                  ))}
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
      <BetslipBar useSafeBottom />
    </Screen>
  );
}

const styles = StyleSheet.create({
  scoreCard: {
    margin: spacing.lg,
    marginTop: 0,
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    gap: spacing.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  statusRow: { flexDirection: 'row', justifyContent: 'center' },
  teamsRow: { flexDirection: 'row', alignItems: 'center' },
  teamCol: { flex: 1, alignItems: 'center', gap: spacing.sm },
  teamName: { color: colors.text, fontWeight: '700', fontSize: 14, textAlign: 'center' },
  scoreCol: { width: 110, alignItems: 'center', gap: 4 },
  score: { color: colors.text, fontSize: 36, fontWeight: '900', fontVariant: ['tabular-nums'], letterSpacing: -1 },
  kickoff: { color: colors.text, fontSize: 30, fontWeight: '900', fontVariant: ['tabular-nums'] },
  oddsInfo: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tabs: {
    flexDirection: 'row',
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    padding: 4,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  tab: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: radius.sm },
  tabActive: { backgroundColor: colors.surface3 },
  tabText: { color: colors.textMuted, fontSize: 13, fontWeight: '600' },
  tabTextActive: { color: colors.text, fontWeight: '800' },
  market: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  marketTitle: { color: colors.text, fontWeight: '800', fontSize: 14 },
  marketGrid: { flexDirection: 'row', flexWrap: 'wrap', margin: -3 },
  catRow: { gap: 6, paddingVertical: 2 },
  cat: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  catActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  catText: { color: colors.textMuted, fontSize: 12, fontWeight: '700' },
  catTextActive: { color: colors.primaryText },
});
