import { useEffect } from 'react';
import { Linking } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import { initializeKakaoSDK } from '@react-native-kakao/core';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../src/services/supabase';
import {
  startTracking, stopTracking, isTracking,
  cleanupOrphanedDrives, resetIdleTimer, startMonitoring,
  DRIVE_IDLE_CATEGORY, DRIVE_DETECT_CATEGORY, setActiveTripId,
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
  const path = url.replace(/^driend:\/\/+/, '');
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

async function handleAuthSession(session: Session | null) {
  if (!session) {
    router.replace('/(auth)/login');
    return;
  }

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
  startMonitoring();
  const { data: activeTrip } = await supabase
    .from('trips')
    .select('id')
    .eq('user_id', session.user.id)
    .is('ended_at', null)
    .maybeSingle();
  setActiveTripId(activeTrip?.id ?? null);
  router.replace('/(tabs)');
}

export default function RootLayout() {
  useEffect(() => {
    // 카카오 SDK 초기화
    initializeKakaoSDK(process.env.EXPO_PUBLIC_KAKAO_NATIVE_KEY!);

    // 알림 권한 요청 + 액션 카테고리 등록
    Notifications.requestPermissionsAsync();
    Notifications.setNotificationCategoryAsync(DRIVE_IDLE_CATEGORY, [
      { identifier: 'STOP_DRIVE', buttonTitle: '주행 종료', options: { isDestructive: true } },
      { identifier: 'CONTINUE_DRIVE', buttonTitle: '계속 주행' },
    ]);
    Notifications.setNotificationCategoryAsync(DRIVE_DETECT_CATEGORY, [
      { identifier: 'START_DRIVE', buttonTitle: '기록 시작' },
      { identifier: 'DISMISS_DETECT', buttonTitle: '무시', options: { isDestructive: false } },
    ]);

    // 알림 액션 응답 처리
    const notifSub = Notifications.addNotificationResponseReceivedListener((response) => {
      const { actionIdentifier } = response;
      if (actionIdentifier === 'STOP_DRIVE') {
        if (isTracking()) stopTracking();
        router.replace('/(tabs)');
      } else if (actionIdentifier === 'CONTINUE_DRIVE') {
        resetIdleTimer();
      } else if (actionIdentifier === 'START_DRIVE') {
        if (!isTracking()) startTracking();
        router.replace('/(tabs)');
      }
    });

    // 딥링크 처리
    Linking.getInitialURL().then((url) => { if (url) handleDeepLink(url); });
    const linkSub = Linking.addEventListener('url', ({ url }) => handleDeepLink(url));

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) cleanupOrphanedDrives();
      // supabase-js: onAuthStateChange/getSession 콜백 안에서 바로 다른 supabase 호출을 await하면
      // 내부 세션 락이 걸려 이후 모든 supabase 호출이 멈추는 문제가 있음 → setTimeout으로 한 틱 미룸
      setTimeout(() => handleAuthSession(session), 0);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setTimeout(() => handleAuthSession(session), 0);
    });

    return () => {
      notifSub.remove();
      linkSub.remove();
      subscription.unsubscribe();
    };
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(tabs)" />
      </Stack>
      <StatusBar style="auto" />
    </GestureHandlerRootView>
  );
}
