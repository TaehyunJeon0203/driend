import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { supabase } from './supabase';
import { processMatchAsync } from './mapMatcher';
import { buildCityIndex, matchVisitedCities } from './geo';
import { createStopCoordinator } from './stopCoordinator';
import { toPersistedSpeedKmh, validateLocationSample, type LocationSample } from './routeTrackingUtils';
import CITY_DATA from '../../assets/korea-cities.json';

type City = { code: string; name: string; province_code: string; center: Coordinate; polygons: Coordinate[][] };
const CITIES = CITY_DATA as City[];
const CITY_INDEX = buildCityIndex(CITIES);

const LOCATION_TASK = 'driend-location-task';
const MONITOR_TASK = 'driend-monitor-task';
const FLUSH_THRESHOLD = 10;
const ACTIVE_DRIVE_STORAGE_KEY = 'location_tracker_active_drive';

export type Coordinate = { longitude: number; latitude: number };
type TrackedPoint = Coordinate & { speedKmh: number | null; recordedAt: string };
type PersistedDriveState = {
  driveId: string;
  runningDistanceKm: number;
  lastAcceptedSample: LocationSample | null;
  firstCoord: Coordinate | null;
  midCoord: Coordinate | null;
  coordCount: number;
  lastMovingTimestamp: number | null;
  lastLocationReceivedAt: number | null;
  maxSpeedMs: number;
  pendingPoints: TrackedPoint[];
  driveCoords: Coordinate[];
};

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
const buffer: TrackedPoint[] = [];
const driveCoords: Coordinate[] = [];
let flushPromise: Promise<void> | null = null;

let runningDistanceKm = 0;
let prevCoord: Coordinate | null = null;
let lastAcceptedSample: LocationSample | null = null;
let firstCoord: Coordinate | null = null;
let midCoord: Coordinate | null = null;
let coordCount = 0;

// 정차 감지
let lastMovingTimestamp: number | null = null;
let idleNotificationSent = false;
// 지하주차장 등 GPS 신호 자체가 끊기면 위 정차 감지가 아예 실행되지 않으므로
// (새 위치가 안 들어오니 콜백도 안 도는 상태) 마지막으로 위치를 받은 시각을 따로 추적
let lastLocationReceivedAt: number | null = null;

// 최고 속도 (m/s)
let maxSpeedMs = 0;

// 여행 모드
let activeTripId: string | null = null;

export function setActiveTripId(id: string | null): void {
  activeTripId = id;
}

const pointListeners = new Set<(coord: Coordinate, distanceKm: number, recordedAt: string) => void>();
const stopListeners = new Set<(stoppedDriveId: string) => void>();

export function addPointListener(cb: (coord: Coordinate, distanceKm: number, recordedAt: string) => void): () => void {
  pointListeners.add(cb);
  return () => pointListeners.delete(cb);
}

