/**
 * EAS/Metro build sırasında .env gitignore yüzünden yüklenmez.
 * Supabase adresi EAS Environment Variables + eas.json env ile buraya gelir;
 * yoksa placeholder APK'sı yerine build kırılır.
 * Yerel `eas submit` .env'i kendisi okumaz; dosyadan dolduruyoruz.
 */
const fs = require('fs');
const path = require('path');

function loadDotEnv() {
  const file = path.join(__dirname, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    const key = t.slice(0, i).trim();
    let value = t.slice(i + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

module.exports = ({ config }) => {
  loadDotEnv();
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
