import * as Location from 'expo-location';
import { supabase } from './supabase';

export type Coordinate = { longitude: number; latitude: number };

let driveId: string | null = null;
let subscriber: Location.LocationSubscription | null = null;
const buffer: Coordinate[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;

export async function startTracking(onPoint?: (coord: Coordinate) => void): Promise<boolean> {
  // 권한 요청 (이미 허용된 경우 시스템이 자동으로 granted 반환)
  await Location.requestForegroundPermissionsAsync();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;

  // 프로필 없으면 자동 생성
  await supabase.from('profiles').upsert({
    id: user.id,
    username: user.user_metadata?.nickname ?? `user_${user.id.slice(0, 6)}`,
    avatar_url: user.user_metadata?.avatar_url ?? null,
  }, { onConflict: 'id', ignoreDuplicates: true });

  // 새 드라이브 생성
  const { data: drive, error } = await supabase
    .from('drives')
    .insert({ user_id: user.id, started_at: new Date().toISOString() })
    .select('id')
    .single();
  if (error || !drive) {
    console.error('[Tracker] drive insert error:', JSON.stringify(error));
    return false;
  }

  driveId = drive.id;

  subscriber = await Location.watchPositionAsync(
    { accuracy: Location.Accuracy.BestForNavigation, distanceInterval: 10, timeInterval: 3000 },
    (loc) => {
      const coord: Coordinate = {
        longitude: loc.coords.longitude,
        latitude: loc.coords.latitude,
      };
      buffer.push(coord);
      onPoint?.(coord);
    }
  );

  // 10초마다 버퍼 flush
  flushTimer = setInterval(flushBuffer, 10_000);
  return true;
}

export async function stopTracking(): Promise<string | null> {
  subscriber?.remove();
  subscriber = null;
  if (flushTimer) { clearInterval(flushTimer); flushTimer = null; }
  await flushBuffer();

  if (!driveId) return null;
  await supabase
    .from('drives')
    .update({ ended_at: new Date().toISOString() })
    .eq('id', driveId);

  const id = driveId;
  driveId = null;
  return id;
}

async function flushBuffer() {
  if (!buffer.length || !driveId) return;
  const points = buffer.splice(0);
  const rows = points.map((p) => ({
    drive_id: driveId!,
    location: `POINT(${p.longitude} ${p.latitude})`,
    recorded_at: new Date().toISOString(),
  }));
  await supabase.from('route_points').insert(rows);
}
