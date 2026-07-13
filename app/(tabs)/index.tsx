import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, StyleSheet, TouchableOpacity, Text, Alert,
  ActivityIndicator, Modal,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import * as Location from 'expo-location';
import { Accelerometer } from 'expo-sensors';
import {
  NaverMapView,
  NaverMapPathOverlay,
  NaverMapPolygonOverlay,
  NaverMapGroundOverlay,
  type NaverMapViewRef,
} from '@mj-studio/react-native-naver-map';
import { supabase } from '../../src/services/supabase';
import {
  startTracking, stopTracking, isTracking,
  addPointListener, addStopListener,
} from '../../src/services/locationTracker';
import { buildCityIndex, matchVisitedCities } from '../../src/services/geo';
import { colors } from '../../src/theme';
import CITY_DATA from '../../assets/korea-cities.json';

type MapMode = 'drive' | 'photo';
type RouteLine = { drive_id: string; coordinates: [number, number][] };
type LatLng = { latitude: number; longitude: number };
type VisitedCity = { city_code: string; city_name: string; photo_url: string | null };
type City = { code: string; name: string; province_code: string; center: LatLng; polygons: LatLng[][] };

const CITIES = CITY_DATA as City[];
const CITY_INDEX = buildCityIndex(CITIES);

type Region = { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number };
const CITY_REGION_MAP = new Map<string, Region>(
  CITY_INDEX.map(({ city, bbox }) => [
    city.code,
    { latitude: bbox.minLat, longitude: bbox.minLng, latitudeDelta: bbox.maxLat - bbox.minLat, longitudeDelta: bbox.maxLng - bbox.minLng },
  ])
);

const PROVINCE_COLORS = [
  '#F87171', '#FB923C', '#FBBF24', '#A3E635', '#34D399', '#2DD4BF',
  '#22D3EE', '#38BDF8', '#60A5FA', '#818CF8', '#A78BFA', '#C084FC',
  '#E879F9', '#F472B6', '#FB7185', '#FDE68A', '#86EFAC',
];
const PROVINCE_CODES = Array.from(new Set(CITIES.map((c) => c.province_code))).sort();
const PROVINCE_COLOR_MAP = new Map(
  PROVINCE_CODES.map((code, i) => [code, PROVINCE_COLORS[i % PROVINCE_COLORS.length]])
);
const PHOTO_MAP_BG = '#122238';

