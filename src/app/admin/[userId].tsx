import Ionicons from '@expo/vector-icons/Ionicons';
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { BetCard } from '@/components/BetCard';
import { Badge, Button, Card, Header, IconButton, Input, Loading, Muted, Screen, SectionTitle } from '@/components/ui';
import { banActive, banStatusLabel } from '@/lib/ban';
import { dateTime, money } from '@/lib/format';
import { humanizeError } from '@/lib/markets';
import { useAdminUser } from '@/lib/queries';
import { supabase } from '@/lib/supabase';
import { colors, radius, spacing } from '@/lib/theme';
import type { Profile } from '@/types/db';

const QUICK = [100, 500, 1000, 5000, 10000];
const BAN_HOURS = [
  { label: '1 saat', hours: 1 },
  { label: '1 gün', hours: 24 },
  { label: '7 gün', hours: 24 * 7 },
  { label: '30 gün', hours: 24 * 30 },
];

function BanCard({
  userId,
  profile,
  onDone,
}: {
  userId: string;
  profile: Profile;
  onDone: () => void;
}) {
  const [hours, setHours] = useState('24');
  const [busy, setBusy] = useState<'temporary' | 'permanent' | 'clear' | null>(null);
  const active = banActive(profile);
  const status = banStatusLabel(profile);

  const run = async (mode: 'temporary' | 'permanent' | 'clear', until?: string) => {
    setBusy(mode);
    const { error } = await supabase.rpc('admin_set_ban', {
      p_user_id: userId,
      p_mode: mode,
      p_until: until ?? null,
    });
    setBusy(null);
    if (error) return Alert.alert('Hata', humanizeError(error.message));
    onDone();
  };

  const askTemp = (h: number) => {
    if (!Number.isFinite(h) || h < 1 || h > 24 * 365) {
      return Alert.alert('Hata', '1 ile 8760 saat arasında bir süre girin.');
    }
    const until = new Date(Date.now() + Math.round(h) * 3600_000).toISOString();
    Alert.alert(
      active ? 'Ban süresini değiştir' : 'Süreli ban',
      `${profile.username ?? profile.email} hesabı ${dateTime(until)} tarihine kadar banlı kalsın mı?`,
      [
        { text: 'Vazgeç', style: 'cancel' },
        { text: active ? 'Güncelle' : 'Banla', style: 'destructive', onPress: () => run('temporary', until) },
      ],
    );
  };

  return (
    <Card style={{ gap: spacing.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={styles.cardTitle}>Hesap banı</Text>
        {active ? <Badge text="BANLI" color="rgba(239,68,68,0.15)" textColor={colors.danger} /> : <Badge text="AÇIK" color="rgba(34,197,94,0.15)" textColor={colors.success} />}
      </View>
      <Muted style={{ fontSize: 12 }}>
        {status ?? 'Ban yok. Süreli ban bitince hesap kendiliğinden açılır.'}
      </Muted>
      {profile.is_admin ? (
        <Muted style={{ fontSize: 12 }}>Admin hesap banlanamaz.</Muted>
      ) : (
        <>
          <View style={styles.quick}>
            {BAN_HOURS.map((p) => (
              <Pressable key={p.label} onPress={() => askTemp(p.hours)} style={styles.quickBtn}>
                <Text style={styles.quickText}>{p.label}</Text>
              </Pressable>
            ))}
          </View>
          <Input
            label="Özel süre (saat)"
            keyboardType="number-pad"
            value={hours}
            onChangeText={(v) => setHours(v.replace(/[^\d]/g, ''))}
            icon="time-outline"
          />
          <Button
            title={active && !profile.ban_permanent ? 'Süreyi değiştir' : 'Süreli banla'}
            icon="hourglass-outline"
            variant="secondary"
            loading={busy === 'temporary'}
            onPress={() => askTemp(Number(hours))}
          />
          <Button
            title="Kalıcı ban"
            icon="ban"
            variant="danger"
            loading={busy === 'permanent'}
            onPress={() =>
              Alert.alert('Kalıcı ban', `${profile.username ?? profile.email} kalıcı olarak banlansın mı?`, [
                { text: 'Vazgeç', style: 'cancel' },
                { text: 'Banla', style: 'destructive', onPress: () => run('permanent') },
              ])
            }
          />
          {status ? (
            <Button
              title="Banı kaldır"
              icon="lock-open-outline"
              variant="ghost"
              loading={busy === 'clear'}
              onPress={() =>
                Alert.alert('Banı kaldır', `${profile.username ?? profile.email} tekrar giriş yapabilsin mi?`, [
                  { text: 'Vazgeç', style: 'cancel' },
                  { text: 'Kaldır', onPress: () => run('clear') },
                ])
              }
            />
          ) : null}
        </>
      )}
    </Card>
  );
}

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
                {banActive(profile) ? <Badge text="BAN" color="rgba(239,68,68,0.15)" textColor={colors.danger} /> : null}
                <Muted style={{ fontSize: 11 }}>Kayıt: {dateTime(profile.created_at)}</Muted>
              </View>
            </Card>

            <BanCard
              userId={userId}
              profile={profile}
              onDone={() => qc.invalidateQueries({ queryKey: ['admin'] })}
            />

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
          <View style={{ gap: spacing.sm }}>
            {bets.length === 0 ? <Muted style={{ paddingHorizontal: spacing.lg }}>Kupon yok.</Muted> : null}
            {bets.map((b) => (
              <BetCard key={b.id} bet={b} />
            ))}
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
