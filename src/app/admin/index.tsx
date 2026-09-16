import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { Badge, EmptyState, Header, IconButton, Input, Muted, Screen } from '@/components/ui';
import { ago, dayjs, money } from '@/lib/format';
import { useAdminStats, useAdminUsers } from '@/lib/queries';
import { colors, radius, spacing } from '@/lib/theme';
import { useAuth } from '@/store/auth';

export default function AdminScreen() {
  const router = useRouter();
  const isAdmin = useAuth((s) => s.profile?.is_admin);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const { data: users = [], isLoading, refetch, isRefetching } = useAdminUsers(debounced);
  const { data: stats } = useAdminStats();

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    if (isAdmin === false) router.replace('/(tabs)');
  }, [isAdmin, router]);

  return (
    <Screen>
      <Header title="Admin Paneli" subtitle="Kullanıcılar ve bakiye yönetimi" left={<IconButton icon="chevron-back" onPress={() => router.back()} />} />

      <FlatList
        data={users}
        keyExtractor={(u) => u.id}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />}
        contentContainerStyle={{ paddingBottom: 40 }}
        ListHeaderComponent={
          <View style={{ gap: spacing.md, paddingHorizontal: spacing.lg, paddingBottom: spacing.md }}>
            {stats ? (
              <View style={styles.statsRow}>
                <Stat icon="people" label="Kullanıcı" value={String(stats.users)} />
                <Stat icon="wallet" label="Toplam Bakiye" value={money(stats.total_balance)} />
                <Stat icon="receipt" label="Açık Kupon" value={String(stats.open_bets)} />
                <Stat icon="radio" label="Canlı Maç" value={String(stats.live_fixtures)} color={colors.live} />
              </View>
            ) : null}

            <Pressable onPress={() => router.push('/admin/sim')} style={({ pressed }) => [styles.simCard, pressed && { opacity: 0.85 }]}>
              <View style={styles.simIcon}>
                <Ionicons name="game-controller" size={20} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.simTitle}>Simülasyon</Text>
                <Muted style={{ fontSize: 12 }}>
                  {stats?.sim
                    ? `${stats.sim.started_leagues} lig aktif · ${stats.sim.upcoming} maç sırada · ${stats.sim.players} oyuncu`
                    : 'Ligi başlat, hız ve senaryo ayarları'}
                </Muted>
                {stats?.sim?.last_tick_at ? (
                  <Muted style={{ fontSize: 11 }}>Motor: {ago(stats.sim.last_tick_at)}{stats.sim.last_tick_message ? ` · ${stats.sim.last_tick_message}` : ''}</Muted>
                ) : null}
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textDim} />
            </Pressable>

            <Pressable onPress={() => router.push('/admin/live')} style={({ pressed }) => [styles.simCard, pressed && { opacity: 0.85 }]}>
              <View style={[styles.simIcon, { backgroundColor: 'rgba(239,68,68,0.12)' }]}>
                <Ionicons name="football" size={20} color={colors.live} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.simTitle}>Canlı skor</Text>
                <Muted style={{ fontSize: 12 }}>Oynanan maçlara gol ekle veya sil; oranlar anında güncellenir.</Muted>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textDim} />
            </Pressable>

            {stats?.last_sync?.length ? (
              <View style={styles.sync}>
                <Text style={styles.syncTitle}>Son İşlemler</Text>
                {stats.last_sync.map((s) => (
                  <View key={s.job} style={styles.syncRow}>
                    <View style={[styles.syncDot, { backgroundColor: s.ok ? colors.success : colors.danger }]} />
                    <Text style={styles.syncJob}>{s.job}</Text>
                    <Muted style={{ flex: 1, fontSize: 11 }} >{s.message}</Muted>
                    <Muted style={{ fontSize: 11 }}>{ago(s.at)}</Muted>
                  </View>
                ))}
              </View>
            ) : null}

            <Input icon="search" placeholder="E-posta veya kullanıcı adı ara" value={search} onChangeText={setSearch} autoCapitalize="none" />
          </View>
        }
        renderItem={({ item: u }) => (
          <Pressable onPress={() => router.push(`/admin/${u.id}`)} style={({ pressed }) => [styles.user, pressed && { opacity: 0.85 }]}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{(u.username ?? u.email)[0]?.toUpperCase()}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={styles.username}>{u.username ?? '-'}</Text>
                {u.is_admin ? <Badge text="ADMIN" color="rgba(251,191,36,0.15)" textColor={colors.gold} /> : null}
              </View>
              <Muted style={{ fontSize: 12 }}>{u.email}</Muted>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={styles.balance}>{money(u.balance)}</Text>
              <Muted style={{ fontSize: 11 }}>{dayjs(u.created_at).format('D MMM')}</Muted>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textDim} />
          </Pressable>
        )}
        ListEmptyComponent={!isLoading ? <EmptyState icon="people-outline" title="Kullanıcı bulunamadı" /> : null}
      />
    </Screen>
  );
}

function Stat({ icon, label, value, color = colors.text }: { icon: 'people' | 'wallet' | 'receipt' | 'radio'; label: string; value: string; color?: string }) {
  return (
    <View style={styles.stat}>
      <Ionicons name={icon} size={16} color={colors.textMuted} />
      <Text style={[styles.statValue, { color }]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Muted style={{ fontSize: 10 }}>{label}</Muted>
    </View>
  );
}

const styles = StyleSheet.create({
  statsRow: { flexDirection: 'row', gap: spacing.sm },
  stat: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.sm, gap: 4, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  statValue: { fontWeight: '800', fontSize: 14, fontVariant: ['tabular-nums'] },
  simCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md,
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: 'rgba(34,197,94,0.35)',
  },
  simIcon: { width: 40, height: 40, borderRadius: radius.md, backgroundColor: 'rgba(34,197,94,0.12)', alignItems: 'center', justifyContent: 'center' },
  simTitle: { color: colors.text, fontWeight: '800', fontSize: 14 },
  sync: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, gap: 6, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  syncTitle: { color: colors.textMuted, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 2 },
  syncRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  syncDot: { width: 8, height: 8, borderRadius: 4 },
  syncJob: { color: colors.text, fontSize: 12, fontWeight: '700', width: 104 },
  user: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface3, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.text, fontWeight: '800' },
  username: { color: colors.text, fontWeight: '700', fontSize: 14 },
  balance: { color: colors.text, fontWeight: '800', fontVariant: ['tabular-nums'] },
});
