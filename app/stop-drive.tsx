import { useEffect } from 'react';
import { router } from 'expo-router';
import { markPendingWidgetStopDrive } from '../src/services/widgetBridge';

export default function StopDriveRoute() {
  useEffect(() => {
    markPendingWidgetStopDrive();
    router.replace('/(tabs)');
  }, []);
  return null;
}
