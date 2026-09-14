import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';

import { dayjs, dayLabel } from '@/lib/format';
import { colors, radius, spacing } from '@/lib/theme';

interface Props {
  value: dayjs.Dayjs;
  onChange: (d: dayjs.Dayjs) => void;
  /** geriye kaç gün */
  back?: number;
  /** ileriye kaç gün */
  forward?: number;
}

export function DateBar({ value, onChange, back = 1, forward = 7 }: Props) {
  const today = dayjs().startOf('day');
  const days: dayjs.Dayjs[] = [];
  for (let i = -back; i <= forward; i++) days.push(today.add(i, 'day'));

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.scroll} contentContainerStyle={styles.row}>
      {days.map((d) => {
        const active = d.isSame(value, 'day');
        return (
          <Pressable
            key={d.toISOString()}
            onPress={() => onChange(d)}
            hitSlop={{ top: 6, bottom: 6 }}
            style={({ pressed }) => [styles.item, active && styles.itemActive, pressed && !active && styles.itemPressed]}
          >
            <Text style={[styles.top, active && styles.topActive]}>{dayLabel(d)}</Text>
            <Text style={[styles.bottom, active && styles.bottomActive]}>{d.format('D MMM')}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const ITEM_HEIGHT = 52;

const styles = StyleSheet.create({
  // Yatay ScrollView dikey flex içinde sıkışıp içeriği kesmesin
  scroll: { flexGrow: 0, flexShrink: 0, height: ITEM_HEIGHT + spacing.sm * 2 },
  row: { paddingHorizontal: spacing.lg, gap: spacing.sm, paddingVertical: spacing.sm, alignItems: 'center' },
  item: {
    height: ITEM_HEIGHT,
    paddingHorizontal: 14,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 84,
  },
  itemActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  itemPressed: { backgroundColor: colors.surface2 },
  top: { color: colors.text, fontSize: 13, fontWeight: '700' },
  topActive: { color: colors.primaryText },
  bottom: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  bottomActive: { color: colors.primaryText, opacity: 0.8 },
});
