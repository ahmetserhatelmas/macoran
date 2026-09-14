import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useEffect, useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing } from '@/lib/theme';
import type { League } from '@/types/db';

interface Props {
  leagues: League[];
  selected: number | null;
  onSelect: (id: number | null) => void;
  allLabel?: string;
  showAll?: boolean;
  /** "Canlı" filtresi: verilirse en başa kırmızı noktalı bir çip eklenir */
  live?: { active: boolean; count: number; onPress: () => void };
  /** Verilirse en başa tüm ligleri listeleyen "Ligler" çipi eklenir */
  onOpenPicker?: () => void;
}

export function LeagueChips({ leagues, selected, onSelect, allLabel = 'Tümü', showAll = true, live, onOpenPicker }: Props) {
  const scrollRef = useRef<ScrollView>(null);
  const chipX = useRef<Record<number, number>>({});

  // Seçim (örn. Ligler seçicisinden) değişince seçili çipi görünür alana kaydır
  useEffect(() => {
    if (selected === null || live?.active) {
      scrollRef.current?.scrollTo({ x: 0, animated: true });
      return;
    }
    const x = chipX.current[selected];
    if (x !== undefined) scrollRef.current?.scrollTo({ x: Math.max(0, x - spacing.lg), animated: true });
  }, [selected, live?.active]);

  return (
    <ScrollView ref={scrollRef} horizontal showsHorizontalScrollIndicator={false} style={styles.scroll} contentContainerStyle={styles.row}>
      {onOpenPicker ? (
        <Pressable onPress={onOpenPicker} hitSlop={{ top: 6, bottom: 6 }} style={[styles.chip, styles.chipPicker]}>
          <Ionicons name="list" size={16} color={colors.text} />
          <Text style={[styles.text, { color: colors.text }]}>Ligler</Text>
          <Ionicons name="chevron-down" size={12} color={colors.textMuted} />
        </Pressable>
      ) : null}
      {live ? (
        <Chip
          label={live.count > 0 ? `Canlı · ${live.count}` : 'Canlı'}
          active={live.active}
          onPress={live.onPress}
          variant="live"
        />
      ) : null}
      {showAll ? <Chip label={allLabel} active={!live?.active && selected === null} onPress={() => onSelect(null)} /> : null}
      {leagues.map((l) => (
        <View key={l.id} onLayout={(e) => { chipX.current[l.id] = e.nativeEvent.layout.x; }}>
          <Chip label={l.name} logo={l.logo} active={!live?.active && selected === l.id} onPress={() => onSelect(l.id)} />
        </View>
      ))}
    </ScrollView>
  );
}

function Chip({
  label,
  logo,
  active,
  onPress,
  variant,
}: {
  label: string;
  logo?: string | null;
  active: boolean;
  onPress: () => void;
  variant?: 'live';
}) {
  const isLive = variant === 'live';
  return (
    <Pressable
      onPress={onPress}
      hitSlop={{ top: 6, bottom: 6 }}
      style={[styles.chip, active && styles.chipActive, isLive && active && styles.chipLiveActive]}
    >
      {isLive ? <View style={[styles.dot, active && { backgroundColor: '#fff' }]} /> : null}
      {logo ? <Image source={{ uri: logo }} style={styles.logo} contentFit="contain" cachePolicy="memory-disk" /> : null}
      <Text style={[styles.text, active && styles.textActive, isLive && active && { color: '#fff' }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const CHIP_HEIGHT = 36;

const styles = StyleSheet.create({
  scroll: { flexGrow: 0, flexShrink: 0, height: CHIP_HEIGHT + spacing.sm * 2 },
  row: { paddingHorizontal: spacing.lg, gap: spacing.sm, paddingVertical: spacing.sm, alignItems: 'center' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    height: CHIP_HEIGHT,
    borderRadius: radius.full,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.text, borderColor: colors.text },
  chipLiveActive: { backgroundColor: colors.live, borderColor: colors.live },
  chipPicker: { backgroundColor: colors.surface3, borderColor: colors.border, gap: 5 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.live },
  logo: { width: 16, height: 16 },
  text: { color: colors.textMuted, fontSize: 13, fontWeight: '600', maxWidth: 160 },
  textActive: { color: colors.bg },
});
