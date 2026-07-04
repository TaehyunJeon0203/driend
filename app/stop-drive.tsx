import { useEffect } from 'react';
import { router } from 'expo-router';

export default function StopDriveRoute() {
  useEffect(() => {
    router.replace('/(tabs)');
  }, []);
  return null;
}
