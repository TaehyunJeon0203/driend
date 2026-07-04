import { useEffect } from 'react';
import { router } from 'expo-router';

export default function StartDriveRoute() {
  useEffect(() => {
    router.replace('/(tabs)');
  }, []);
  return null;
}
