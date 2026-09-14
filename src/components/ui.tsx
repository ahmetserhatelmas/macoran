import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps, PropsWithChildren, ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  type TextStyle,
  View,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, radius, spacing } from '@/lib/theme';

export type IconName = ComponentProps<typeof Ionicons>['name'];

export function Screen({ children, style, edges }: PropsWithChildren<{ style?: ViewStyle; edges?: ('top' | 'bottom')[] }>) {
  return (
    <SafeAreaView style={[styles.screen, style]} edges={edges ?? ['top']}>
      {children}
    </SafeAreaView>
  );
}

export function Header({
  title,
  subtitle,
  right,
  left,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  left?: ReactNode;
}) {
  return (
    <View style={styles.header}>
      {left}
      <View style={{ flex: 1 }}>
        <Text style={styles.headerTitle}>{title}</Text>
        {subtitle ? <Text style={styles.headerSubtitle}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
}

export function Card({ children, style }: PropsWithChildren<{ style?: ViewStyle }>) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  loading,
  disabled,
  icon,
  style,
  size = 'md',
}: {
  title: string;
  onPress?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  loading?: boolean;
  disabled?: boolean;
  icon?: IconName;
  style?: ViewStyle;
  size?: 'sm' | 'md' | 'lg';
}) {
  const bg =
    variant === 'primary' ? colors.primary : variant === 'danger' ? colors.danger : variant === 'secondary' ? colors.surface3 : 'transparent';
  const fg = variant === 'primary' ? colors.primaryText : variant === 'danger' ? '#fff' : colors.text;
  const isDisabled = disabled || loading;
  const h = size === 'sm' ? 36 : size === 'lg' ? 54 : 46;
  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, height: h, opacity: isDisabled ? 0.5 : pressed ? 0.85 : 1 },
        variant === 'ghost' && { borderWidth: 1, borderColor: colors.border },
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <>
          {icon ? <Ionicons name={icon} size={18} color={fg} style={{ marginRight: 8 }} /> : null}
          <Text style={[styles.buttonText, { color: fg, fontSize: size === 'sm' ? 13 : 15 }]}>{title}</Text>
        </>
      )}
    </Pressable>
  );
}

export function Input({
  label,
  error,
  style,
  icon,
  ...props
}: TextInputProps & { label?: string; error?: string | null; icon?: IconName }) {
  return (
    <View style={{ gap: 6 }}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <View style={[styles.inputWrap, error ? { borderColor: colors.danger } : null]}>
        {icon ? <Ionicons name={icon} size={18} color={colors.textMuted} style={{ marginRight: 8 }} /> : null}
        <TextInput
          placeholderTextColor={colors.textDim}
          selectionColor={colors.primary}
          cursorColor={colors.primary}
          style={[styles.input, style]}
          {...props}
          clearButtonMode="never"
        />
        {/* clearButtonMode yalnızca iOS'ta çalışır; her iki platformda aynı görünen ortak temizle düğmesi */}
        {props.clearButtonMode && props.clearButtonMode !== 'never' && props.value && props.onChangeText ? (
          <Pressable
            onPress={() => props.onChangeText?.('')}
            hitSlop={8}
            accessibilityLabel="Temizle"
            style={{ marginLeft: 6 }}
          >
            <Ionicons name="close-circle" size={18} color={colors.textMuted} />
          </Pressable>
        ) : null}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

export function Badge({
  text,
  color = colors.surface3,
  textColor = colors.text,
  style,
  dot,
}: {
  text: string;
  color?: string;
  textColor?: string;
  style?: ViewStyle;
  dot?: boolean;
}) {
  return (
    <View style={[styles.badge, { backgroundColor: color }, style]}>
      {dot ? <View style={[styles.dot, { backgroundColor: textColor }]} /> : null}
      <Text style={[styles.badgeText, { color: textColor }]}>{text}</Text>
    </View>
  );
}

export function EmptyState({ icon = 'football-outline', title, subtitle }: { icon?: IconName; title: string; subtitle?: string }) {
  return (
    <View style={styles.empty}>
      <Ionicons name={icon} size={44} color={colors.textDim} />
      <Text style={styles.emptyTitle}>{title}</Text>
      {subtitle ? <Text style={styles.emptySubtitle}>{subtitle}</Text> : null}
    </View>
  );
}

export function Loading() {
  return (
    <View style={styles.empty}>
      <ActivityIndicator color={colors.primary} size="large" />
    </View>
  );
}

export function Row({ children, style, gap = spacing.sm }: PropsWithChildren<{ style?: ViewStyle; gap?: number }>) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap }, style]}>{children}</View>;
}

export function Muted({ children, style, numberOfLines }: PropsWithChildren<{ style?: TextStyle; numberOfLines?: number }>) {
  return <Text style={[{ color: colors.textMuted, fontSize: 13 }, style]} numberOfLines={numberOfLines}>{children}</Text>;
}

export function SectionTitle({ children, right }: PropsWithChildren<{ right?: ReactNode }>) {
  return (
    <View style={styles.sectionTitle}>
      <Text style={styles.sectionTitleText}>{children}</Text>
      {right}
    </View>
  );
}

export function IconButton({ icon, onPress, color = colors.text, size = 22 }: { icon: IconName; onPress?: () => void; color?: string; size?: number }) {
  return (
    <Pressable onPress={onPress} hitSlop={10} style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.6 }]}>
      <Ionicons name={icon} size={size} color={color} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    gap: spacing.md,
  },
  headerTitle: { color: colors.text, fontSize: 24, fontWeight: '800', letterSpacing: -0.5 },
  headerSubtitle: { color: colors.textMuted, fontSize: 13, marginTop: 2 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
  },
  buttonText: { fontWeight: '700' },
  label: { color: colors.textMuted, fontSize: 13, fontWeight: '600' },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface2,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    height: 50,
  },
  input: { flex: 1, color: colors.text, fontSize: 16, height: '100%' },
  error: { color: colors.danger, fontSize: 12 },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.full,
  },
  badgeText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.3 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl, gap: spacing.sm, minHeight: 240 },
  emptyTitle: { color: colors.text, fontSize: 16, fontWeight: '700', textAlign: 'center' },
  emptySubtitle: { color: colors.textMuted, fontSize: 13, textAlign: 'center' },
  sectionTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  sectionTitleText: { color: colors.textMuted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1 },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: radius.full },
});
