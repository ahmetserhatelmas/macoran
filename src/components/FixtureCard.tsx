import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { memo } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { OddButton } from '@/components/OddButton';
import { TeamLogo } from '@/components/TeamLogo';
import { Badge } from '@/components/ui';
import { time } from '@/lib/format';
import { canBet, isFinished, isLive, liveBettingLocked, pick1X2, statusLabel } from '@/lib/markets';
import { colors, radius, spacing } from '@/lib/theme';
import { useBetslip } from '@/store/betslip';
import { useFavorites } from '@/store/favorites';
import type { FixtureWithRelations, Odd } from '@/types/db';

interface Props {
  fixture: FixtureWithRelations;
  showLeague?: boolean;
}

export const FixtureCard = memo(function FixtureCard({ fixture: f, showLeague }: Props) {
  const router = useRouter();
  const toggle = useBetslip((s) => s.toggle);
  const selections = useBetslip((s) => s.selections);
  const live = isLive(f.status_short);
  const finished = isFinished(f.status_short);
  const odds = pick1X2(f.odds);
  const bettable = canBet(f.status_short);
  const locked = liveBettingLocked(f.status_short, f.live_odds_at);

  const isSel = (o?: Odd) => !!o && selections.some((s) => s.fixture_id === f.id && s.market === o.market && s.selection === o.selection && Number(s.line) === Number(o.line));

  const onOdd = (o?: Odd) => {
    if (!o) return;
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
  };

  const scoreShown = live || finished || f.home_goals !== null;
  const favored = useFavorites((s) => s.ids.includes(f.id));
  const toggleFav = useFavorites((s) => s.toggle);

  const onFav = () => {
    if (Platform.OS !== 'web') Haptics.selectionAsync();
    toggleFav(f.id);
  };

  return (
    <Pressable onPress={() => router.push(`/match/${f.id}`)} style={({ pressed }) => [styles.card, favored && styles.cardFav, pressed && { opacity: 0.9 }]}>
      <View style={styles.top}>
        <View style={styles.statusCol}>
          {live ? (
            <Badge text={statusLabel(f.status_short, f.elapsed)} color="rgba(239,68,68,0.15)" textColor={colors.live} dot />
          ) : finished ? (
            <Badge text={statusLabel(f.status_short, f.elapsed)} color={colors.surface3} textColor={colors.textMuted} />
          ) : f.status_short === 'NS' ? (
            <Text style={styles.time}>{time(f.date)}</Text>
          ) : (
            <Badge text={statusLabel(f.status_short, f.elapsed)} color={colors.surface3} textColor={colors.warn} />
          )}
          {showLeague ? (
            <Text style={styles.league} numberOfLines={1}>
              {f.league.name}
            </Text>
          ) : null}
        </View>

        <View style={styles.teams}>
          <View style={styles.teamRow}>
            <TeamLogo uri={f.home.logo} size={22} name={f.home.name} />
            <Text style={[styles.team, finished && f.home_goals! < f.away_goals! && styles.loser]} numberOfLines={1}>
              {f.home.name}
            </Text>
            {scoreShown ? <Text style={[styles.score, live && { color: colors.live }]}>{f.home_goals ?? '-'}</Text> : null}
          </View>
          <View style={styles.teamRow}>
            <TeamLogo uri={f.away.logo} size={22} name={f.away.name} />
            <Text style={[styles.team, finished && f.away_goals! < f.home_goals! && styles.loser]} numberOfLines={1}>
              {f.away.name}
            </Text>
            {scoreShown ? <Text style={[styles.score, live && { color: colors.live }]}>{f.away_goals ?? '-'}</Text> : null}
          </View>
        </View>
        <Pressable onPress={onFav} hitSlop={10} style={styles.favBtn}>
          <Ionicons name={favored ? 'star' : 'star-outline'} size={20} color={favored ? colors.gold : colors.textDim} />
        </Pressable>
      </View>

      {bettable ? (
        <View style={styles.odds}>
          <OddButton label="1" odd={odds['1']?.odd} suspended={locked || odds['1']?.suspended} selected={isSel(odds['1'])} onPress={() => onOdd(odds['1'])} compact />
          <OddButton label="X" odd={odds.X?.odd} suspended={locked || odds.X?.suspended} selected={isSel(odds.X)} onPress={() => onOdd(odds.X)} compact />
          <OddButton label="2" odd={odds['2']?.odd} suspended={locked || odds['2']?.suspended} selected={isSel(odds['2'])} onPress={() => onOdd(odds['2'])} compact />
        </View>
      ) : null}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    gap: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  cardFav: { borderColor: 'rgba(251,191,36,0.35)' },
  top: { flexDirection: 'row', gap: spacing.md, alignItems: 'center' },
  favBtn: { padding: 4, marginTop: -2, alignSelf: 'flex-start' },
  statusCol: { width: 64, alignItems: 'flex-start', gap: 6 },
  time: { color: colors.text, fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] },
  league: { color: colors.textDim, fontSize: 10, fontWeight: '600', width: 64 },
  teams: { flex: 1, gap: 6 },
  teamRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  team: { color: colors.text, fontSize: 14, fontWeight: '600', flex: 1 },
  loser: { color: colors.textMuted, fontWeight: '500' },
  score: { color: colors.text, fontSize: 15, fontWeight: '800', width: 22, textAlign: 'right', fontVariant: ['tabular-nums'] },
  odds: { flexDirection: 'row', gap: 6 },
});
