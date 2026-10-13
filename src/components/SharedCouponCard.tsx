import Ionicons from '@expo/vector-icons/Ionicons';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { STATUS_META } from '@/components/BetCard';
import { Badge } from '@/components/ui';
import { dateTime, money, odd as fmtOdd } from '@/lib/format';
import { canBet, humanizeError, isLive, marketTitle, selectionLabel } from '@/lib/markets';
import { supabase } from '@/lib/supabase';
import { colors, radius, spacing } from '@/lib/theme';
import { useBetslip } from '@/store/betslip';
import type { SharedCoupon } from '@/types/db';

export function SharedCouponCard({ coupon }: { coupon: SharedCoupon }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [openComments, setOpenComments] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const meta = STATUS_META[coupon.status];
  const sels = coupon.selections ?? [];
  const pickLive = (s: (typeof sels)[number]) =>
    s.status === 'pending' && (s.is_live || (!!s.fixture_status && isLive(s.fixture_status)));
  const live = sels.some(pickLive);

  const refresh = () => qc.invalidateQueries({ queryKey: ['coupon-feed'] });

  const like = async () => {
    const { error } = await supabase.rpc('toggle_coupon_like', { p_coupon_id: coupon.id });
    if (error) return Alert.alert('Beğeni', humanizeError(error.message));
    refresh();
  };

  const sendComment = async () => {
    const body = draft.trim();
    if (!body) return;
    setBusy(true);
    const { error } = await supabase.rpc('comment_coupon', { p_coupon_id: coupon.id, p_body: body });
    setBusy(false);
    if (error) return Alert.alert('Yorum', humanizeError(error.message));
    setDraft('');
    setOpenComments(true);
    refresh();
  };

  const removeComment = (id: string) => {
    Alert.alert('Yorumu sil', 'Bu yorum kaldırılsın mı?', [
      { text: 'Vazgeç', style: 'cancel' },
      {
        text: 'Sil',
        style: 'destructive',
        onPress: async () => {
          const { error } = await supabase.rpc('delete_coupon_comment', { p_comment_id: id });
          if (error) return Alert.alert('Yorum', humanizeError(error.message));
          refresh();
        },
      },
    ]);
  };

  const take = async () => {
    const open = sels.filter((s) => s.fixture_status && canBet(s.fixture_status));
    if (!open.length) return Alert.alert('Kupona al', 'Bu kuponun maçları artık bahse açık değil.');
    const ids = [...new Set(open.map((s) => s.fixture_id))];
    const { data, error } = await supabase
      .from('odds')
      .select('fixture_id, market, selection, line, odd, suspended, is_live')
      .in('fixture_id', ids);
    if (error) return Alert.alert('Kupona al', humanizeError(error.message));
    const picks = [];
    let skipped = 0;
    for (const s of open) {
      const o = (data ?? []).find(
        (x) =>
          Number(x.fixture_id) === s.fixture_id &&
          x.market === s.market &&
          x.selection === s.selection &&
          Number(x.line) === Number(s.line),
      );
      if (!o || o.suspended) {
        skipped++;
        continue;
      }
      picks.push({
        fixture_id: s.fixture_id,
        market: s.market,
        selection: s.selection,
        line: Number(s.line),
        odd: Number(o.odd),
        is_live: !!o.is_live,
        home_name: s.home_name ?? '',
        away_name: s.away_name ?? '',
        league_name: s.league_name ?? '',
        fixture_date: s.fixture_date ?? '',
      });
    }
    if (!picks.length) return Alert.alert('Kupona al', 'Seçimlerin oranı şu an kapalı.');
    const added = useBetslip.getState().addMany(picks);
    const extra = skipped ? ` ${skipped} maçın oranı kapalıydı.` : added < picks.length ? ' Kupon dolu, bir kısmı eklenemedi.' : '';
    Alert.alert('Kupona alındı', `${added} seçim eklendi.${extra}`, [
      { text: 'Kuponu aç', onPress: () => router.push('/betslip') },
      { text: 'Tamam', style: 'cancel' },
    ]);
  };

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <View style={styles.avatar}>
          <Text style={styles.avatarTxt}>{(coupon.username || 'O').slice(0, 1).toUpperCase()}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.user}>{coupon.username}</Text>
          <Text style={styles.date}>{dateTime(coupon.created_at)}</Text>
        </View>
        <View style={styles.badges}>
          {live ? <Badge text="Canlı" color="rgba(239,68,68,0.15)" textColor={colors.live} /> : null}
          <Badge text={meta.label} color={meta.bg} textColor={meta.color} />
        </View>
      </View>

      {coupon.note ? <Text style={styles.note}>{coupon.note}</Text> : null}

      <View style={styles.sels}>
        {sels.map((s, i) => {
          const sm = STATUS_META[s.status];
          return (
            <Pressable
              key={`${s.fixture_id}-${s.market}-${i}`}
              onPress={() => router.push(`/match/${s.fixture_id}`)}
              style={({ pressed }) => [styles.sel, pressed && { opacity: 0.7 }]}
            >
              <Ionicons name={sm.icon} size={16} color={s.status === 'pending' ? colors.textDim : sm.color} />
              <View style={{ flex: 1 }}>
                <Text style={styles.match} numberOfLines={1}>
                  {s.home_name} - {s.away_name}
                </Text>
                <Text style={styles.pick} numberOfLines={1}>
                  {marketTitle(s.market, s.line)}: {selectionLabel(s.market, s.selection, s.line, s.home_name ?? undefined, s.away_name ?? undefined)}
                  {pickLive(s) ? '  · Canlı' : ''}
                  {s.result_home !== null && s.result_away !== null ? `  · ${s.result_home}-${s.result_away}` : ''}
                </Text>
              </View>
              <Text style={styles.odd}>{fmtOdd(s.odd)}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.foot}>
        <Text style={styles.meta}>
          {sels.length > 1 ? `${sels.length}'li` : 'Tekli'} · {fmtOdd(coupon.total_odd)}
        </Text>
        {coupon.stake !== null ? <Text style={styles.meta}>{money(coupon.stake)}</Text> : null}
      </View>

      <View style={styles.actions}>
        <Pressable onPress={like} style={styles.action}>
          <Ionicons name={coupon.liked ? 'heart' : 'heart-outline'} size={18} color={coupon.liked ? colors.danger : colors.textMuted} />
          <Text style={styles.actionTxt}>{coupon.like_count}</Text>
        </Pressable>
        <Pressable onPress={() => setOpenComments((v) => !v)} style={styles.action}>
          <Ionicons name="chatbubble-outline" size={17} color={colors.textMuted} />
          <Text style={styles.actionTxt}>{coupon.comment_count}</Text>
        </Pressable>
        <Pressable onPress={take} style={styles.take}>
          <Ionicons name="add-circle-outline" size={18} color={colors.primaryText} />
          <Text style={styles.takeTxt}>Kupona al</Text>
        </Pressable>
      </View>

      {openComments ? (
        <View style={styles.comments}>
          {coupon.comments.length === 0 ? <Text style={styles.empty}>İlk yorumu sen yaz.</Text> : null}
          {coupon.comment_count > coupon.comments.length ? (
            <Text style={styles.empty}>Son {coupon.comments.length} yorum</Text>
          ) : null}
          {coupon.comments.map((c) => (
            <Pressable key={c.id} onLongPress={c.mine ? () => removeComment(c.id) : undefined} style={styles.comment}>
              <Text style={styles.commentUser}>{c.username}</Text>
              <Text style={styles.commentBody}>{c.body}</Text>
            </Pressable>
          ))}
          <View style={styles.composer}>
            <TextInput
              value={draft}
              onChangeText={(t) => setDraft(t.slice(0, 200))}
              placeholder="Yorum yaz"
              placeholderTextColor={colors.textDim}
              style={styles.input}
              maxLength={200}
            />
            <Pressable onPress={sendComment} disabled={busy || !draft.trim()} style={{ opacity: busy || !draft.trim() ? 0.4 : 1 }}>
              <Ionicons name="send" size={18} color={colors.primary} />
            </Pressable>
          </View>
        </View>
      ) : null}
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
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surface3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarTxt: { color: colors.text, fontWeight: '800' },
  user: { color: colors.text, fontWeight: '800', fontSize: 14 },
  date: { color: colors.textMuted, fontSize: 12, marginTop: 1 },
  badges: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  note: { color: colors.text, paddingHorizontal: spacing.md, paddingBottom: spacing.sm, fontSize: 14 },
  sels: { paddingHorizontal: spacing.md, gap: spacing.sm, paddingBottom: spacing.md },
  sel: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  match: { color: colors.text, fontSize: 13, fontWeight: '600' },
  pick: { color: colors.textMuted, fontSize: 12, marginTop: 1 },
  odd: { color: colors.text, fontWeight: '800', fontVariant: ['tabular-nums'] },
  foot: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  meta: { color: colors.textMuted, fontSize: 12, fontWeight: '700' },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  action: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  actionTxt: { color: colors.textMuted, fontWeight: '700', fontSize: 13 },
  take: {
    marginLeft: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.primary,
    borderRadius: radius.full,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  takeTxt: { color: colors.primaryText, fontWeight: '800', fontSize: 13 },
  comments: { padding: spacing.md, gap: spacing.sm, backgroundColor: colors.surface2 },
  empty: { color: colors.textDim, fontSize: 12 },
  comment: { gap: 2 },
  commentUser: { color: colors.text, fontWeight: '800', fontSize: 12 },
  commentBody: { color: colors.textMuted, fontSize: 13 },
  composer: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs },
  input: {
    flex: 1,
    color: colors.text,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
});
