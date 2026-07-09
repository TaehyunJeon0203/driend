import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import * as Notifications from 'expo-notifications';
import { supabase } from './supabase';
import { processMatchAsync } from './mapMatcher';

const LOCATION_TASK = 'driend-location-task';
const MONITOR_TASK = 'driend-monitor-task';
const FLUSH_THRESHOLD = 10;

export type Coordinate = { longitude: number; latitude: number };

export const DRIVE_IDLE_CATEGORY = 'DRIVE_IDLE';
export const DRIVE_DETECT_CATEGORY = 'DRIVE_DETECT';
// 주행 감지 알림 켜기/끄기 설정 키 (AsyncStorage)
export const DRIVE_DETECT_NOTIFICATION_KEY = 'drive_detect_notification_enabled';

const IDLE_SPEED_THRESHOLD = 1.5;    // m/s (≈5 km/h)
const IDLE_TIMEOUT_MS = 10 * 60 * 1000;  // 10분 → 정차 알림
const AUTO_STOP_MS = 12 * 60 * 1000;     // 12분 → 자동 종료
const DETECT_SPEED_MPS = 13 / 3.6;       // 주행 감지 기준 속도

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

// 최고 속도 (m/s)
let maxSpeedMs = 0;

// 여행 모드
let activeTripId: string | null = null;

export function setActiveTripId(id: string | null): void {
  activeTripId = id;
}

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

// 주행 감지 태스크 (알림 전송용 — 자동 시작 아님)
TaskManager.defineTask(MONITOR_TASK, async ({ data, error }: TaskManager.TaskManagerTaskBody<{ locations: Location.LocationObject[] }>) => {
  if (error || !data?.locations?.length || isTracking()) return;

  const loc = data.locations[data.locations.length - 1];
  const speed = loc.coords.speed ?? -1;
  const accuracy = loc.coords.accuracy ?? 999;

  if (speed < DETECT_SPEED_MPS || accuracy >= 60) return;

  const enabled = await AsyncStorage.getItem(DRIVE_DETECT_NOTIFICATION_KEY);
  if (enabled !== 'true') return;

  await Notifications.scheduleNotificationAsync({
    content: {
      title: '주행 중인 것 같아요',
      body: '기록을 시작할까요?',
      categoryIdentifier: DRIVE_DETECT_CATEGORY,
    },
    trigger: null,
  });

  // 중복 알림 방지: 알림 발송 후 MONITOR_TASK 중지 (stopTracking 시 재시작됨)
  await Location.stopLocationUpdatesAsync(MONITOR_TASK);
});

// 고정밀 주행 추적 태스크
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
    if (speed > maxSpeedMs) maxSpeedMs = speed;

    if (speed >= 0) {
      if (speed > IDLE_SPEED_THRESHOLD) {
        lastMovingTimestamp = now;
        if (idleNotificationSent) {
          idleNotificationSent = false;
          Notifications.dismissAllNotificationsAsync();
        }
      } else if (lastMovingTimestamp) {
        const idleDuration = now - lastMovingTimestamp;
        if (idleDuration >= AUTO_STOP_MS) {
          await stopTracking();
          return;
        } else if (!idleNotificationSent && idleDuration >= IDLE_TIMEOUT_MS) {
          idleNotificationSent = true;
          Notifications.scheduleNotificationAsync({
            content: {
              title: '주행이 종료되었나요?',
              body: '10분 이상 정차 중입니다. 주행을 종료할까요?',
              categoryIdentifier: DRIVE_IDLE_CATEGORY,
            },
            trigger: null,
          });
        }
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

const KO_TO_PROVINCE_CODE: Record<string, string> = {
  '서울특별시': 'Seoul', '부산광역시': 'Busan', '대구광역시': 'Daegu',
  '인천광역시': 'Incheon', '광주광역시': 'Gwangju', '대전광역시': 'Daejeon',
  '울산광역시': 'Ulsan', '세종특별자치시': 'Sejongsi', '경기도': 'Gyeonggi-do',
  '강원특별자치도': 'Gangwon-do', '강원도': 'Gangwon-do',
  '충청북도': 'Chungcheongbuk-do', '충청남도': 'Chungcheongnam-do',
  '전북특별자치도': 'Jeollabuk-do', '전라북도': 'Jeollabuk-do',
  '전라남도': 'Jeollanam-do', '경상북도': 'Gyeongsangbuk-do',
  '경상남도': 'Gyeongsangnam-do', '제주특별자치도': 'Jeju-do',
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
      const rawRegion = geo.region ?? null;
      if (!rawRegion) continue;
      const code = KO_TO_PROVINCE_CODE[rawRegion] ?? rawRegion;
      if (seenCodes.has(code)) continue;
      seenCodes.add(code);
      const name = geo.city ?? REGION_TO_KO[code] ?? rawRegion;
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
  maxSpeedMs = 0;
}

export function isTracking(): boolean {
  return driveId !== null;
}

export async function startMonitoring(): Promise<void> {
  const { status } = await Location.getBackgroundPermissionsAsync();
  if (status !== 'granted') return;

  const alreadyRunning = await Location.hasStartedLocationUpdatesAsync(MONITOR_TASK);
  if (alreadyRunning) return;

  await Location.startLocationUpdatesAsync(MONITOR_TASK, {
    accuracy: Location.Accuracy.Balanced,
    timeInterval: 10000,
    distanceInterval: 30,
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
    .insert({ user_id: user.id, started_at: new Date().toISOString(), trip_id: activeTripId })
    .select('id')
    .single();
  if (error || !drive) {
    console.error('[Tracker] drive insert error:', JSON.stringify(error));
    return false;
  }

  driveId = drive.id;
  resetDriveState();

  // MONITOR_TASK 중지 (주행 중엔 감지 불필요)
  const monitorRunning = await Location.hasStartedLocationUpdatesAsync(MONITOR_TASK);
  if (monitorRunning) await Location.stopLocationUpdatesAsync(MONITOR_TASK);

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

  let startAddress: string | null = null;
  let endAddress: string | null = null;
  try {
    if (firstCoord) {
      const [g] = await Location.reverseGeocodeAsync(firstCoord);
      startAddress = g.city ?? g.district ?? REGION_TO_KO[g.region ?? ''] ?? g.region ?? null;
    }
    if (prevCoord) {
      const [g] = await Location.reverseGeocodeAsync(prevCoord);
      endAddress = g.city ?? g.district ?? REGION_TO_KO[g.region ?? ''] ?? g.region ?? null;
    }
  } catch {}

  await supabase
    .from('drives')
    .update({
      ended_at: new Date().toISOString(),
      distance_km: distanceKm,
      max_speed_kmh: maxSpeedMs * 3.6,
      start_address: startAddress,
      end_address: endAddress,
    })
    .eq('id', driveId);

  if (user && sampleCoords.length > 0) {
    recordVisitedCities(user.id, sampleCoords);
  }

  const id = driveId;
  driveId = null;
  resetDriveState();

  stopListeners.forEach((cb) => cb());

  await startMonitoring();

  if (id) processMatchAsync(id).catch(() => {});

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
