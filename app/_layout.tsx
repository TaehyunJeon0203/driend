import { useEffect } from 'react';
import { Linking } from 'react-native';
import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { supabase } from '../src/services/supabase';
import { startTracking, stopTracking, isTracking, cleanupOrphanedDrives } from '../src/services/locationTracker';

async function handleDeepLink(url: string) {
  const path = url.replace('driend://', '');
  if (path === 'start-drive') {
    if (!isTracking()) {
      await startTracking();
    }
    router.replace('/(tabs)');
  } else if (path === 'stop-drive') {
    if (isTracking()) {
      await stopTracking();
    }
    router.replace('/(tabs)');
  }
}

export default function RootLayout() {
  useEffect(() => {
    // 앱이 닫혀있다가 딥링크로 열린 경우
    Linking.getInitialURL().then((url) => { if (url) handleDeepLink(url); });
    // 앱이 백그라운드에 있다가 딥링크를 받은 경우
    const sub = Linking.addEventListener('url', ({ url }) => handleDeepLink(url));

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        cleanupOrphanedDrives();
        router.replace('/(tabs)');
      } else {
        router.replace('/(auth)/login');
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session) {
        // 프로필 없으면 자동 생성 (익명 유저 포함)
        const { data: profile } = await supabase
          .from('profiles')
          .select('id')
          .eq('id', session.user.id)
          .single();
        if (!profile) {
          await supabase.from('profiles').insert({
            id: session.user.id,
            username: session.user.user_metadata?.nickname ?? `user_${session.user.id.slice(0, 6)}`,
            avatar_url: session.user.user_metadata?.avatar_url ?? null,
          });
        }
        router.replace('/(tabs)');
      } else {
        router.replace('/(auth)/login');
      }
    });

    return () => { subscription.unsubscribe(); sub.remove(); };
  }, []);

  return (
    <>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(tabs)" />
      </Stack>
      <StatusBar style="auto" />
    </>
  );
}
