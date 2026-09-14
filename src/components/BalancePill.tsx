import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text } from 'react-native';

import { money } from '@/lib/format';
import { colors, radius } from '@/lib/theme';
import { useAuth } from '@/store/auth';

export function BalancePill() {
  const router = useRouter();
  const balance = useAuth((s) => s.profile?.balance ?? 0);
  return (
    <Pressable onPress={() => router.push('/(tabs)/profile')} style={({ pressed }) => [styles.pill, pressed && { opacity: 0.8 }]}>
      <Ionicons name="wallet" size={16} color={colors.gold} />
      <Text style={styles.text}>{money(balance)}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.surface2,
    borderRadius: radius.full,
    paddingHorizontal: 12,
    height: 36,
    borderWidth: 1,
    borderColor: colors.border,
  },
  text: { color: colors.text, fontWeight: '800', fontSize: 14, fontVariant: ['tabular-nums'] },
});
