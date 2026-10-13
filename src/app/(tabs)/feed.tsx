import { useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { SharedCouponCard } from '@/components/SharedCouponCard';
import { BalancePill } from '@/components/BalancePill';
import { NotificationBell } from '@/components/NotificationBell';
import { EmptyState, Header, Loading, Screen } from '@/components/ui';
import { money } from '@/lib/format';
import { type CouponFeedFilter, type RankBoard, type RankRow, useCouponFeed, useCouponRanks } from '@/lib/queries';
import { colors, radius, spacing } from '@/lib/theme';

const FILTERS: { key: CouponFeedFilter | 'ranks'; label: string }[] = [
  { key: 'latest', label: 'Yeni' },
  { key: 'hot', label: 'Beğenilen' },
  { key: 'mine', label: 'Benim' },
  { key: 'ranks', label: 'Sıralama' },
];

const BOARDS: { key: RankBoard; label: string; hint: string }[] = [
  { key: 'day', label: 'Günün', hint: 'Bugün kazanılan para. Kayıp düşülmez.' },
  { key: 'week', label: 'Haftanın', hint: 'Bu hafta kazanılan para. Kayıp düşülmez.' },
  { key: 'total', label: 'Toplam', hint: 'Tüm zamanların kazancı. Kayıp düşülmez.' },
  { key: 'loss', label: 'Kayıp', hint: 'Kazanç eksi kayıp. En çok eksi yazanlar.' },
  { key: 'coupon', label: 'Tek kupon', hint: 'Tek kupondan gelen en yüksek kazanç.' },
];

export default function FeedScreen() {
  const [filter, setFilter] = useState<CouponFeedFilter | 'ranks'>('latest');
  const [board, setBoard] = useState<RankBoard>('week');
  const ranking = filter === 'ranks';
  const feed = useCouponFeed(ranking ? 'latest' : filter, !ranking);
  const ranks = useCouponRanks(board, ranking);
  const data = feed.data;
  const isLoading = ranking ? ranks.isLoading : feed.isLoading;
  const refetch = ranking ? ranks.refetch : feed.refetch;
  const isRefetching = ranking ? ranks.isRefetching : feed.isRefetching;
  const boardMeta = BOARDS.find((b) => b.key === board)!;

  return (
    <Screen>
      <Header
        title="Kupon Akışı"
        subtitle={ranking ? 'Sıralama' : 'Paylaşılan kuponlar'}
        right={
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <NotificationBell />
            <BalancePill />
          </View>
        }
      />
      <View style={styles.toolbar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll} contentContainerStyle={styles.filters}>
          {FILTERS.map((f) => (
            <Pressable key={f.key} onPress={() => setFilter(f.key)} style={[styles.filter, filter === f.key && styles.filterActive]}>
              <Text style={[styles.filterText, filter === f.key && styles.filterTextActive]}>{f.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
        {ranking ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll} contentContainerStyle={styles.filters}>
            {BOARDS.map((b) => (
              <Pressable key={b.key} onPress={() => setBoard(b.key)} style={[styles.filter, board === b.key && styles.filterActive]}>
                <Text style={[styles.filterText, board === b.key && styles.filterTextActive]}>{b.label}</Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}
        {ranking ? <Text style={styles.hint}>{boardMeta.hint}</Text> : null}
      </View>
      {isLoading ? (
        <Loading />
      ) : ranking ? (
        <FlatList
          data={ranks.data ?? []}
          keyExtractor={(r) => `${r.rank}-${r.username}`}
          renderItem={({ item }) => <RankLine row={item} loss={board === 'loss'} />}
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: 40, paddingTop: spacing.sm }}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />}
          ListEmptyComponent={
            <EmptyState
              icon="trophy-outline"
              title="Bu listede kimse yok"
              subtitle={board === 'loss' ? 'Kazançtan kayıp düşünce en çok eksi yazanlar.' : 'Kazanılan kuponların ödemesi. Kayıplar düşülmez.'}
            />
          }
        />
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(c) => c.id}
          renderItem={({ item }) => <SharedCouponCard coupon={item} />}
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: 40, paddingTop: spacing.md }}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />}
          ListEmptyComponent={
            <EmptyState
              icon="share-social-outline"
              title={filter === 'mine' ? 'Henüz paylaşımın yok' : 'Akış boş'}
              subtitle={
                filter === 'mine'
                  ? 'Kuponlarım sekmesinde bir kupona Paylaş de.'
                  : 'Oynadığın kuponu paylaş, başkaları da kupona alabilsin.'
              }
            />
          }
        />
      )}
    </Screen>
  );
}

function RankLine({ row, loss }: { row: RankRow; loss: boolean }) {
  const medal = row.rank === 1 ? colors.gold : row.rank === 2 ? '#C9D2DE' : row.rank === 3 ? '#D4926A' : colors.textMuted;
  const up = row.profit >= 0 && !loss;
  return (
    <View style={[styles.rank, row.mine && styles.rankMine]}>
      <Text style={[styles.place, { color: medal }]}>{row.rank}</Text>
      <View style={styles.avatar}>
        <Text style={styles.avatarTxt}>{(row.username || 'O').slice(0, 1).toUpperCase()}</Text>
      </View>
      <Text style={styles.user} numberOfLines={1}>
        {row.username}
        {row.mine ? '  · sen' : ''}
      </Text>
      <Text style={[styles.profit, { color: up ? colors.success : colors.danger }]}>{money(row.profit, { sign: true })}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  toolbar: { gap: 8, paddingBottom: 4 },
  chipScroll: { height: 36, flexGrow: 0 },
  filters: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg },
  hint: { color: colors.textDim, fontSize: 12, paddingHorizontal: spacing.lg, marginTop: 2 },
  filter: {
    paddingHorizontal: 14,
    height: 32,
    borderRadius: radius.full,
    backgroundColor: colors.surface2,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  filterActive: { backgroundColor: colors.text, borderColor: colors.text },
  filterText: { color: colors.textMuted, fontSize: 13, fontWeight: '600' },
  filterTextActive: { color: colors.bg },
  rank: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  rankMine: { borderColor: colors.primary },
  place: { width: 28, fontSize: 16, fontWeight: '800', fontVariant: ['tabular-nums'] },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surface3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarTxt: { color: colors.text, fontWeight: '800' },
  user: { flex: 1, color: colors.text, fontWeight: '700', fontSize: 14 },
  profit: { fontWeight: '800', fontSize: 14, fontVariant: ['tabular-nums'] },
});
