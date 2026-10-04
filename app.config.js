/**
 * EAS/Metro build sırasında .env gitignore yüzünden yüklenmez.
 * Supabase adresi EAS Environment Variables + eas.json env ile buraya gelir;
 * yoksa placeholder APK'sı yerine build kırılır.
 */
module.exports = ({ config }) => {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey || url.includes('placeholder')) {
    throw new Error(
      '[macoran] EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY eksik. EAS env veya .env tanımlayın.',
    );
  }
  return {
    ...config,
    extra: {
      ...(config.extra ?? {}),
      supabaseUrl: url,
      supabaseAnonKey: anonKey,
    },
  };
};
