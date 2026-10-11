import Ionicons from '@expo/vector-icons/Ionicons';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, Modal, Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { Button, Input } from '@/components/ui';
import { humanizeError } from '@/lib/markets';
import { supabase } from '@/lib/supabase';
import { colors, radius, spacing } from '@/lib/theme';

export function ShareCouponButton({ betId, shared }: { betId: string; shared: boolean }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [showStake, setShowStake] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['shared-bets'] });
    qc.invalidateQueries({ queryKey: ['coupon-feed'] });
  };

  const unshare = () => {
    Alert.alert('Paylaşımı kaldır', 'Kupon akıştan silinsin mi?', [
      { text: 'Vazgeç', style: 'cancel' },
      {
        text: 'Kaldır',
        style: 'destructive',
        onPress: async () => {
          const { error } = await supabase.rpc('unshare_coupon', { p_bet_id: betId });
          if (error) return Alert.alert('Paylaşım', humanizeError(error.message));
          refresh();
        },
      },
    ]);
  };

  const share = async () => {
    setBusy(true);
    const { error } = await supabase.rpc('share_coupon', {
      p_bet_id: betId,
      p_note: note.trim() || null,
      p_show_stake: showStake,
    });
    setBusy(false);
    if (error) return Alert.alert('Paylaşım', humanizeError(error.message));
    setOpen(false);
    setNote('');
    setShowStake(false);
    refresh();
  };

  return (
    <>
      <Pressable onPress={shared ? unshare : () => setOpen(true)} style={({ pressed }) => [styles.btn, pressed && { opacity: 0.7 }]}>
        <Ionicons name={shared ? 'checkmark-circle' : 'share-social-outline'} size={16} color={shared ? colors.primary : colors.info} />
        <Text style={[styles.txt, { color: shared ? colors.primary : colors.info }]}>{shared ? 'Akışta' : 'Paylaş'}</Text>
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text style={styles.title}>Kuponu paylaş</Text>
            <Text style={styles.sub}>Akışta kullanıcı adın ve seçimlerin görünür. Tutar varsayılan olarak gizli.</Text>
            <Input
              label="Not"
              placeholder="Kısa bir not (isteğe bağlı)"
              value={note}
              onChangeText={(t) => setNote(t.slice(0, 160))}
              maxLength={160}
            />
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Tutarı herkes görsün</Text>
              <Switch value={showStake} onValueChange={setShowStake} trackColor={{ true: colors.primary, false: colors.surface3 }} />
            </View>
            <Button title="Akışa koy" onPress={share} loading={busy} />
            <Button title="Vazgeç" variant="ghost" onPress={() => setOpen(false)} />
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  txt: { fontWeight: '800', fontSize: 13 },
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.lg,
    gap: spacing.md,
    paddingBottom: spacing.xxl,
  },
  title: { color: colors.text, fontSize: 18, fontWeight: '800' },
  sub: { color: colors.textMuted, fontSize: 13 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowLabel: { color: colors.text, fontWeight: '600' },
});
