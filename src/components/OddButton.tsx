import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { odd as fmtOdd } from '@/lib/format';
import { colors, radius } from '@/lib/theme';

interface Props {
  label: string;
  odd: number | null | undefined;
  selected?: boolean;
  suspended?: boolean;
  onPress?: () => void;
  compact?: boolean;
}

/**
 * Oran butonu. Oran değişince kısa süre yeşil/kırmızı vurgu gösterir.
 */
export function OddButton({ label, odd, selected, suspended, onPress, compact }: Props) {
  const prev = useRef<number | null | undefined>(odd);
  const [trend, setTrend] = useState<'up' | 'down' | null>(null);

  useEffect(() => {
    if (prev.current != null && odd != null && prev.current !== odd) {
      setTrend(odd > prev.current ? 'up' : 'down');
      const t = setTimeout(() => setTrend(null), 4000);
      prev.current = odd;
      return () => clearTimeout(t);
    }
    prev.current = odd;
  }, [odd]);

  const disabled = suspended || odd == null;

  const handle = () => {
    if (disabled) return;
    if (Platform.OS !== 'web') Haptics.selectionAsync();
    onPress?.();
  };

  return (
    <Pressable
      onPress={handle}
      disabled={disabled}
      style={({ pressed }) => [
        styles.btn,
        compact && styles.compact,
        selected && styles.selected,
        disabled && styles.disabled,
        pressed && !disabled && { opacity: 0.8 },
      ]}>
      <Text style={[styles.label, selected && styles.labelSelected]} numberOfLines={1}>
        {label}
      </Text>
      {disabled ? (
        suspended ? (
          <Ionicons name="lock-closed" size={14} color={colors.textDim} style={{ marginTop: 2 }} />
        ) : (
          <Text style={[styles.odd, { color: colors.textDim }]}>-</Text>
        )
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
          {trend ? <Text style={{ color: trend === 'up' ? colors.success : colors.danger, fontSize: 10 }}>{trend === 'up' ? '▲' : '▼'}</Text> : null}
          <Text style={[styles.odd, selected && styles.oddSelected, trend === 'up' && { color: colors.success }, trend === 'down' && { color: colors.danger }]}>
            {fmtOdd(odd)}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    flex: 1,
    backgroundColor: colors.surface3,
    borderRadius: radius.sm,
    paddingVertical: 8,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    borderWidth: 1,
    borderColor: 'transparent',
    minHeight: 48,
  },
  compact: { minHeight: 44, paddingVertical: 6 },
  selected: { backgroundColor: colors.primary, borderColor: colors.primary },
  disabled: { opacity: 0.45 },
  label: { color: colors.textMuted, fontSize: 11, fontWeight: '600' },
  labelSelected: { color: colors.primaryText },
  odd: { color: colors.text, fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] },
  oddSelected: { color: colors.primaryText },
});
