import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { IconButton, Input, Muted } from '@/components/ui';
import { colors, radius, spacing } from '@/lib/theme';
import type { League } from '@/types/db';

/** Türkçe karakterlere duyarsız arama için sadeleştirme */
export function normalize(s: string) {
  return s
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i')
    .replace(/ş/g, 's')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/â/g, 'a');
}

export function filterLeagues(leagues: League[], query: string) {
  const q = normalize(query.trim());
  if (!q) return leagues;
  return leagues.filter((l) => normalize(l.name).includes(q) || (l.country ? normalize(l.country).includes(q) : false));
}

interface Props {
  visible: boolean;
  onClose: () => void;
  leagues: League[];
  selected: number | null;
  /** null = Tümü */
  onSelect: (id: number | null) => void;
  showAll?: boolean;
  title?: string;
}

/** Tüm ligleri aranabilir liste halinde gösteren alt sayfa (modal). */
export function LeaguePicker({ visible, onClose, leagues, selected, onSelect, showAll = true, title = 'Ligler' }: Props) {
  const [query, setQuery] = useState('');
  const list = useMemo(() => filterLeagues(leagues, query), [leagues, query]);

  const pick = (id: number | null) => {
    onSelect(id);
    setQuery('');
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.sheet} edges={['top', 'bottom']}>
        <View style={styles.head}>
          <Text style={styles.title}>{title}</Text>
          <IconButton icon="close" onPress={onClose} />
        </View>
        <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.sm }}>
          <Input
            icon="search"
            placeholder="Lig veya ülke ara…"
            value={query}
            onChangeText={setQuery}
            autoFocus
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            clearButtonMode="while-editing"
          />
        </View>
        <FlatList
          data={list}
          keyExtractor={(l) => String(l.id)}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: 40, gap: spacing.xs }}
          ListHeaderComponent={
            showAll && !query.trim() ? (
              <Row
                label="Tümü"
                sub="Bütün liglerin maçları"
                active={selected === null}
                onPress={() => pick(null)}
                icon={<Ionicons name="football" size={20} color={colors.text} />}
              />
            ) : null
          }
          renderItem={({ item }) => (
            <Row
              label={item.name}
              sub={item.country ?? undefined}
              flag={item.flag}
              active={selected === item.id}
              onPress={() => pick(item.id)}
              icon={item.logo ? <Image source={{ uri: item.logo }} style={styles.logo} contentFit="contain" cachePolicy="memory-disk" /> : null}
            />
          )}
          ListEmptyComponent={
            <View style={{ padding: spacing.xl, alignItems: 'center' }}>
              <Muted>“{query}” ile eşleşen lig yok</Muted>
            </View>
          }
        />
      </SafeAreaView>
    </Modal>
  );
}

function Row({
  label,
  sub,
  flag,
  icon,
  active,
  onPress,
}: {
  label: string;
  sub?: string;
  flag?: string | null;
  icon: React.ReactNode;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, active && styles.rowActive, pressed && { opacity: 0.8 }]}>
      <View style={styles.iconWrap}>{icon}</View>
      <View style={{ flex: 1 }}>
        <Text style={styles.label} numberOfLines={1}>
          {label}
        </Text>
        {sub ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            {flag ? <Image source={{ uri: flag }} style={styles.flag} contentFit="cover" cachePolicy="memory-disk" /> : null}
            <Muted>{sub}</Muted>
          </View>
        ) : null}
      </View>
      {active ? <Ionicons name="checkmark-circle" size={20} color={colors.primary} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: colors.bg },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: spacing.lg,
    paddingRight: spacing.sm,
    paddingVertical: spacing.sm,
  },
  title: { color: colors.text, fontSize: 20, fontWeight: '800' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.sm,
    paddingRight: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  rowActive: { backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.primary },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: { width: 26, height: 26 },
  label: { color: colors.text, fontSize: 15, fontWeight: '600' },
  flag: { width: 14, height: 10, borderRadius: 2 },
});
