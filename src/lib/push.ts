import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Linking, PermissionsAndroid, Platform } from 'react-native';

import { supabase } from '@/lib/supabase';

const PROJECT_ID =
  Constants.easConfig?.projectId ??
  (Constants.expoConfig?.extra?.eas as { projectId?: string } | undefined)?.projectId;

const WELCOME_KEY = 'macoran-push-welcome';
const CHANNEL_ID = 'macoran';

const ANDROID_CHANNELS: {
  id: string;
  name: string;
  sound: string;
}[] = [
  { id: CHANNEL_ID, name: 'Macoran', sound: 'default' },
  { id: 'macoran-kickoff', name: 'Maç başlangıcı', sound: 'kickoff.wav' },
  { id: 'macoran-goal', name: 'Gol', sound: 'goal.wav' },
  { id: 'macoran-ft', name: 'Maç bitişi', sound: 'fulltime.wav' },
  { id: 'macoran-ht', name: 'Devre arası', sound: 'ht.wav' },
  { id: 'macoran-foul', name: 'Penaltı / faul', sound: 'foul.wav' },
  { id: 'macoran-miss', name: 'Penaltı kaçtı', sound: 'miss.wav' },
];

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowAlert: true,
  }),
});

export type PushPayload = {
  type?: string;
  fixture_id?: number | string | null;
  ref_id?: string | null;
  id?: string | null;
};

export function routeFromPush(data: PushPayload | undefined | null): string | null {
  if (!data) return null;
  const fid = data.fixture_id != null ? Number(data.fixture_id) : NaN;
  if (Number.isFinite(fid) && fid > 0) return `/match/${fid}`;
  if (typeof data.type === 'string' && data.type.startsWith('bet_')) return '/(tabs)/bets';
  return '/notifications';
}

let permInflight: Promise<boolean> | null = null;

async function ensureAndroidChannel() {
  if (Platform.OS !== 'android') return;
  for (const ch of ANDROID_CHANNELS) {
    await Notifications.setNotificationChannelAsync(ch.id, {
      name: ch.name,
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 180, 80, 180],
      lightColor: '#22C55E',
      sound: ch.sound,
      enableVibrate: true,
      showBadge: true,
    });
  }
}

function androidApi(): number {
  const v = Platform.Version;
  return typeof v === 'number' ? v : parseInt(String(v), 10) || 0;
}

/** Android 13+ sistem iznini gerçek runtime dialog ile ister. Giriş öncesi de çağrılmalı. */
export async function requestNotificationPermission(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  if (permInflight) return permInflight;
  permInflight = (async () => {
    try {
      await ensureAndroidChannel();

      if (Platform.OS === 'android' && androidApi() >= 33) {
        const perm = PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS;
        const already = await PermissionsAndroid.check(perm);
        if (already) return true;
        const result = await PermissionsAndroid.request(perm, {
          title: 'Bildirim izni',
          message: 'Maç ve kupon haberlerinin telefona gelmesi için bildirim izni gerekir.',
          buttonPositive: 'İzin ver',
          buttonNegative: 'Şimdi değil',
        });
        return result === PermissionsAndroid.RESULTS.GRANTED;
      }

      const { status: existing } = await Notifications.getPermissionsAsync();
      if (existing === 'granted') return true;
      const req = await Notifications.requestPermissionsAsync();
      return req.status === 'granted';
    } catch (e) {
      console.warn('[push] permission', e);
      return false;
    }
  })();
  try {
    return await permInflight;
  } finally {
    permInflight = null;
  }
}

export async function getNotificationPermissionGranted(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    if (Platform.OS === 'android' && androidApi() >= 33) {
      return PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
    }
    const { status } = await Notifications.getPermissionsAsync();
    return status === 'granted';
  } catch {
    return false;
  }
}

async function maybeWelcomeBanner() {
  try {
    const seen = await AsyncStorage.getItem(WELCOME_KEY);
    if (seen) return;
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Bildirimler açık',
        body: 'Favori maçların ve kuponların haberleri telefona gelecek.',
        sound: true,
      },
      trigger: null,
    });
    await AsyncStorage.setItem(WELCOME_KEY, '1');
  } catch (e) {
    console.warn('[push] welcome', e);
  }
}

export async function registerPushToken(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    const granted = await requestNotificationPermission();
    if (!granted || !PROJECT_ID) return false;

    const token = (await Notifications.getExpoPushTokenAsync({ projectId: PROJECT_ID })).data;
    if (!token) return false;
    await supabase.rpc('register_push_token', {
      p_token: token,
      p_platform: Platform.OS,
    });
    await maybeWelcomeBanner();
    return true;
  } catch (e) {
    console.warn('[push] register', e);
    return false;
  }
}

export async function openSystemNotificationSettings() {
  await Linking.openSettings();
}

export async function unregisterPushToken() {
  if (Platform.OS === 'web') return;
  try {
    if (!PROJECT_ID) return;
    const token = (await Notifications.getExpoPushTokenAsync({ projectId: PROJECT_ID })).data;
    if (token) await supabase.rpc('unregister_push_token', { p_token: token });
  } catch {
    /* çıkışta sessiz */
  }
}
