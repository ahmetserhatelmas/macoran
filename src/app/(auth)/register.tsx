import { Link, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, KeyboardAvoidingView, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button, Header, IconButton, Input, Screen } from '@/components/ui';
import { colors, spacing } from '@/lib/theme';
import { useAuth } from '@/store/auth';

export default function RegisterScreen() {
  const router = useRouter();
  const signUp = useAuth((s) => s.signUp);
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (username.trim().length < 3) return setError('Kullanıcı adı en az 3 karakter olmalı.');
    if (!/^[a-zA-Z0-9_]+$/.test(username.trim())) return setError('Kullanıcı adı sadece harf, rakam ve _ içerebilir.');
    if (!email.includes('@')) return setError('Geçerli bir e-posta girin.');
    if (password.length < 6) return setError('Şifre en az 6 karakter olmalı.');
    setLoading(true);
    setError(null);
    const err = await signUp(email, password, username);
    setLoading(false);
    if (err) return setError(err);
    // E-posta doğrulaması kapalıysa oturum otomatik açılır; açıksa bilgilendir.
    const session = useAuth.getState().session;
    if (!session) {
      Alert.alert('Kayıt tamamlandı', 'E-posta adresinize gelen doğrulama bağlantısına tıklayıp giriş yapın.', [
        { text: 'Tamam', onPress: () => router.replace('/(auth)/login') },
      ]);
    }
  };

  return (
    <Screen edges={['top', 'bottom']}>
      <Header title="Kayıt Ol" subtitle="Ücretsiz hesap oluştur" left={<IconButton icon="chevron-back" onPress={() => router.back()} />} />
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <View style={styles.form}>
            <Input label="Kullanıcı adı" icon="person-outline" placeholder="kullanici_adi" autoCapitalize="none" value={username} onChangeText={setUsername} />
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
              placeholder="En az 6 karakter"
              secureTextEntry
              value={password}
              onChangeText={setPassword}
              onSubmitEditing={submit}
              error={error}
            />
            <Button title="Hesap Oluştur" onPress={submit} loading={loading} size="lg" />
            <Text style={styles.note}>Bakiyeniz admin tarafından sanal para olarak yüklenir. Gerçek para kullanılmaz.</Text>
          </View>

          <View style={styles.footer}>
            <Text style={{ color: colors.textMuted }}>Zaten hesabın var mı? </Text>
            <Link href="/(auth)/login" style={styles.link}>
              Giriş yap
            </Link>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, padding: spacing.xl, gap: spacing.xxl },
  form: { gap: spacing.lg },
  note: { color: colors.textDim, fontSize: 12, textAlign: 'center' },
  footer: { flexDirection: 'row', justifyContent: 'center' },
  link: { color: colors.primary, fontWeight: '700' },
});
