import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import * as Notifications from 'expo-notifications';
import { supabase } from './supabase';

const LOCATION_TASK = 'driend-location-task';
const MONITOR_TASK = 'driend-monitor-task';
const FLUSH_THRESHOLD = 10;

export type Coordinate = { longitude: number; latitude: number };

export const DRIVE_IDLE_CATEGORY = 'DRIVE_IDLE';
const IDLE_SPEED_THRESHOLD = 1.5;  // m/s ≈ 5 km/h
const IDLE_TIMEOUT_MS = 5 * 60 * 1000;   // 5분 → 알림
const AUTO_STOP_MS = 10 * 60 * 1000;     // 10분 → 자동 종료

// 자동 감지 (25 km/h 이상을 15초 간격으로 2회 연속 감지)
const AUTO_START_SPEED_MS = 25 / 3.6;
const AUTO_START_CONFIRM_COUNT = 2;

// 주행 상태
let driveId: string | null = null;
const buffer: Coordinate[] = [];

let runningDistanceKm = 0;
let prevCoord: Coordinate | null = null;
let firstCoord: Coordinate | null = null;
let midCoord: Coordinate | null = null;
let coordCount = 0;

// 정차 감지
let lastMovingTimestamp: number | null = null;
let idleNotificationSent = false;

// 자동 감지
let drivingFastCount = 0;

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

export function resetIdleTimer(): void {
  lastMovingTimestamp = Date.now();
  idleNotificationSent = false;
}

// 저전력 자동 감지 태스크
TaskManager.defineTask(MONITOR_TASK, async ({ data, error }: TaskManager.TaskManagerTaskBody<{ locations: Location.LocationObject[] }>) => {
  if (error || !data?.locations?.length) return;
  if (isTracking()) { drivingFastCount = 0; return; }

  const loc = data.locations[data.locations.length - 1];
  const speed = loc.coords.speed ?? -1;
  const accuracy = loc.coords.accuracy ?? 999;

  if (speed >= AUTO_START_SPEED_MS && accuracy < 60) {
    drivingFastCount++;
    if (drivingFastCount >= AUTO_START_CONFIRM_COUNT) {
      drivingFastCount = 0;
      await startTracking();
    }
  } else {
    drivingFastCount = 0;
  }
});

// 고정밀 추적 태스크
TaskManager.defineTask(LOCATION_TASK, async ({ data, error }: TaskManager.TaskManagerTaskBody<{ locations: Location.LocationObject[] }>) => {
  if (error) {
    console.error('[Tracker] background task error:', error.message);
    return;
  }
  if (!data?.locations?.length) return;

  const now = Date.now();
  for (const loc of data.locations) {
    const coord: Coordinate = {
      longitude: loc.coords.longitude,
      latitude: loc.coords.latitude,
    };

    coordCount++;
    if (!firstCoord) firstCoord = coord;
    if (prevCoord) runningDistanceKm += haversineKm(prevCoord, coord);
    prevCoord = coord;
    if (coordCount % 30 === 0) midCoord = coord;

    buffer.push(coord);
    pointListeners.forEach((cb) => cb(coord));

    const speed = loc.coords.speed ?? -1;
    if (speed >= 0 && speed > IDLE_SPEED_THRESHOLD) {
      lastMovingTimestamp = now;
      if (idleNotificationSent) {
        idleNotificationSent = false;
        Notifications.dismissAllNotificationsAsync();
      }
    } else if (speed >= 0 && lastMovingTimestamp) {
      const idleDuration = now - lastMovingTimestamp;
      if (idleDuration >= AUTO_STOP_MS) {
        await stopTracking();
        return;
      } else if (!idleNotificationSent && idleDuration >= IDLE_TIMEOUT_MS) {
        idleNotificationSent = true;
        Notifications.scheduleNotificationAsync({
          content: {
            title: '주행이 종료되었나요?',
            body: '5분 이상 정차 중입니다. 주행을 종료할까요?',
            categoryIdentifier: DRIVE_IDLE_CATEGORY,
          },
          trigger: null,
        });
      }
    }
  }

  if (buffer.length >= FLUSH_THRESHOLD) flushBuffer();
});

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

async function recordVisitedCities(userId: string, coords: Coordinate[]) {
  const seenCodes = new Set<string>();
  for (const coord of coords) {
    try {
      const [geo] = await Location.reverseGeocodeAsync(coord);
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

function resetDriveState() {
  runningDistanceKm = 0;
  prevCoord = null;
  firstCoord = null;
  midCoord = null;
  coordCount = 0;
  buffer.length = 0;
  lastMovingTimestamp = null;
  idleNotificationSent = false;
}

export function isTracking(): boolean {
  return driveId !== null;
}

async function stopMonitoring(): Promise<void> {
  const isRunning = await Location.hasStartedLocationUpdatesAsync(MONITOR_TASK);
  if (isRunning) await Location.stopLocationUpdatesAsync(MONITOR_TASK);
}

export async function startMonitoring(): Promise<void> {
  const { status } = await Location.getBackgroundPermissionsAsync();
  if (status !== 'granted') return;

  drivingFastCount = 0;
  const alreadyRunning = await Location.hasStartedLocationUpdatesAsync(MONITOR_TASK);
  if (alreadyRunning) return;

  await Location.startLocationUpdatesAsync(MONITOR_TASK, {
    accuracy: Location.Accuracy.Balanced,
    timeInterval: 15000,
    distanceInterval: 100,
    showsBackgroundLocationIndicator: false,
  });
}

export async function cleanupOrphanedDrives(): Promise<void> {
  if (isTracking()) return;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  await supabase
    .from('drives')
    .update({ ended_at: new Date().toISOString(), distance_km: 0 })
    .eq('user_id', user.id)
    .is('ended_at', null);
}

export async function startTracking(): Promise<boolean> {
  const { status: fgStatus } = await Location.requestForegroundPermissionsAsync();
  if (fgStatus !== 'granted') return false;

  const { status: bgStatus } = await Location.requestBackgroundPermissionsAsync();
  if (bgStatus !== 'granted') return false;

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
  resetDriveState();

  await stopMonitoring();

  const alreadyRunning = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
  if (alreadyRunning) await Location.stopLocationUpdatesAsync(LOCATION_TASK);

  await Location.startLocationUpdatesAsync(LOCATION_TASK, {
    accuracy: Location.Accuracy.BestForNavigation,
    distanceInterval: 10,
    timeInterval: 3000,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: 'Driend 주행 중',
      notificationBody: '주행 경로를 기록하고 있습니다.',
      notificationColor: '#047857',
    },
  });

  return true;
}

export async function stopTracking(): Promise<string | null> {
  const isRunning = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
  if (isRunning) await Location.stopLocationUpdatesAsync(LOCATION_TASK);

  Notifications.dismissAllNotificationsAsync();
  await flushBuffer();

  if (!driveId) return null;

  const distanceKm = runningDistanceKm;
  const sampleCoords = [firstCoord, midCoord, prevCoord].filter(Boolean) as Coordinate[];

  const { data: { user } } = await supabase.auth.getUser();

  await supabase
    .from('drives')
    .update({ ended_at: new Date().toISOString(), distance_km: distanceKm })
    .eq('id', driveId);

  if (user && sampleCoords.length > 0) {
    recordVisitedCities(user.id, sampleCoords);
  }

  const id = driveId;
  driveId = null;
  resetDriveState();

  stopListeners.forEach((cb) => cb());

  await startMonitoring();

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
