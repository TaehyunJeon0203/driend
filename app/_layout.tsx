import { useEffect } from 'react';
import { Linking } from 'react-native';
import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import { supabase } from '../src/services/supabase';
import {
  startTracking, stopTracking, isTracking,
  cleanupOrphanedDrives, resetIdleTimer, DRIVE_IDLE_CATEGORY,
} from '../src/services/locationTracker';

// 포그라운드에서도 알림 표시
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

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
    // 알림 권한 요청 + 액션 카테고리 등록
    Notifications.requestPermissionsAsync();
    Notifications.setNotificationCategoryAsync(DRIVE_IDLE_CATEGORY, [
      { identifier: 'STOP_DRIVE', buttonTitle: '주행 종료', options: { isDestructive: true } },
      { identifier: 'CONTINUE_DRIVE', buttonTitle: '계속 주행' },
    ]);

    // 알림 액션 응답 처리
    const notifSub = Notifications.addNotificationResponseReceivedListener((response) => {
      const { actionIdentifier } = response;
      if (actionIdentifier === 'STOP_DRIVE') {
        if (isTracking()) stopTracking();
        router.replace('/(tabs)');
      } else if (actionIdentifier === 'CONTINUE_DRIVE') {
        resetIdleTimer();
      }
    });

    // 딥링크 처리
    Linking.getInitialURL().then((url) => { if (url) handleDeepLink(url); });
    const linkSub = Linking.addEventListener('url', ({ url }) => handleDeepLink(url));

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

    return () => {
      notifSub.remove();
      linkSub.remove();
      subscription.unsubscribe();
    };
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
