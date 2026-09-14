import Ionicons from '@expo/vector-icons/Ionicons';
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { STATUS_META } from '@/components/BetCard';
import { Badge, Button, Card, Header, IconButton, Input, Loading, Muted, Screen, SectionTitle } from '@/components/ui';
import { dateTime, money, odd as fmtOdd } from '@/lib/format';
import { humanizeError } from '@/lib/markets';
import { useAdminUser } from '@/lib/queries';
import { supabase } from '@/lib/supabase';
import { colors, radius, spacing } from '@/lib/theme';

const QUICK = [100, 500, 1000, 5000, 10000];

/** Input'a yazılacak bakiye metni (kuruş varsa 2 hane). */
function amountFromBalance(balance: number) {
  const n = Math.round(Number(balance) * 100) / 100;
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

function sameAmount(a: string, b: number) {
  return Math.round(Number(a) * 100) === Math.round(Number(b) * 100);
}

export default function AdminUserScreen() {
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { data, isLoading } = useAdminUser(userId);
  const [amount, setAmount] = useState('1000');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState<'grant' | 'deduct' | null>(null);

  const apply = async (sign: 1 | -1) => {
    const n = Number(amount);
    if (!n || n <= 0) return Alert.alert('Hata', 'Geçerli bir tutar girin.');
    if (sign === -1 && data && n > Number(data.profile.balance) + 0.005) {
      return Alert.alert('Hata', 'Kullanıcının bakiyesi bu tutardan az.');
    }

    const label = sign === 1 ? 'yükle' : 'düş';
    Alert.alert(
      sign === 1 ? 'Bakiye Yükle' : 'Bakiye Düş',
      `${data?.profile.username ?? data?.profile.email} hesabına ${money(n)} ${label}nsin mi?`,
      [
        { text: 'Vazgeç', style: 'cancel' },
        {
          text: 'Onayla',
          style: sign === 1 ? 'default' : 'destructive',
          onPress: async () => {
            setLoading(sign === 1 ? 'grant' : 'deduct');
            const { error } = await supabase.rpc('admin_adjust_balance', {
              p_user_id: userId,
              p_amount: sign * n,
              p_note: note.trim() || (sign === 1 ? 'Admin bakiye yüklemesi' : 'Admin bakiye düşümü'),
            });
            setLoading(null);
            if (error) return Alert.alert('Hata', humanizeError(error.message));
            setNote('');
            qc.invalidateQueries({ queryKey: ['admin'] });
          },
        },
      ]
    );
  };

  if (isLoading || !data) {
    return (
      <Screen>
        <Header title="Kullanıcı" left={<IconButton icon="chevron-back" onPress={() => router.back()} />} />
        <Loading />
      </Screen>
    );
  }

  const { profile, transactions, bets } = data;

  return (
    <Screen>
      <Header title={profile.username ?? 'Kullanıcı'} subtitle={profile.email} left={<IconButton icon="chevron-back" onPress={() => router.back()} />} />
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          <View style={{ paddingHorizontal: spacing.lg, gap: spacing.md }}>
            <Card style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <View>
                <Muted>Mevcut bakiye</Muted>
                <Text style={styles.balance}>{money(profile.balance)}</Text>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 4 }}>
                {profile.is_admin ? <Badge text="ADMIN" color="rgba(251,191,36,0.15)" textColor={colors.gold} /> : null}
                <Muted style={{ fontSize: 11 }}>Kayıt: {dateTime(profile.created_at)}</Muted>
              </View>
            </Card>

            <Card style={{ gap: spacing.md }}>
              <Text style={styles.cardTitle}>Sanal Para İşlemi</Text>
              <Input
                label="Tutar (₺)"
                keyboardType="decimal-pad"
                value={amount}
                onChangeText={(v) => setAmount(v.replace(',', '.').replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1'))}
                icon="cash-outline"
              />
              <View style={styles.quick}>
                {QUICK.map((q) => (
                  <Pressable key={q} onPress={() => setAmount(String(q))} style={[styles.quickBtn, Number(amount) === q && styles.quickBtnActive]}>
                    <Text style={[styles.quickText, Number(amount) === q && { color: colors.primaryText }]}>{q >= 1000 ? `${q / 1000}K` : q}</Text>
                  </Pressable>
                ))}
                <Pressable
                  onPress={() => setAmount(amountFromBalance(profile.balance))}
                  style={[styles.quickBtn, styles.quickAll, sameAmount(amount, profile.balance) && styles.quickBtnActive]}
                >
                  <Text style={[styles.quickText, sameAmount(amount, profile.balance) && { color: colors.primaryText }]}>Hepsi</Text>
                </Pressable>
              </View>
              <Input label="Not (opsiyonel)" placeholder="Örn: Haftalık bonus" value={note} onChangeText={setNote} icon="create-outline" />
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <Button title="Bakiye Yükle" icon="add-circle" onPress={() => apply(1)} loading={loading === 'grant'} style={{ flex: 1 }} />
                <Button title="Düş" icon="remove-circle" variant="danger" onPress={() => apply(-1)} loading={loading === 'deduct'} style={{ flex: 0.6 }} />
              </View>
            </Card>
          </View>

          <SectionTitle>Son Kuponlar ({bets.length})</SectionTitle>
          <View style={{ paddingHorizontal: spacing.lg, gap: spacing.sm }}>
            {bets.length === 0 ? <Muted>Kupon yok.</Muted> : null}
            {bets.map((b) => {
              const m = STATUS_META[b.status];
              return (
                <View key={b.id} style={styles.row}>
                  <Ionicons name={m.icon} size={20} color={m.color} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle}>
                      {b.bet_selections?.length ?? 0} seçim · oran {fmtOdd(b.total_odd)}
                    </Text>
                    <Muted style={{ fontSize: 11 }}>{dateTime(b.created_at)}</Muted>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={styles.rowAmount}>{money(b.stake)}</Text>
                    <Muted style={{ fontSize: 11, color: m.color }}>{m.label}{b.payout ? ` · ${money(b.payout)}` : ''}</Muted>
                  </View>
                </View>
              );
            })}
          </View>

          <SectionTitle>Hesap Hareketleri ({transactions.length})</SectionTitle>
          <View style={{ paddingHorizontal: spacing.lg, gap: spacing.sm }}>
            {transactions.length === 0 ? <Muted>Hareket yok.</Muted> : null}
            {transactions.map((t) => (
              <View key={t.id} style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>{t.note || t.type}</Text>
                  <Muted style={{ fontSize: 11 }}>{dateTime(t.created_at)}</Muted>
                </View>
                <Text style={[styles.rowAmount, { color: t.amount >= 0 ? colors.success : colors.text }]}>{money(t.amount, { sign: true })}</Text>
              </View>
            ))}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  balance: { color: colors.text, fontSize: 26, fontWeight: '900', fontVariant: ['tabular-nums'] },
  cardTitle: { color: colors.text, fontWeight: '800', fontSize: 15 },
  quick: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  quickBtn: { flexGrow: 1, flexBasis: 48, height: 34, borderRadius: radius.sm, backgroundColor: colors.surface3, alignItems: 'center', justifyContent: 'center' },
  quickAll: { flexBasis: 64 },
  quickBtnActive: { backgroundColor: colors.primary },
  quickText: { color: colors.text, fontWeight: '700', fontSize: 13 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  rowTitle: { color: colors.text, fontWeight: '600', fontSize: 13 },
  rowAmount: { color: colors.text, fontWeight: '800', fontVariant: ['tabular-nums'] },
});
