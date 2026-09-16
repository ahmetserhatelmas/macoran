import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useRealtimeSync } from '@/lib/queries';
import { colors } from '@/lib/theme';
import { useAuth } from '@/store/auth';

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
