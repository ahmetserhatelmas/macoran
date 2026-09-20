import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import * as Notifications from 'expo-notifications';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useRealtimeSync } from '@/lib/queries';
import { registerPushToken, routeFromPush, type PushPayload } from '@/lib/push';
import { colors } from '@/lib/theme';
import { useAuth } from '@/store/auth';
import { useFavorites } from '@/store/favorites';

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 10_000, refetchOnWindowFocus: false },
  },
});

function RealtimeBridge() {
  useRealtimeSync();
  return null;
}

function PushBridge() {
  const session = useAuth((s) => s.session);
  const router = useRouter();
  const seen = useRef<string | null>(null);

  useEffect(() => {
    if (!session) return;
    registerPushToken();
    void useFavorites.getState().syncWithServer();
  }, [session]);

  useEffect(() => {
    if (!session) return;
    const go = (data: PushPayload | Record<string, unknown> | undefined) => {
      const path = routeFromPush(data as PushPayload);
      if (path) router.push(path as '/notifications');
    };
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      go(response.notification.request.content.data);
    });
    Notifications.getLastNotificationResponseAsync().then((last) => {
      if (!last) return;
      const id = last.notification.request.identifier;
      if (seen.current === id) return;
      seen.current = id;
      go(last.notification.request.content.data);
    });
    return () => sub.remove();
  }, [router, session]);

  return null;
}

export default function RootLayout() {
  const init = useAuth((s) => s.init);
  const initialized = useAuth((s) => s.initialized);
  const session = useAuth((s) => s.session);

  useEffect(() => {
    init();
  }, [init]);

  useEffect(() => {
    if (initialized) SplashScreen.hideAsync();
  }, [initialized]);

  if (!initialized) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <RealtimeBridge />
          <PushBridge />
          <StatusBar style="light" />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: colors.bg },
              animation: 'slide_from_right',
            }}>
            <Stack.Protected guard={!!session}>
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="match/[id]" />
              <Stack.Screen name="notifications" />
              {/* Android'de 'modal' sunumu ayrı bir Dialog penceresi açar; klavye kaçınma ve
                  koyu tema orada bozuluyor. Aynı görünüm için Android'de kart + alttan kayma. */}
              <Stack.Screen
                name="betslip"
                options={{ presentation: Platform.OS === 'ios' ? 'modal' : 'card', animation: 'slide_from_bottom' }}
              />
              <Stack.Screen name="admin/index" />
              <Stack.Screen name="admin/[userId]" />
              <Stack.Screen name="admin/sim" />
              <Stack.Screen name="admin/live" />
              <Stack.Screen name="admin/scenario/[leagueId]" />
            </Stack.Protected>
            <Stack.Protected guard={!session}>
              <Stack.Screen name="(auth)/login" />
              <Stack.Screen name="(auth)/register" />
            </Stack.Protected>
          </Stack>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
