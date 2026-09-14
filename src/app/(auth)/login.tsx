import Ionicons from '@expo/vector-icons/Ionicons';
import { Link } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button, Input, Screen } from '@/components/ui';
import { colors, radius, spacing } from '@/lib/theme';
import { useAuth } from '@/store/auth';

export default function LoginScreen() {
  const signIn = useAuth((s) => s.signIn);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!email || !password) return setError('E-posta ve şifre gerekli.');
    setLoading(true);
    setError(null);
    const err = await signIn(email, password);
    setLoading(false);
    if (err) setError(err);
  };

  return (
    <Screen edges={['top', 'bottom']}>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <View style={styles.logoWrap}>
            <View style={styles.logo}>
              <Ionicons name="football" size={40} color={colors.primaryText} />
            </View>
            <Text style={styles.brand}>Macoran</Text>
            <Text style={styles.tagline}>Sanal para ile canlı iddaa keyfi</Text>
          </View>

          <View style={styles.form}>
            <Input
              label="E-posta"
              icon="mail-outline"
              placeholder="ornek@mail.com"
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
              value={email}
              onChangeText={setEmail}
            />
            <Input
              label="Şifre"
              icon="lock-closed-outline"
              placeholder="••••••••"
              secureTextEntry
              value={password}
              onChangeText={setPassword}
              onSubmitEditing={submit}
              error={error}
            />
            <Button title="Giriş Yap" onPress={submit} loading={loading} size="lg" />
          </View>

          <View style={styles.footer}>
            <Text style={{ color: colors.textMuted }}>Hesabın yok mu? </Text>
            <Link href="/(auth)/register" style={styles.link}>
              Kayıt ol
            </Link>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, justifyContent: 'center', padding: spacing.xl, gap: spacing.xxl },
  logoWrap: { alignItems: 'center', gap: spacing.sm },
  logo: {
    width: 84,
    height: 84,
    borderRadius: radius.xl,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  brand: { color: colors.text, fontSize: 32, fontWeight: '900', letterSpacing: -1 },
  tagline: { color: colors.textMuted, fontSize: 14 },
  form: { gap: spacing.lg },
  footer: { flexDirection: 'row', justifyContent: 'center' },
  link: { color: colors.primary, fontWeight: '700' },
});
