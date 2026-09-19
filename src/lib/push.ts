import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';

const PROJECT_ID =
  Constants.easConfig?.projectId ??
  (Constants.expoConfig?.extra?.eas as { projectId?: string } | undefined)?.projectId;

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

export async function registerPushToken() {
  if (Platform.OS === 'web') return;
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('macoran', {
        name: 'Macoran',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 180, 80, 180],
        lightColor: '#22C55E',
        sound: 'default',
      });
    }

    const { status: existing } = await Notifications.getPermissionsAsync();
    let status = existing;
    if (existing !== 'granted') {
      const req = await Notifications.requestPermissionsAsync();
      status = req.status;
    }
    if (status !== 'granted' || !PROJECT_ID) return;

    const token = (await Notifications.getExpoPushTokenAsync({ projectId: PROJECT_ID })).data;
    if (!token) return;
    await supabase.rpc('register_push_token', {
      p_token: token,
      p_platform: Platform.OS,
    });
  } catch (e) {
    console.warn('[push] register', e);
  }
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