export function addStopListener(cb: (stoppedDriveId: string) => void): () => void {
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
  await restoreTrackingState();
  if (!driveId) return;

  const now = Date.now();
  lastLocationReceivedAt = now;
  for (const loc of data.locations) {
    const speed = loc.coords.speed;
    // Idle detection still consumes reported motion state even when a coordinate is filtered out;
    // rejected jitter must not prevent stationary auto-stop from firing.
    if (speed != null && speed >= 0) {
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

    const sample: LocationSample = {
      longitude: loc.coords.longitude,
      latitude: loc.coords.latitude,
      timestamp: loc.timestamp,
      accuracy: loc.coords.accuracy,
      speed: loc.coords.speed,
    };
    const validation = validateLocationSample(sample, lastAcceptedSample);
    if (!validation.accepted) continue;
    const coord: Coordinate = { longitude: sample.longitude, latitude: sample.latitude };

    coordCount++;
    if (!firstCoord) firstCoord = coord;
    runningDistanceKm += validation.distanceKm;
    prevCoord = coord;
    lastAcceptedSample = sample;
    if (coordCount % 30 === 0) midCoord = coord;

    const recordedAt = new Date(loc.timestamp).toISOString();
    buffer.push({
      ...coord,
      speedKmh: speed == null || speed < 0 ? null : speed * 3.6,
      recordedAt,
    });
    driveCoords.push(coord);
    pointListeners.forEach((cb) => cb(coord, runningDistanceKm, recordedAt));

    if (speed != null && speed > maxSpeedMs) maxSpeedMs = speed;

  }

  if (buffer.length >= FLUSH_THRESHOLD) await flushBuffer();
  await persistTrackingState();
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

async function recordVisitedCities(userId: string, coords: Coordinate[]) {
  const matched = matchVisitedCities(coords, CITY_INDEX);
  if (!matched.size) return;

  const rows = Array.from(matched, ([city_code, city_name]) => ({
    user_id: userId,
    city_code,
    city_name,
    first_visited_at: new Date().toISOString(),
  }));
  await supabase.from('visited_cities').upsert(rows, { onConflict: 'user_id,city_code', ignoreDuplicates: true });
}

function resetDriveState() {
  runningDistanceKm = 0;
  prevCoord = null;
  lastAcceptedSample = null;
  firstCoord = null;
  midCoord = null;
  coordCount = 0;
  buffer.length = 0;
  driveCoords.length = 0;
  lastMovingTimestamp = null;
  idleNotificationSent = false;
  lastLocationReceivedAt = null;
  maxSpeedMs = 0;
}

let restorePromise: Promise<void> | null = null;

async function restoreTrackingState(): Promise<void> {
  if (driveId) return;
  if (!restorePromise) {
    restorePromise = (async () => {
      const raw = await AsyncStorage.getItem(ACTIVE_DRIVE_STORAGE_KEY);
      if (!raw || driveId) return;
      try {
        const state = JSON.parse(raw) as Partial<PersistedDriveState>;
        if (typeof state.driveId !== 'string') return;
        driveId = state.driveId;
        runningDistanceKm = Number.isFinite(state.runningDistanceKm) ? state.runningDistanceKm! : 0;
        lastAcceptedSample = state.lastAcceptedSample ?? null;
        prevCoord = lastAcceptedSample
          ? { latitude: lastAcceptedSample.latitude, longitude: lastAcceptedSample.longitude }
          : null;
        firstCoord = state.firstCoord ?? prevCoord;
        midCoord = state.midCoord ?? null;
        coordCount = Number.isFinite(state.coordCount) ? state.coordCount! : 0;
        lastMovingTimestamp = state.lastMovingTimestamp ?? null;
        lastLocationReceivedAt = state.lastLocationReceivedAt ?? null;
        maxSpeedMs = Number.isFinite(state.maxSpeedMs) ? state.maxSpeedMs! : 0;
        if (Array.isArray(state.pendingPoints)) buffer.push(...state.pendingPoints);
        if (Array.isArray(state.driveCoords)) {
          driveCoords.push(...state.driveCoords.filter((coord): coord is Coordinate =>
            Number.isFinite(coord?.latitude) && Number.isFinite(coord?.longitude)));
        }
      } catch {
        // Ignore malformed state; it cannot safely identify an active drive.
      }
    })().finally(() => { restorePromise = null; });
  }
  await restorePromise;
}

async function persistTrackingState(): Promise<void> {
  if (!driveId) return;
  const state: PersistedDriveState = {
    driveId,
    runningDistanceKm,
    lastAcceptedSample,
    firstCoord,
    midCoord,
    coordCount,
    lastMovingTimestamp,
    lastLocationReceivedAt,
    maxSpeedMs,
    pendingPoints: buffer.slice(),
    driveCoords: driveCoords.slice(),
  };
  await AsyncStorage.setItem(ACTIVE_DRIVE_STORAGE_KEY, JSON.stringify(state));
}

export async function initializeLocationTracker(): Promise<void> {
  await restoreTrackingState();
}

export function isTracking(): boolean {
  return driveId !== null;
}

export async function startMonitoring(): Promise<void> {
  await restoreTrackingState();
  if (isTracking()) return;
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
  await restoreTrackingState();
  if (isTracking()) return;
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return;
  // GPS 신호 유실로 미종료 상태로 남은 주행을 정리. route_points에 남은 기록으로
  // 실제 거리/최고속도/종료시각을 복원한다 (예전엔 distance_km을 0으로 밀어버렸음).
  await supabase.rpc('close_orphaned_drives', { p_user_id: session.user.id });
}

// GPS 신호가 완전히 끊기면(지하주차장 등) LOCATION_TASK 콜백 자체가 안 돌아서
// 정차 알림/자동종료 로직이 실행될 기회가 없음. 앱이 포그라운드로 돌아올 때마다
// 마지막으로 위치를 받은 실제 시각(wall clock) 기준으로 따로 확인해 이 사각지대를 보완.
export async function checkStaleTrackingOnForeground(): Promise<void> {
  await restoreTrackingState();
  if (!isTracking() || lastLocationReceivedAt == null) return;
  const elapsed = Date.now() - lastLocationReceivedAt;
  if (elapsed >= AUTO_STOP_MS) {
    await stopTracking();
  }
}

export async function startTracking(): Promise<boolean> {
  await restoreTrackingState();
  if (isTracking()) return true;
  const { status: fgStatus } = await Location.requestForegroundPermissionsAsync();
  if (fgStatus !== 'granted') return false;

  let { status: bgStatus } = await Location.requestBackgroundPermissionsAsync();
  if (bgStatus !== 'granted') {
    // iOS: 방금 "항상 허용"을 선택해도 CLLocationManager의 권한 상태 반영에 약간의 지연이
    // 있어 바로 재조회하면 이전 상태가 나올 수 있음 — 잠깐 대기 후 한 번 더 확인
    await new Promise((r) => setTimeout(r, 500));
    ({ status: bgStatus } = await Location.getBackgroundPermissionsAsync());
  }
  if (bgStatus !== 'granted') return false;

  // profile 존재 보장은 app/_layout.tsx의 handleAuthSession에서 로그인 시 이미 처리됨
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return false;
  const user = session.user;

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
  lastLocationReceivedAt = Date.now();
  await persistTrackingState();

  // MONITOR_TASK 중지 (주행 중엔 감지 불필요)
  const monitorRunning = await Location.hasStartedLocationUpdatesAsync(MONITOR_TASK);
  if (monitorRunning) await Location.stopLocationUpdatesAsync(MONITOR_TASK);

  const alreadyRunning = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
  if (alreadyRunning) await Location.stopLocationUpdatesAsync(LOCATION_TASK);

  await startDriveLocationUpdates();

  return true;
}

async function startDriveLocationUpdates(): Promise<void> {
  if (Platform.OS === 'android') {
    try {
      await Location.enableNetworkProviderAsync();
    } catch {
      // High-accuracy mode may already be enabled or the user may decline the settings dialog.
    }
  }
  await Location.startLocationUpdatesAsync(LOCATION_TASK, {
    accuracy: Location.Accuracy.BestForNavigation,
    distanceInterval: 5,
    timeInterval: 2000,
    showsBackgroundLocationIndicator: true,
    activityType: Location.ActivityType.AutomotiveNavigation,
    pausesUpdatesAutomatically: false,
    foregroundService: {
      notificationTitle: 'Driend 주행 중',
      notificationBody: '주행 경로를 기록하고 있습니다.',
      notificationColor: '#047857',
    },
  });
}

async function performStopTracking(stoppingDriveId: string | null): Promise<string | null> {
  if (!stoppingDriveId) return null;

  const distanceKm = runningDistanceKm;
  const sampleCoords = driveCoords.slice();
  const startCoord = firstCoord;
  const endCoord = prevCoord;
  const stoppingMaxSpeedMs = maxSpeedMs;

  const isRunning = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
  if (isRunning) await Location.stopLocationUpdatesAsync(LOCATION_TASK);

  Notifications.dismissAllNotificationsAsync();
  try {
    await flushBuffer(stoppingDriveId);
    await persistTrackingState();
  } catch (error) {
    if (driveId === stoppingDriveId) await startDriveLocationUpdates();
    throw error;
  }

  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user ?? null;

  let startAddress: string | null = null;
  let endAddress: string | null = null;
  try {
    if (startCoord) {
      const [g] = await Location.reverseGeocodeAsync(startCoord);
      startAddress = g.city ?? g.district ?? REGION_TO_KO[g.region ?? ''] ?? g.region ?? null;
    }
    if (endCoord) {
      const [g] = await Location.reverseGeocodeAsync(endCoord);
      endAddress = g.city ?? g.district ?? REGION_TO_KO[g.region ?? ''] ?? g.region ?? null;
    }
  } catch {}

  const { error: updateError } = await supabase
    .from('drives')
    .update({
      ended_at: new Date().toISOString(),
      distance_km: distanceKm,
      max_speed_kmh: stoppingMaxSpeedMs * 3.6,
      start_address: startAddress,
      end_address: endAddress,
    })
    .eq('id', stoppingDriveId);
  if (updateError) {
    if (driveId === stoppingDriveId) await startDriveLocationUpdates();
    throw updateError;
  }

  if (user && sampleCoords.length > 0) {
    recordVisitedCities(user.id, sampleCoords);
  }

  if (driveId === stoppingDriveId) {
    await AsyncStorage.removeItem(ACTIVE_DRIVE_STORAGE_KEY);
    driveId = null;
    resetDriveState();
    stopListeners.forEach((cb) => cb(stoppingDriveId));
    await startMonitoring();
  }

  processMatchAsync(stoppingDriveId).catch(() => {});

  return stoppingDriveId;
}

const stopCoordinator = createStopCoordinator(performStopTracking);

export function stopTracking(): Promise<string | null> {
  return stopCoordinator.stop(driveId);
}

async function flushBuffer(expectedDriveId: string | null = driveId): Promise<void> {
  if (flushPromise) return flushPromise;

  flushPromise = (async () => {
    while (buffer.length && expectedDriveId && driveId === expectedDriveId) {
      const points = buffer.splice(0);
      const rows = points.map((p) => ({
        drive_id: expectedDriveId,
        location: `POINT(${p.longitude} ${p.latitude})`,
        speed_kmh: toPersistedSpeedKmh(p.speedKmh),
        recorded_at: p.recordedAt,
      }));
      const { error } = await supabase.from('route_points').insert(rows);
      if (error) {
        buffer.unshift(...points);
        throw error;
      }
    }
  })();
  try {
    await flushPromise;
  } finally {
    flushPromise = null;
  }
}
