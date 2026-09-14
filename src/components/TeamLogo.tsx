import { Image } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';

import { colors } from '@/lib/theme';

export function TeamLogo({ uri, size = 28, name }: { uri?: string | null; size?: number; name?: string }) {
  if (!uri) {
    return (
      <View style={[styles.fallback, { width: size, height: size, borderRadius: size / 2 }]}>
        <Text style={{ color: colors.textMuted, fontSize: size * 0.4, fontWeight: '700' }}>{name?.[0] ?? '?'}</Text>
      </View>
    );
  }
  return <Image source={{ uri }} style={{ width: size, height: size }} contentFit="contain" transition={150} cachePolicy="memory-disk" />;
}

const styles = StyleSheet.create({
  fallback: { backgroundColor: colors.surface3, alignItems: 'center', justifyContent: 'center' },
});
