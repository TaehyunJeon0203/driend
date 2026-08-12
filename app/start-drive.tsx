import { useEffect } from 'react';
import { router } from 'expo-router';
import { markPendingWidgetStartDrive } from '../src/services/widgetBridge';

export default function StartDriveRoute() {
  useEffect(() => {
    markPendingWidgetStartDrive();
    router.replace('/(tabs)');
  }, []);
  return null;
}