export default function MapScreen() {
  const mapRef = useRef<NaverMapViewRef>(null);
  const isFirstPoint = useRef(true);
  const hasCenteredOnUser = useRef(false);
  const cityBackfillDone = useRef(false);
  const [tracking, setTracking] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [routeCoords, setRouteCoords] = useState<LatLng[]>([]);
  const [pastLines, setPastLines] = useState<RouteLine[]>([]);
  const [currentPosition, setCurrentPosition] = useState<LatLng | null>(null);

  const [mapMode, setMapMode] = useState<MapMode>('drive');
  const [visitedCities, setVisitedCities] = useState<VisitedCity[]>([]);

  // 제로백 측정
  type ZHState = 'ready' | 'measuring' | 'done';
  const [zhVisible, setZhVisible] = useState(false);
  const [zhState, setZhState] = useState<ZHState>('ready');
  const [zhSpeed, setZhSpeed] = useState(0);
  const [zhResult, setZhResult] = useState<number | null>(null);
  const [zhTimer, setZhTimer] = useState(0);
  const [zhGpsInterval, setZhGpsInterval] = useState<number | null>(null);
  const zhStateRef = useRef<ZHState>('ready');
  const zhStartRef = useRef<number | null>(null);
  const zhSubRef = useRef<Location.LocationSubscription | null>(null);
  const accelSubRef = useRef<{ remove: () => void } | null>(null);
  const zhTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadPastRoutes = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return;
    const { data } = await supabase.rpc('get_user_route_lines', { p_user_id: session.user.id });
    if (data) setPastLines(data);
  }, []);

  const loadVisitedCities = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return;
    const { data } = await supabase
      .from('visited_cities')
      .select('city_code, city_name, photo_url')
      .eq('user_id', session.user.id);
    if (data) setVisitedCities(data);
  }, []);

  useFocusEffect(useCallback(() => {
    loadPastRoutes();
    loadVisitedCities();
  }, [loadPastRoutes, loadVisitedCities]));

  useEffect(() => {
    if (isTracking()) {
      setTracking(true);
      isFirstPoint.current = false;
    }

    const removePoint = addPointListener((coord) => {
      const latLng = { latitude: coord.latitude, longitude: coord.longitude };
      setRouteCoords((prev) => [...prev, latLng]);
      setCurrentPosition(latLng);
      if (isFirstPoint.current) {
        isFirstPoint.current = false;
        mapRef.current?.animateCameraTo({ latitude: coord.latitude, longitude: coord.longitude, zoom: 15, duration: 600 });
      } else if (isTracking()) {
        // 주행 중에는 지도가 내 위치를 계속 따라가도록 (줌 레벨은 유지)
        mapRef.current?.animateCameraTo({ latitude: coord.latitude, longitude: coord.longitude, duration: 500 });
      }
    });

    const removeStop = addStopListener(() => {
      setTracking(false);
      setRouteCoords([]);
      loadPastRoutes();
      loadVisitedCities();
    });

    let locationSub: Location.LocationSubscription | null = null;
    Location.requestForegroundPermissionsAsync().then(({ status }) => {
      if (status !== 'granted') return;
      Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, distanceInterval: 15, timeInterval: 5000 },
        (loc) => {
          const pos = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
          setCurrentPosition(pos);
          if (!hasCenteredOnUser.current) {
            hasCenteredOnUser.current = true;
            mapRef.current?.animateCameraTo({ ...pos, zoom: 15, duration: 800 });
          }
        }
      ).then((sub) => { locationSub = sub; });
    });

    return () => { removePoint(); removeStop(); locationSub?.remove(); };
  }, [loadPastRoutes, loadVisitedCities]);

  const heatSegments = useMemo(() => {
    if (!pastLines.length) return [];

    // 격자(~100m)별 드라이브 통과 횟수 계산
    const freqMap = new Map<string, number>();
    for (const line of pastLines) {
      if (!line.coordinates?.length) continue;
      const visited = new Set<string>();
      for (const [lng, lat] of line.coordinates) {
        visited.add(`${Math.round(lat * 1000)},${Math.round(lng * 1000)}`);
      }
      visited.forEach((k) => freqMap.set(k, (freqMap.get(k) ?? 0) + 1));
    }

    const getFreq = (lng: number, lat: number) =>
      freqMap.get(`${Math.round(lat * 1000)},${Math.round(lng * 1000)}`) ?? 1;

    // 단일 그린 계열 그라데이션(연한 세이지 → 짙은 포레스트)으로 통일 — 채도 다른 색 섞이는 것보다 차분한 인상
    const freqStyle = (freq: number): { color: string; width: number } => {
      if (freq >= 7) return { color: '#0B4A34', width: 6 };  // 짙은 포레스트 (7회+)
      if (freq >= 4) return { color: '#1F6E4F', width: 5 };  // 진한 에메랄드 (4-6회)
      if (freq >= 2) return { color: '#5B9279', width: 4 };  // 세이지 그린 (2-3회)
      return { color: '#A8C3B4', width: 3 };                 // 연한 세이지 (1회)
    };

    const segments: Array<{ coords: LatLng[]; color: string; width: number }> = [];

    for (const line of pastLines) {
      if (!line.coordinates || line.coordinates.length < 2) continue;
      let segCoords: LatLng[] = [{ latitude: line.coordinates[0][1], longitude: line.coordinates[0][0] }];
      let segFreq = getFreq(line.coordinates[0][0], line.coordinates[0][1]);

      for (let i = 1; i < line.coordinates.length; i++) {
        const [lng, lat] = line.coordinates[i];
        const freq = getFreq(lng, lat);
        const pt = { latitude: lat, longitude: lng };
        if (freq !== segFreq) {
          segCoords.push(pt);
          if (segCoords.length >= 2) segments.push({ coords: segCoords, ...freqStyle(segFreq) });
          segCoords = [segCoords[segCoords.length - 1]];
          segFreq = freq;
        }
        segCoords.push(pt);
      }
      if (segCoords.length >= 2) segments.push({ coords: segCoords, ...freqStyle(segFreq) });
    }

    // 저빈도 → 고빈도 순 정렬 (고빈도가 위에 그려짐)
    segments.sort((a, b) => a.width - b.width);
    return segments;
  }, [pastLines]);

  const citiesWithMeta = useMemo(() => {
    const cityMap = new Map(visitedCities.map((c) => [c.city_code, c]));
    return CITIES.map((c) => ({
      ...c,
      color: PROVINCE_COLOR_MAP.get(c.province_code) ?? '#94A3B8',
      visited: cityMap.has(c.code),
      photoUrl: cityMap.get(c.code)?.photo_url ?? null,
    }));
  }, [visitedCities]);

  // 사진 모드 진입 시 한반도 전체가 보이도록 줌아웃
  useEffect(() => {
    if (mapMode === 'photo') {
      mapRef.current?.animateCameraTo({ latitude: 36.4, longitude: 127.8, zoom: 6.3, duration: 500 });
    }
  }, [mapMode]);

  // 방문 기록을 현재 시/군/구 데이터셋 기준으로 재계산 (세션당 1회, 데이터셋이 바뀌어도 항상 재확인)
  useEffect(() => {
    if (mapMode !== 'photo') return;
    if (!pastLines.length) return;
    if (cityBackfillDone.current) return;
    cityBackfillDone.current = true;

    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return;
      const allCoords = pastLines.flatMap((l) =>
        (l.coordinates ?? []).map(([lng, lat]) => ({ latitude: lat, longitude: lng }))
      );
      const matched = matchVisitedCities(allCoords, CITY_INDEX);
      if (!matched.size) return;
      const rows = Array.from(matched, ([city_code, city_name]) => ({
        user_id: session.user.id, city_code, city_name, first_visited_at: new Date().toISOString(),
      }));
      await supabase.from('visited_cities').upsert(rows, { onConflict: 'user_id,city_code', ignoreDuplicates: true });
      loadVisitedCities();
    })();
  }, [mapMode, pastLines, loadVisitedCities]);

  const openZeroHundred = async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return;
    zhStateRef.current = 'ready';
    zhStartRef.current = null;
    if (zhTimerRef.current) { clearInterval(zhTimerRef.current); zhTimerRef.current = null; }
    setZhState('ready');
    setZhSpeed(0);
    setZhTimer(0);
    setZhGpsInterval(null);
    setZhResult(null);
    setZhVisible(true);

    // 가속도계 baseline (EMA)
    let base: { x: number; y: number; z: number } | null = null;
    let accelHits = 0;

    // 50Hz 가속도계로 출발 순간 정밀 감지
    Accelerometer.setUpdateInterval(20);
    accelSubRef.current = Accelerometer.addListener(({ x, y, z }) => {
      if (zhStateRef.current !== 'ready') return;
      if (!base) { base = { x, y, z }; return; }

      const deviation = Math.sqrt((x - base.x) ** 2 + (y - base.y) ** 2 + (z - base.z) ** 2);
      if (deviation < 0.25) {
        base.x = base.x * 0.9 + x * 0.1;
        base.y = base.y * 0.9 + y * 0.1;
        base.z = base.z * 0.9 + z * 0.1;
        accelHits = 0;
      } else {
        accelHits++;
        if (accelHits >= 2) {
          // 2회 연속 임계값 초과 → 출발 감지, T=0 기록
          zhStartRef.current = Date.now();
          zhStateRef.current = 'measuring';
          setZhState('measuring');
          accelSubRef.current?.remove();
          accelSubRef.current = null;
          // 실시간 타이머 시작 (50ms 간격)
          zhTimerRef.current = setInterval(() => {
            if (zhStartRef.current) setZhTimer(Date.now() - zhStartRef.current);
          }, 50);
        }
      }
    });

    // GPS: 속도 표시 + 100km/h 도달 감지
    let prevKmh = 0;
    let prevTs = 0;
    let lastGpsCbTs = 0;
    const gpsHistory: { ts: number; kmh: number }[] = [];

    zhSubRef.current = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.BestForNavigation, distanceInterval: 0, timeInterval: 0 },
      (loc) => {
        const cbNow = Date.now();
        if (lastGpsCbTs > 0) setZhGpsInterval(cbNow - lastGpsCbTs);
        lastGpsCbTs = cbNow;

        const kmh = Math.max(0, (loc.coords.speed ?? 0) * 3.6);
        const ts = loc.timestamp;

        setZhSpeed(Math.round(kmh));

        // 측정 중 GPS 샘플 기록 (이전 가속 비율 계산용)
        if (zhStateRef.current === 'measuring' && kmh > 0) {
          gpsHistory.push({ ts, kmh });
        }

        if (zhStateRef.current === 'measuring' && kmh >= 100 && zhStartRef.current) {
          if (zhTimerRef.current) { clearInterval(zhTimerRef.current); zhTimerRef.current = null; }

          // 이전 구간 평균 가속 비율로 100km/h 교차 시점 추정
          let endTs = ts;
          if (prevKmh < 100 && prevTs > 0) {
            const prevSamples = gpsHistory.slice(0, -1);
            const deltas: number[] = [];
            for (let i = 1; i < prevSamples.length; i++) {
              const dKmh = prevSamples[i].kmh - prevSamples[i - 1].kmh;
              const dTs = prevSamples[i].ts - prevSamples[i - 1].ts;
              if (dTs > 0 && dKmh > 0 && prevSamples[i - 1].kmh > 5) {
                deltas.push(dKmh / dTs); // km/h per ms
              }
            }
            const avgRate = deltas.length >= 2
              ? deltas.reduce((a, b) => a + b, 0) / deltas.length
              : (kmh - prevKmh) / (ts - prevTs); // fallback: linear
            endTs = prevTs + (100 - prevKmh) / avgRate;
          }

          const elapsed = Math.round((endTs - zhStartRef.current) / 100) / 10;
          setZhResult(elapsed);
          setZhState('done');
          zhStateRef.current = 'done';
          zhSubRef.current?.remove();
          zhSubRef.current = null;
          if (elapsed > 0 && elapsed < 60 && isFinite(elapsed)) {
            supabase.auth.getSession().then(async ({ data: { session } }) => {
              if (!session?.user) return;
              const { error } = await supabase.rpc('save_best_zero_to_hundred', { p_user_id: session.user.id, p_seconds: elapsed });
              if (error) console.error('save_best_zero_to_hundred failed:', error);
            });
          }
        }

        prevKmh = kmh;
        prevTs = ts;
      }
    );
  };

  const closeZeroHundred = () => {
    if (zhTimerRef.current) { clearInterval(zhTimerRef.current); zhTimerRef.current = null; }
    accelSubRef.current?.remove();
    accelSubRef.current = null;
    zhSubRef.current?.remove();
    zhSubRef.current = null;
    setZhVisible(false);
  };

  const toggleTracking = async () => {
    if (toggling) return;
    setToggling(true);
    try {
      if (tracking) {
        await stopTracking();
      } else {
        isFirstPoint.current = true;
        let ok = false;
        try { ok = await startTracking(); } catch (e: any) {
          Alert.alert('오류', e.message ?? String(e)); return;
        }
        if (!ok) {
          Alert.alert('위치 권한 필요', '설정 > 개인정보 보호 > 위치 서비스에서 Driend를 "항상"으로 설정해주세요.');
          return;
        }
        setTracking(true);
      }
    } finally {
      setToggling(false);
    }
  };

  return (
    <View style={s.container}>
      <NaverMapView
        ref={mapRef}
        style={[s.map, mapMode === 'photo' && s.mapPhotoMode]}
        initialCamera={{ latitude: 36.5, longitude: 127.5, zoom: 6 }}
        mapType={mapMode === 'photo' ? 'None' : 'Basic'}
        isShowLocationButton={mapMode === 'drive'}
        isShowCompass={mapMode === 'drive'}
        isExtentBoundedInKorea
        locationOverlay={mapMode === 'drive' && currentPosition ? {
          isVisible: true,
          position: currentPosition,
          circleRadius: 60,
          circleColor: 'rgba(0, 120, 255, 0.08)',
          circleOutlineWidth: 1,
          circleOutlineColor: 'rgba(0, 120, 255, 0.25)',
        } : { isVisible: false }}
      >
        {mapMode === 'drive' && (
          <>
            {heatSegments.map((seg, i) => (
              <NaverMapPathOverlay
                key={`heat-${i}`}
                coords={seg.coords}
                color={seg.color}
                outlineColor="transparent"
                width={seg.width}
              />
            ))}
            {routeCoords.length >= 2 && (
              <NaverMapPathOverlay
                coords={routeCoords}
                color="#00D084"
                outlineColor="transparent"
                width={5}
              />
            )}
          </>
        )}

        {mapMode === 'photo' && citiesWithMeta.map((c) => (
          <>
            {c.polygons.map((coords, i) => (
              <NaverMapPolygonOverlay
                key={`poly-${c.code}-${i}`}
                coords={coords}
                color={c.visited ? `${c.color}F2` : `${c.color}B3`}
                outlineWidth={c.visited ? 1.75 : 1}
                outlineColor={c.visited ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.5)'}
              />
            ))}
            {c.photoUrl && (
              <NaverMapGroundOverlay
                key={`photo-${c.code}`}
                globalZIndex={1}
                image={{ httpUri: c.photoUrl }}
                region={CITY_REGION_MAP.get(c.code)!}
              />
            )}
          </>
        ))}
      </NaverMapView>

      {/* 모드 토글 */}
      <View style={s.modeToggle}>
        <TouchableOpacity
          style={[s.modeBtn, mapMode === 'drive' && s.modeBtnActive]}
          onPress={() => setMapMode('drive')}
        >
          <Text style={[s.modeBtnText, mapMode === 'drive' && s.modeBtnTextActive]}>도로</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.modeBtn, mapMode === 'photo' && s.modeBtnActive]}
          onPress={() => setMapMode('photo')}
        >
          <Text style={[s.modeBtnText, mapMode === 'photo' && s.modeBtnTextActive]}>사진</Text>
        </TouchableOpacity>
      </View>

      {mapMode === 'drive' && (
        <>
          <TouchableOpacity
            style={[s.trackBtn, tracking && s.trackBtnActive, toggling && s.trackBtnDisabled]}
            onPress={toggleTracking}
            disabled={toggling}
          >
            {toggling
              ? <ActivityIndicator size="small" color="#fff" />
              : <Text style={s.trackText}>{tracking ? '⏹ 기록 중지' : '▶ 주행 시작'}</Text>
            }
          </TouchableOpacity>

          <TouchableOpacity style={s.zhBtn} onPress={openZeroHundred}>
            <Text style={s.zhBtnText}>0→100</Text>
          </TouchableOpacity>

          {tracking && (
            <View style={s.recordingBadge}>
              <Text style={s.recordingText}>● 기록 중</Text>
            </View>
          )}
        </>
      )}

      {/* 제로백 측정 모달 */}
      <Modal visible={zhVisible} animationType="fade" transparent onRequestClose={closeZeroHundred}>
        <View style={s.zhOverlay}>
          <View style={[s.zhCard, zhState === 'measuring' && s.zhCardMeasuring]}>
            <Text style={[s.zhStateLabel, zhState === 'measuring' && { color: '#ef4444' }]}>
              {zhState === 'ready' ? '정지 후 출발하세요' : zhState === 'measuring' ? '측정 중' : '측정 완료'}
            </Text>

            {zhState === 'done' ? (
              <>
                <Text style={s.zhResultNum}>{zhResult?.toFixed(1)}</Text>
                <Text style={s.zhResultUnit}>초</Text>
                <TouchableOpacity style={s.zhRetryBtn} onPress={openZeroHundred}>
                  <Text style={s.zhRetryText}>다시 측정</Text>
                </TouchableOpacity>
              </>
            ) : zhState === 'measuring' ? (
              <>
                <Text style={s.zhTimerNum}>{(zhTimer / 1000).toFixed(1)}</Text>
                <Text style={s.zhTimerUnit}>초</Text>
                <Text style={s.zhTimerSpeed}>{zhSpeed} km/h</Text>
              </>
            ) : (
              <Text style={s.zhSpeedNum}>{zhSpeed}<Text style={s.zhSpeedUnit}> km/h</Text></Text>
            )}

            {zhGpsInterval && (
              <Text style={s.zhDebug}>GPS {zhGpsInterval}ms · {(1000 / zhGpsInterval).toFixed(1)}Hz</Text>
            )}

            <TouchableOpacity style={s.zhCloseBtn} onPress={closeZeroHundred}>
              <Text style={s.zhCloseText}>닫기</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },
  mapPhotoMode: { backgroundColor: PHOTO_MAP_BG },

  modeToggle: {
    position: 'absolute',
    top: 56,
    alignSelf: 'center',
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderRadius: 20,
    padding: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },
  modeBtn: {
    paddingHorizontal: 20,
    paddingVertical: 7,
    borderRadius: 17,
  },
  modeBtnActive: { backgroundColor: colors.primary },
  modeBtnText: { fontSize: 14, fontWeight: '600', color: colors.textSecondary },
  modeBtnTextActive: { color: '#fff' },

  trackBtn: {
    position: 'absolute',
    bottom: 48,
    alignSelf: 'center',
    backgroundColor: colors.primary,
    paddingHorizontal: 40,
    paddingVertical: 14,
    borderRadius: 30,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 5,
    minWidth: 160,
    alignItems: 'center',
  },
  trackBtnActive: { backgroundColor: colors.danger },
  trackBtnDisabled: { opacity: 0.7 },
  trackText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  recordingBadge: {
    position: 'absolute',
    top: 104,
    alignSelf: 'center',
    backgroundColor: 'rgba(240,68,82,0.9)',
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 20,
  },
  recordingText: { color: '#fff', fontWeight: '600', fontSize: 14 },

  zhBtn: {
    position: 'absolute',
    bottom: 48,
    right: 20,
    backgroundColor: '#1a1a2e',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 5,
  },
  zhBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },

  zhOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.85)',
    alignItems: 'center', justifyContent: 'center',
  },
  zhCard: {
    width: 280, backgroundColor: '#1a1a2e', borderRadius: 24,
    padding: 32, alignItems: 'center', gap: 8,
  },
  zhStateLabel: { fontSize: 15, color: 'rgba(255,255,255,0.6)', marginBottom: 8 },
  zhSpeedNum: { fontSize: 72, fontWeight: '800', color: '#fff', lineHeight: 80 },
  zhSpeedUnit: { fontSize: 20, fontWeight: '400', color: 'rgba(255,255,255,0.5)' },
  zhCardMeasuring: { backgroundColor: '#2d0808', borderWidth: 2, borderColor: '#ef4444' },
  zhTimerNum: { fontSize: 80, fontWeight: '900', color: '#ef4444', lineHeight: 88 },
  zhTimerUnit: { fontSize: 24, color: 'rgba(255,255,255,0.5)', marginTop: -8 },
  zhTimerSpeed: { fontSize: 16, color: 'rgba(255,255,255,0.35)', marginTop: 8 },
  zhResultNum: { fontSize: 80, fontWeight: '900', color: '#4ade80', lineHeight: 88 },
  zhResultUnit: { fontSize: 24, color: 'rgba(255,255,255,0.6)', marginTop: -8 },
  zhRetryBtn: {
    marginTop: 16, backgroundColor: colors.primary,
    paddingHorizontal: 28, paddingVertical: 12, borderRadius: 20,
  },
  zhRetryText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  zhDebug: { fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 4 },
  zhCloseBtn: { marginTop: 12 },
  zhCloseText: { color: 'rgba(255,255,255,0.4)', fontSize: 14 },
});
