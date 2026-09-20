import Ionicons from '@expo/vector-icons/Ionicons';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { Badge } from '@/components/ui';
import { dateTime, money, odd as fmtOdd } from '@/lib/format';
import { humanizeError, marketTitle, selectionLabel } from '@/lib/markets';
import { supabase } from '@/lib/supabase';
import { colors, radius, spacing } from '@/lib/theme';
import { useAuth } from '@/store/auth';
import type { Bet, BetStatus } from '@/types/db';

export const STATUS_META: Record<BetStatus, { label: string; color: string; bg: string; icon: 'time-outline' | 'checkmark-circle' | 'close-circle' | 'refresh-circle' | 'cash-outline' }> = {
  pending: { label: 'Bekliyor', color: colors.warn, bg: 'rgba(245,158,11,0.15)', icon: 'time-outline' },
  won: { label: 'Kazandı', color: colors.success, bg: 'rgba(74,222,128,0.15)', icon: 'checkmark-circle' },
  lost: { label: 'Kaybetti', color: colors.danger, bg: 'rgba(248,113,113,0.15)', icon: 'close-circle' },
  void: { label: 'İade', color: colors.info, bg: 'rgba(56,189,248,0.15)', icon: 'refresh-circle' },
  cashed: { label: 'Bozduruldu', color: colors.info, bg: 'rgba(56,189,248,0.15)', icon: 'cash-outline' },
};

export function BetCard({ bet }: { bet: Bet }) {
  const router = useRouter();
  const qc = useQueryClient();
  const refreshProfile = useAuth((s) => s.refreshProfile);
  const meta = STATUS_META[bet.status];
  const sels = bet.bet_selections ?? [];
  const uid = useAuth((s) => s.session?.user.id);
  const canCash = bet.status === 'pending' && uid === bet.user_id;
  const [cashing, setCashing] = useState(false);

  const cashOut = async () => {
    setCashing(true);
    const { data, error } = await supabase.rpc('cash_out_quote', { p_bet_id: bet.id });
    setCashing(false);
    if (error) return Alert.alert('Bozdurma', humanizeError(error.message));
    const q = data as { available?: boolean; amount?: number; reason?: string } | null;
    if (!q?.available) return Alert.alert('Bozdurma', humanizeError(q?.reason) || 'Şu an teklif yok.');
    Alert.alert(
      'Kuponu bozdur',
      `Şu anki duruma göre teklif ${money(Number(q.amount))}. Kabul edilsin mi?`,
      [
        { text: 'Vazgeç', style: 'cancel' },
        {
          text: 'Bozdur',
          onPress: async () => {
            setCashing(true);
            const { data: res, error: err } = await supabase.rpc('cash_out_bet', { p_bet_id: bet.id });
            setCashing(false);
            if (err) return Alert.alert('Bozdurma', humanizeError(err.message));
            refreshProfile();
            qc.invalidateQueries({ queryKey: ['bets'] });
            qc.invalidateQueries({ queryKey: ['transactions'] });
            const amt = Number((res as { amount?: number } | null)?.amount ?? q.amount);
            Alert.alert('Bozduruldu', `${money(amt)} bakiyene eklendi.`);
          },
        },
      ],
    );
  };

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{sels.length > 1 ? `${sels.length}'li Kombine` : 'Tekli Bahis'}</Text>
          <Text style={styles.date}>{dateTime(bet.created_at)}</Text>
        </View>
        <Badge text={meta.label} color={meta.bg} textColor={meta.color} />
      </View>

      <View style={styles.sels}>
        {sels.map((s) => {
          const sm = STATUS_META[s.status];
          const openMatch = () => {
            if (!Number.isFinite(s.fixture_id)) return;
            router.push(`/match/${s.fixture_id}`);
          };
          return (
            <Pressable
              key={s.id}
              onPress={openMatch}
              disabled={!Number.isFinite(s.fixture_id)}
              style={({ pressed }) => [styles.sel, pressed && { opacity: 0.7 }]}
            >
              <Ionicons name={sm.icon} size={18} color={s.status === 'pending' ? colors.textDim : sm.color} />
              <View style={{ flex: 1 }}>
                <Text style={styles.match} numberOfLines={1}>
                  {s.home_name} - {s.away_name}
                </Text>
                <Text style={styles.pick} numberOfLines={1}>
                  {marketTitle(s.market, s.line)}: <Text style={{ color: colors.text }}>{selectionLabel(s.market, s.selection, s.line, s.home_name ?? undefined, s.away_name ?? undefined)}</Text>
                  {s.is_live ? '  · Canlı' : ''}
                  {s.result_home !== null && s.result_away !== null ? `  · ${s.result_home}-${s.result_away}` : ''}
                </Text>
              </View>
              <Text style={styles.odd}>{fmtOdd(s.odd)}</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.textDim} />
            </Pressable>
          );
        })}
      </View>

      <View style={styles.foot}>
        <Stat label="Tutar" value={money(bet.stake)} />
        <Stat label="Oran" value={fmtOdd(bet.total_odd)} />
        {bet.status === 'pending' ? (
          <Stat label="Olası Kazanç" value={money(bet.potential_win)} highlight />
        ) : (
          <Stat label="Ödeme" value={money(bet.payout ?? 0)} highlight={bet.status === 'won' || bet.status === 'cashed'} />
        )}
      </View>
      {canCash ? (
        <Pressable
          onPress={cashOut}
          disabled={cashing}
          style={({ pressed }) => [styles.cashBtn, (pressed || cashing) && { opacity: 0.7 }]}
        >
          <Ionicons name="cash-outline" size={16} color={colors.gold} />
          <Text style={styles.cashTxt}>{cashing ? 'Hesaplanıyor…' : 'Bozdur'}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, highlight && { color: colors.primary }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  head: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, gap: spacing.sm },
  title: { color: colors.text, fontWeight: '800', fontSize: 15 },
  date: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  sels: { paddingHorizontal: spacing.md, gap: spacing.sm, paddingBottom: spacing.md },
  sel: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  match: { color: colors.text, fontSize: 13, fontWeight: '600' },
  pick: { color: colors.textMuted, fontSize: 12, marginTop: 1 },
  odd: { color: colors.text, fontWeight: '800', fontVariant: ['tabular-nums'] },
  foot: {
    flexDirection: 'row',
    backgroundColor: colors.surface2,
    padding: spacing.md,
    gap: spacing.sm,
  },
  statLabel: { color: colors.textMuted, fontSize: 11 },
  statValue: { color: colors.text, fontWeight: '800', fontSize: 14, marginTop: 2, fontVariant: ['tabular-nums'] },
  cashBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  cashTxt: { color: colors.gold, fontWeight: '800', fontSize: 13 },
});
