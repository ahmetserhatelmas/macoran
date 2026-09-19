import Ionicons from '@expo/vector-icons/Ionicons';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { EmptyState, Header, IconButton, Loading, Muted, Screen } from '@/components/ui';
import { ago } from '@/lib/format';
import { useNotifications } from '@/lib/queries';
import { supabase } from '@/lib/supabase';
import { colors, radius, spacing } from '@/lib/theme';
import type { AppNotification } from '@/types/db';

const ICON: Record<string, { name: React.ComponentProps<typeof Ionicons>['name']; color: string }> = {
  goal: { name: 'football', color: colors.success },
  bet_won: { name: 'trophy', color: colors.gold },
  bet_lost: { name: 'close-circle', color: colors.danger },
  bet_void: { name: 'refresh-circle', color: colors.info },
  bet_cashout: { name: 'cash-outline', color: colors.gold },
};

export default function NotificationsScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const { data = [], isLoading } = useNotifications();

  useEffect(() => {
    const unread = data.filter((n) => !n.read_at).map((n) => n.id);
    if (!unread.length) return;
    supabase.rpc('mark_notifications_read', { p_ids: unread }).then(() => {
      qc.invalidateQueries({ queryKey: ['notifications'] });
    });
  }, [data, qc]);

  const open = (n: AppNotification) => {
    if (n.fixture_id) router.push(`/match/${n.fixture_id}`);
    else if (n.type.startsWith('bet_')) router.push('/(tabs)/bets');
  };

  return (
    <Screen>
      <Header title="Bildirimler" left={<IconButton icon="chevron-back" onPress={() => router.back()} />} />
      {isLoading ? (
        <Loading />
      ) : (
        <FlatList
          data={data}
          keyExtractor={(n) => n.id}
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: 40, gap: spacing.sm, flexGrow: 1 }}
          ListEmptyComponent={<EmptyState icon="notifications-outline" title="Bildirim yok" subtitle="Kupon sonucu ve oynadığın maçlardaki goller burada görünür." />}
          renderItem={({ item: n }) => {
            const ic = ICON[n.type] ?? { name: 'notifications-outline' as const, color: colors.textMuted };
            return (
              <Pressable onPress={() => open(n)} style={({ pressed }) => [styles.row, !n.read_at && styles.unread, pressed && { opacity: 0.85 }]}>
                <Ionicons name={ic.name} size={22} color={ic.color} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.title}>{n.title}</Text>
                  <Text style={styles.body}>{n.body}</Text>
                  <Muted style={{ fontSize: 11, marginTop: 4 }}>{ago(n.created_at)}</Muted>
                </View>
              </Pressable>
            );
          }}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    alignItems: 'flex-start',
  },
  unread: { borderColor: 'rgba(34,197,94,0.35)' },
  title: { color: colors.text, fontWeight: '800', fontSize: 14 },
  body: { color: colors.textMuted, fontSize: 13, marginTop: 2, lineHeight: 18 },
});
