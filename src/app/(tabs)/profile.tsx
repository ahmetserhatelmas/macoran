import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Badge, Button, Card, Header, Muted, Screen, SectionTitle } from '@/components/ui';
import { dateTime, money } from '@/lib/format';
import { useMyTransactions } from '@/lib/queries';
import { colors, radius, spacing } from '@/lib/theme';
import { useAuth } from '@/store/auth';
import type { Transaction } from '@/types/db';

const TX_META: Record<Transaction['type'], { label: string; icon: 'add-circle' | 'remove-circle' | 'ticket' | 'trophy' | 'refresh-circle'; color: string }> = {
  grant: { label: 'Bakiye yüklendi', icon: 'add-circle', color: colors.success },
  deduct: { label: 'Bakiye düşüldü', icon: 'remove-circle', color: colors.danger },
  bet: { label: 'Kupon oynandı', icon: 'ticket', color: colors.textMuted },
  win: { label: 'Kupon kazandı', icon: 'trophy', color: colors.gold },
  refund: { label: 'İade', icon: 'refresh-circle', color: colors.info },
};

export default function ProfileScreen() {
  const router = useRouter();
  const profile = useAuth((s) => s.profile);
  const signOut = useAuth((s) => s.signOut);
  const { data: tx = [] } = useMyTransactions();

  const confirmSignOut = () =>
    Alert.alert('Çıkış', 'Hesabından çıkmak istiyor musun?', [
      { text: 'Vazgeç', style: 'cancel' },
      { text: 'Çıkış Yap', style: 'destructive', onPress: signOut },
    ]);

  return (
    <Screen>
      <Header title="Profil" />
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <View style={{ paddingHorizontal: spacing.lg, gap: spacing.md }}>
          <Card style={styles.balanceCard}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{(profile?.username ?? profile?.email ?? '?')[0]?.toUpperCase()}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={styles.username}>{profile?.username ?? '-'}</Text>
                  {profile?.is_admin ? <Badge text="ADMIN" color="rgba(251,191,36,0.15)" textColor={colors.gold} /> : null}
                </View>
                <Muted>{profile?.email}</Muted>
              </View>
            </View>
            <View style={styles.balanceRow}>
              <View>
                <Muted>Sanal bakiye</Muted>
                <Text style={styles.balance}>{money(profile?.balance ?? 0)}</Text>
              </View>
              <Ionicons name="wallet" size={36} color={colors.gold} />
            </View>
            <Muted style={{ fontSize: 12 }}>Bakiye admin tarafından yüklenir. Bu uygulamada gerçek para kullanılmaz.</Muted>
          </Card>

          {profile?.is_admin ? (
            <Button title="Admin Paneli" icon="shield-checkmark" variant="secondary" onPress={() => router.push('/admin')} />
          ) : null}
        </View>

        <SectionTitle>Hesap Hareketleri</SectionTitle>
        <View style={{ paddingHorizontal: spacing.lg, gap: spacing.sm }}>
          {tx.length === 0 ? <Muted>Henüz hareket yok.</Muted> : null}
          {tx.map((t) => {
            const m = TX_META[t.type];
            return (
              <View key={t.id} style={styles.tx}>
                <Ionicons name={m.icon} size={22} color={m.color} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.txLabel}>{t.note || m.label}</Text>
                  <Muted style={{ fontSize: 11 }}>{dateTime(t.created_at)}</Muted>
                </View>
                <Text style={[styles.txAmount, { color: t.amount >= 0 ? colors.success : colors.text }]}>{money(t.amount, { sign: true })}</Text>
              </View>
            );
          })}
        </View>

        <View style={{ padding: spacing.lg, paddingTop: spacing.xl }}>
          <Button title="Çıkış Yap" variant="ghost" icon="log-out-outline" onPress={confirmSignOut} />
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  balanceCard: { gap: spacing.lg },
  avatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.primaryText, fontSize: 22, fontWeight: '900' },
  username: { color: colors.text, fontSize: 18, fontWeight: '800' },
  balanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface2,
    padding: spacing.md,
    borderRadius: radius.md,
  },
  balance: { color: colors.text, fontSize: 28, fontWeight: '900', fontVariant: ['tabular-nums'], marginTop: 2 },
  tx: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  txLabel: { color: colors.text, fontWeight: '600', fontSize: 13 },
  txAmount: { fontWeight: '800', fontVariant: ['tabular-nums'] },
});
