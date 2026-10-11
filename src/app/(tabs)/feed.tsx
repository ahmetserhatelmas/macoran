import { useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { SharedCouponCard } from '@/components/SharedCouponCard';
import { BalancePill } from '@/components/BalancePill';
import { NotificationBell } from '@/components/NotificationBell';
import { EmptyState, Header, Loading, Screen } from '@/components/ui';
import { type CouponFeedFilter, useCouponFeed } from '@/lib/queries';
import { colors, radius, spacing } from '@/lib/theme';

const FILTERS: { key: CouponFeedFilter; label: string }[] = [
  { key: 'latest', label: 'Yeni' },
  { key: 'hot', label: 'Beğenilen' },
  { key: 'mine', label: 'Benim' },
];

export default function FeedScreen() {
  const [filter, setFilter] = useState<CouponFeedFilter>('latest');
  const { data, isLoading, refetch, isRefetching } = useCouponFeed(filter);

  return (
    <Screen>
      <Header
        title="Kupon Akışı"
        subtitle="Paylaşılan kuponlar"
        right={
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <NotificationBell />
            <BalancePill />
          </View>
        }
      />
      <View style={styles.filters}>
        {FILTERS.map((f) => (
          <Pressable key={f.key} onPress={() => setFilter(f.key)} style={[styles.filter, filter === f.key && styles.filterActive]}>
            <Text style={[styles.filterText, filter === f.key && styles.filterTextActive]}>{f.label}</Text>
          </Pressable>
        ))}
      </View>
      {isLoading ? (
        <Loading />
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(c) => c.id}
          renderItem={({ item }) => <SharedCouponCard coupon={item} />}
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

const styles = StyleSheet.create({
  filters: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg },
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
});
