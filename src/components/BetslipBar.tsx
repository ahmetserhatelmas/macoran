import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { money, odd as fmtOdd } from '@/lib/format';
import { colors, radius, shadow, spacing } from '@/lib/theme';
import { totalOdd, useBetslip } from '@/store/betslip';

/** Ekranın altında yüzen kupon özeti. Seçim yoksa görünmez. */
export function BetslipBar({ useSafeBottom }: { useSafeBottom?: boolean }) {
  const router = useRouter();
  const selections = useBetslip((s) => s.selections);
  const stake = useBetslip((s) => s.stake);
  const insets = useSafeAreaInsets();
  if (!selections.length) return null;

  const total = totalOdd(selections);
  const win = (Number(stake) || 0) * total;

  return (
    <View pointerEvents="box-none" style={[styles.wrap, { bottom: (useSafeBottom ? insets.bottom : 0) + spacing.md }]}>
      <Pressable onPress={() => router.push('/betslip')} style={({ pressed }) => [styles.bar, pressed && { opacity: 0.92 }]}>
        <View style={styles.count}>
          <Text style={styles.countText}>{selections.length}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Kuponum</Text>
          <Text style={styles.sub}>
            Toplam oran <Text style={styles.bold}>{fmtOdd(total)}</Text> · Kazanç <Text style={styles.bold}>{money(win)}</Text>
          </Text>
        </View>
        <Ionicons name="chevron-up" size={20} color={colors.primaryText} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, paddingHorizontal: spacing.lg },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    ...shadow,
  },
  count: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.primaryText,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countText: { color: colors.primary, fontWeight: '800', fontSize: 14 },
  title: { color: colors.primaryText, fontWeight: '800', fontSize: 15 },
  sub: { color: colors.primaryText, opacity: 0.85, fontSize: 12, marginTop: 1 },
  bold: { fontWeight: '800', opacity: 1 },
});
