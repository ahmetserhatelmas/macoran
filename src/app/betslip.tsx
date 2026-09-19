import Ionicons from '@expo/vector-icons/Ionicons';
import { useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Badge, Button, Header, IconButton, Muted, Screen } from '@/components/ui';
import { dateTime, money, odd as fmtOdd } from '@/lib/format';
import { humanizeError, marketTitle, selectionLabel } from '@/lib/markets';
import { supabase } from '@/lib/supabase';
import { colors, radius, spacing } from '@/lib/theme';
import { useAuth } from '@/store/auth';
import { totalOdd, useBetslip } from '@/store/betslip';
import type { Odd } from '@/types/db';

const QUICK = [20, 50, 100, 250, 500];
const MAX_WIN = 1_000_000;

export default function BetslipScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const { selections, stake, setStake, remove, clear, syncOdds, acknowledgeChanges } = useBetslip();
  const balance = useAuth((s) => s.profile?.balance ?? 0);
  const refreshProfile = useAuth((s) => s.refreshProfile);
  const [loading, setLoading] = useState(false);
  const [confirmLeft, setConfirmLeft] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const stakeNum = Number(stake) || 0;
  const total = totalOdd(selections);
  const win = Math.min(stakeNum * total, MAX_WIN);
  const hasChanges = selections.some((s) => s.changed);
  const insufficient = stakeNum > balance;

  // Açılışta kupondaki oranları sunucudan tazele
  useEffect(() => {
    refreshOdds();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function placeBet(
    payload: { fixture_id: number; market: string; selection: string; line: number; odd: number }[],
    stake: number,
  ): Promise<{ data: { total_odd?: number } | null; error: string | null }> {
    // Oranlar simülasyon motoru tarafından DB'ye yazılır; RPC askı/tazelik/oran değişimini kontrol eder
    const { data: rpcData, error: rpcErr } = await supabase.rpc('place_bet', { p_selections: payload, p_stake: stake });
    if (rpcErr) return { data: null, error: rpcErr.message };
    return { data: rpcData as { total_odd?: number }, error: null };
  }

  async function refreshOdds() {
    const ids = useBetslip.getState().selections.map((s) => s.fixture_id);
    if (!ids.length) return;
    const { data } = await supabase.from('odds').select('*').in('fixture_id', ids);
    if (data) syncOdds((data as Odd[]).map((o) => ({ ...o, odd: Number(o.odd), line: Number(o.line) })));
  }

  const submit = async () => {
    if (!selections.length) return;
    if (stakeNum < 1) return setError('Minimum bahis 1 ₺.');
    if (insufficient) return setError('Bakiyeniz yetersiz.');
    if (hasChanges) {
      acknowledgeChanges();
      return setError(null);
    }
    setLoading(true);
    setError(null);
    const payload = selections.map((s) => ({
      fixture_id: s.fixture_id,
      market: s.market,
      selection: s.selection,
      line: s.line,
      odd: s.odd,
    }));
    for (let left = 4; left > 0; left--) {
      setConfirmLeft(left);
      await new Promise((r) => setTimeout(r, 1000));
      if (useBetslip.getState().selections.length !== payload.length) {
        setLoading(false);
        setConfirmLeft(0);
        return setError('Kupon değişti, tekrar deneyin.');
      }
    }
    setConfirmLeft(0);
    const { data, error: err } = await placeBet(payload, stakeNum);
    setLoading(false);

    if (err) {
      const msg = humanizeError(err);
      setError(msg);
      if (err.startsWith('ODDS_CHANGED') || err.startsWith('ODD_')) await refreshOdds();
      if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }

    if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    clear();
    refreshProfile();
    qc.invalidateQueries({ queryKey: ['bets'] });
    qc.invalidateQueries({ queryKey: ['transactions'] });
    Alert.alert('Kupon oynandı', `Toplam oran ${fmtOdd(data?.total_odd ?? total)} · Olası kazanç ${money(win)}`, [
      { text: 'Kuponlarım', onPress: () => { router.back(); router.push('/(tabs)/bets'); } },
      { text: 'Tamam', onPress: () => router.back() },
    ]);
  };

  return (
    <Screen edges={['top', 'bottom']}>
      <Header
        title="Kuponum"
        subtitle={selections.length ? `${selections.length} seçim` : undefined}
        left={<IconButton icon="close" onPress={() => router.back()} />}
        right={selections.length ? <IconButton icon="trash-outline" color={colors.danger} onPress={() => clear()} /> : undefined}
      />

      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm }} keyboardShouldPersistTaps="handled">
          {selections.length === 0 ? (
            <View style={{ alignItems: 'center', paddingVertical: 60, gap: spacing.sm }}>
              <Ionicons name="receipt-outline" size={44} color={colors.textDim} />
              <Text style={{ color: colors.text, fontWeight: '700' }}>Kuponun boş</Text>
              <Muted>Maçlardan oran seçerek kupon oluştur.</Muted>
            </View>
          ) : null}

          {hasChanges ? (
            <View style={styles.warn}>
              <Ionicons name="alert-circle" size={18} color={colors.warn} />
              <Text style={styles.warnText}>Bazı oranlar değişti. Yeni oranları kabul etmek için “Oranları Onayla”ya bas.</Text>
            </View>
          ) : null}

          {selections.map((s) => (
            <View key={`${s.fixture_id}-${s.market}-${s.selection}-${s.line}`} style={[styles.sel, s.changed && { borderColor: colors.warn }]}>
              <View style={{ flex: 1, gap: 2 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={styles.match} numberOfLines={1}>
                    {s.home_name} - {s.away_name}
                  </Text>
                  {s.is_live ? <Badge text="CANLI" color="rgba(239,68,68,0.15)" textColor={colors.live} /> : null}
                </View>
                <Text style={styles.pick}>
                  {marketTitle(s.market, s.line)}: <Text style={{ color: colors.primary, fontWeight: '800' }}>{selectionLabel(s.market, s.selection, s.line, s.home_name, s.away_name)}</Text>
                </Text>
                <Muted style={{ fontSize: 11 }}>
                  {s.league_name} · {dateTime(s.fixture_date)}
                </Muted>
              </View>
              <Text style={[styles.odd, s.changed && { color: colors.warn }]}>{fmtOdd(s.odd)}</Text>
              <Pressable onPress={() => remove(s.fixture_id)} hitSlop={8}>
                <Ionicons name="close-circle" size={22} color={colors.textDim} />
              </Pressable>
            </View>
          ))}
        </ScrollView>

        {selections.length > 0 ? (
          <View style={styles.footer}>
            <View style={styles.stakeRow}>
              <View style={{ flex: 1 }}>
                <Muted style={{ fontSize: 12, marginBottom: 4 }}>Bahis tutarı</Muted>
                <View style={styles.stakeInputWrap}>
                  <TextInput
                    value={stake}
                    onChangeText={setStake}
                    keyboardType="number-pad"
                    style={styles.stakeInput}
                    placeholder="0"
                    placeholderTextColor={colors.textDim}
                    selectTextOnFocus
                  />
                  <Text style={styles.currency}>₺</Text>
                </View>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 2 }}>
                <Muted style={{ fontSize: 12 }}>Bakiye</Muted>
                <Text style={[styles.balance, insufficient && { color: colors.danger }]}>{money(balance)}</Text>
              </View>
            </View>

            <View style={styles.quick}>
              {QUICK.map((q) => (
                <Pressable key={q} onPress={() => setStake(String(q))} style={[styles.quickBtn, stakeNum === q && styles.quickBtnActive]}>
                  <Text style={[styles.quickText, stakeNum === q && { color: colors.primaryText }]}>{q}</Text>
                </Pressable>
              ))}
              <Pressable onPress={() => setStake(String(Math.floor(balance)))} style={styles.quickBtn}>
                <Text style={styles.quickText}>Max</Text>
              </Pressable>
            </View>

            <View style={styles.summary}>
              <View style={{ flex: 1 }}>
                <Muted style={{ fontSize: 12 }}>Toplam oran</Muted>
                <Text style={styles.summaryValue}>{fmtOdd(total)}</Text>
              </View>
              <View style={{ flex: 1, alignItems: 'flex-end' }}>
                <Muted style={{ fontSize: 12 }}>Olası kazanç</Muted>
                <Text style={[styles.summaryValue, { color: colors.primary }]}>{money(win)}</Text>
              </View>
            </View>

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <Button
              title={
                hasChanges
                  ? 'Oranları Onayla'
                  : confirmLeft > 0
                    ? `Onaylanıyor · ${confirmLeft}`
                    : `Kuponu Oyna · ${money(stakeNum)}`
              }
              onPress={submit}
              loading={loading}
              disabled={stakeNum < 1 || insufficient}
              variant={hasChanges ? 'secondary' : 'primary'}
              size="lg"
            />
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  warn: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    backgroundColor: 'rgba(245,158,11,0.12)',
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.4)',
  },
  warnText: { color: colors.text, fontSize: 12, flex: 1 },
  sel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  match: { color: colors.text, fontWeight: '700', fontSize: 14, flexShrink: 1 },
  pick: { color: colors.textMuted, fontSize: 12 },
  odd: { color: colors.text, fontWeight: '800', fontSize: 16, fontVariant: ['tabular-nums'] },
  // Not: mutlak konum (bottom: 0) kullanılmaz; KeyboardAvoidingView'ın padding'i
  // yalnızca akıştaki çocukları yukarı iter.
  footer: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.lg,
    gap: spacing.md,
    borderTopWidth: 1,
    borderColor: colors.border,
  },
  stakeRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.lg },
  stakeInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface2,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    height: 52,
  },
  stakeInput: { flex: 1, color: colors.text, fontSize: 22, fontWeight: '800', fontVariant: ['tabular-nums'] },
  currency: { color: colors.textMuted, fontSize: 18, fontWeight: '700' },
  balance: { color: colors.text, fontWeight: '800', fontSize: 15, fontVariant: ['tabular-nums'] },
  quick: { flexDirection: 'row', gap: 6 },
  quickBtn: { flex: 1, height: 34, borderRadius: radius.sm, backgroundColor: colors.surface3, alignItems: 'center', justifyContent: 'center' },
  quickBtnActive: { backgroundColor: colors.primary },
  quickText: { color: colors.text, fontWeight: '700', fontSize: 13 },
  summary: { flexDirection: 'row', backgroundColor: colors.surface2, borderRadius: radius.md, padding: spacing.md },
  summaryValue: { color: colors.text, fontSize: 18, fontWeight: '900', fontVariant: ['tabular-nums'], marginTop: 2 },
  error: { color: colors.danger, fontSize: 13, textAlign: 'center' },
});
