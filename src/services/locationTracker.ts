import * as Location from 'expo-location';
import { supabase } from './supabase';

export type Coordinate = { longitude: number; latitude: number };

let driveId: string | null = null;
let subscriber: Location.LocationSubscription | null = null;
const buffer: Coordinate[] = [];
const allCoords: Coordinate[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;

// 전역 리스너 — 딥링크/버튼 어디서 시작해도 지도가 포인트를 받을 수 있음
const pointListeners = new Set<(coord: Coordinate) => void>();
const stopListeners = new Set<() => void>();

export function addPointListener(cb: (coord: Coordinate) => void): () => void {
  pointListeners.add(cb);
  return () => pointListeners.delete(cb);
}

export function addStopListener(cb: () => void): () => void {
  stopListeners.add(cb);
  return () => stopListeners.delete(cb);
}

const REGION_TO_KO: Record<string, string> = {
  'Seoul': '서울특별시',
  'Busan': '부산광역시',
  'Daegu': '대구광역시',
  'Incheon': '인천광역시',
  'Gwangju': '광주광역시',
  'Daejeon': '대전광역시',
  'Ulsan': '울산광역시',
  'Sejong': '세종특별자치시',
  'Gyeonggi-do': '경기도',
  'Gangwon-do': '강원특별자치도',
  'Chungcheongbuk-do': '충청북도',
  'Chungcheongnam-do': '충청남도',
  'Jeollabuk-do': '전북특별자치도',
  'Jeollanam-do': '전라남도',
  'Gyeongsangbuk-do': '경상북도',
  'Gyeongsangnam-do': '경상남도',
  'Jeju-do': '제주특별자치도',
};

function haversineKm(a: Coordinate, b: Coordinate): number {
  const R = 6371;
  const dLat = (b.latitude - a.latitude) * (Math.PI / 180);
  const dLon = (b.longitude - a.longitude) * (Math.PI / 180);
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(a.latitude * Math.PI / 180) *
    Math.cos(b.latitude * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

function calcTotalDistance(coords: Coordinate[]): number {
  let total = 0;
  for (let i = 1; i < coords.length; i++) total += haversineKm(coords[i - 1], coords[i]);
  return total;
}

async function recordVisitedCities(userId: string, coords: Coordinate[]) {
  const indices = [0, Math.floor(coords.length / 2), coords.length - 1];
  const uniqueIndices = [...new Set(indices)];
  const seenCodes = new Set<string>();

  for (const idx of uniqueIndices) {
    try {
      const [geo] = await Location.reverseGeocodeAsync(coords[idx]);
      const code = geo.region ?? geo.city ?? null;
      if (!code || seenCodes.has(code)) continue;
      seenCodes.add(code);
      const name = REGION_TO_KO[code] ?? code;
      await supabase.from('visited_cities').upsert(
        { user_id: userId, city_code: code, city_name: name, first_visited_at: new Date().toISOString() },
        { onConflict: 'user_id,city_code', ignoreDuplicates: true }
      );
    } catch {}
  }
}

export function isTracking(): boolean {
  return driveId !== null;
}

export async function startTracking(): Promise<boolean> {
  await Location.requestForegroundPermissionsAsync();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;

  await supabase.from('profiles').upsert({
    id: user.id,
    username: user.user_metadata?.nickname ?? `user_${user.id.slice(0, 6)}`,
    avatar_url: user.user_metadata?.avatar_url ?? null,
  }, { onConflict: 'id', ignoreDuplicates: true });

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
  allCoords.length = 0;

  subscriber = await Location.watchPositionAsync(
    { accuracy: Location.Accuracy.BestForNavigation, distanceInterval: 10, timeInterval: 3000 },
    (loc) => {
      const coord: Coordinate = {
        longitude: loc.coords.longitude,
        latitude: loc.coords.latitude,
      };
      buffer.push(coord);
      allCoords.push(coord);
      pointListeners.forEach((cb) => cb(coord));
    }
  );

  flushTimer = setInterval(flushBuffer, 10_000);
  return true;
}

export async function stopTracking(): Promise<string | null> {
  subscriber?.remove();
  subscriber = null;
  if (flushTimer) { clearInterval(flushTimer); flushTimer = null; }
  await flushBuffer();

  if (!driveId) return null;
  const distanceKm = calcTotalDistance(allCoords);
  const coordSnapshot = [...allCoords];
  allCoords.length = 0;

  const { data: { user } } = await supabase.auth.getUser();

  await supabase
    .from('drives')
    .update({ ended_at: new Date().toISOString(), distance_km: distanceKm })
    .eq('id', driveId);

  if (user && coordSnapshot.length > 0) {
    recordVisitedCities(user.id, coordSnapshot);
  }

  const id = driveId;
  driveId = null;

  stopListeners.forEach((cb) => cb());
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
