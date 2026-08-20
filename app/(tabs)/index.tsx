import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, StyleSheet, TouchableOpacity, Text, Alert,
  ActivityIndicator, Modal,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router, useFocusEffect } from 'expo-router';
import * as Location from 'expo-location';
import { Accelerometer } from 'expo-sensors';
import Svg, { Path } from 'react-native-svg';
import {
  NaverMapView,
  NaverMapPathOverlay,
  NaverMapPolygonOverlay,
  NaverMapPolylineOverlay,
  NaverMapGroundOverlay,
  type NaverMapViewRef,
  type CameraChangeReason,
} from '@mj-studio/react-native-naver-map';
import { supabase } from '../../src/services/supabase';
import {
  startTracking, stopTracking, isTracking,
  addPointListener, addStopListener,
} from '../../src/services/locationTracker';
import { consumePendingWidgetStartDrive, consumePendingWidgetStopDrive } from '../../src/services/widgetBridge';
import { buildCityIndex, bboxIntersects, matchCity, matchVisitedCities, padBBox, type BBox } from '../../src/services/geo';
import { addCityPhotos } from '../../src/services/cityPhotos';
import { calculateZeroToHundredSeconds, type SpeedSample } from '../../src/services/zeroToHundred';
import {
  fetchDriveResult, formatDriveDuration, getAverageSpeedKmh, getDurationSeconds,
  type DriveResult,
} from '../../src/services/driveResult';
import CityPhotoGallery from '../../src/components/CityPhotoGallery';
import { colors } from '../../src/theme';
import { splitRouteSegments } from '../../src/services/routeTrackingUtils';
import CITY_DATA from '../../assets/korea-cities.json';
import CITY_DATA_SIMPLIFIED from '../../assets/korea-cities-simplified.json';

type MapMode = 'drive' | 'photo';
type RouteCoordinate = [longitude: number, latitude: number, recordedAt?: string];
type RouteLine = { drive_id: string; coordinates: RouteCoordinate[] };
type LatLng = { latitude: number; longitude: number; recordedAt?: string };
type VisitedCity = { id: string; city_code: string; city_name: string; photo_url: string | null };
type City = { code: string; name: string; province_code: string; center: LatLng; polygons: LatLng[][] };

const CITIES = CITY_DATA as City[];
const CITIES_SIMPLIFIED = CITY_DATA_SIMPLIFIED as City[];
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
const ONBOARDING_SEEN_KEY = 'map_onboarding_seen';
const WIDGET_ONBOARDING_SEEN_KEY = 'widget_onboarding_seen';
const CITY_BBOX_MAP = new Map(CITY_INDEX.map(({ city, bbox }) => [city.code, bbox]));

// 사진 모드 축소/확대에 따른 배경 렌더링 정밀도 전환 임계값 (경계값 근처 떨림 방지용 히스테리시스).
// 두 단계 모두 시군구 단위 경계는 유지하되(도로 뭉개지 않음), 축소 상태에서는 자잘한 섬을
// 제외하고 정점을 더 단순화한 데이터셋(korea-cities-simplified.json)을 사용. 뷰포트에 걸친
// 지역만 그리므로(아래 photoVisibleCities) 임계값을 낮게 잡아도 230개를 한꺼번에 그리는
// 상황(원래 프레임드랍 원인)은 재발하지 않음.
const PHOTO_LOD_ENTER_HIGH_ZOOM = 7.2; // 이 이상 확대 시 원본 정밀도로 전환
const PHOTO_LOD_ENTER_LOW_ZOOM = 6.6;  // 이 이하 축소 시 단순화된 데이터셋으로 전환
const PHOTO_VIEWPORT_PAD_RATIO = 0.3;  // 화면 경계에서 지역이 갑자기 나타나지 않도록 여유분

// 주행 경로선 굵기가 줌 레벨과 무관하게 고정이라 확대해도 선이 얇아 보이던 문제 보정.
// 기준 줌(현재 굵기 값들이 설계된 지점) 대비 줌 1당 굵기를 비례 확대/축소함
const ROUTE_WIDTH_BASE_ZOOM = 14;
const ROUTE_WIDTH_SCALE_PER_ZOOM = 0.28;
const ROUTE_WIDTH_MIN_SCALE = 0.9;

const ROUTE_WIDTH_MAX_SCALE = 2.6;

// 고속 주행 시 GPS 포인트가 초당 여러 번 들어올 수 있어(5m/2s 샘플링), 매 포인트마다
// 전체 배열을 복사해 네이티브 폴리라인을 다시 그리면 긴 주행일수록 무거워짐.
// 화면 반영은 이 간격으로 묶어서 보냄 (거리/타이머 등 다른 상태는 즉시 반영)
const ROUTE_COORDS_FLUSH_MS = 700;

function routeWidthScale(zoom: number): number {
  const scale = 1 + (zoom - ROUTE_WIDTH_BASE_ZOOM) * ROUTE_WIDTH_SCALE_PER_ZOOM;
  return Math.min(ROUTE_WIDTH_MAX_SCALE, Math.max(ROUTE_WIDTH_MIN_SCALE, scale));
}

function formatElapsed(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// 지도 밖 빈 여백으로 스크롤되는 것을 막기 위한 카메라 이동 제한 범위.
// 본토+제주+독도까지 포함 (라이브러리 기본 isExtentBoundedInKorea는 중국·러시아 국경
// 근처까지 포함할 만큼 넉넉해서 그 여백으로 스크롤하면 빈 영역이 보였음)
const KOREA_EXTENT = {
  latitude: 32.8,
  longitude: 124.5,
  latitudeDelta: 38.9 - 32.8,
  longitudeDelta: 131.95 - 124.5,
};

export default function MapScreen() {
  const mapRef = useRef<NaverMapViewRef>(null);
  const isFirstPoint = useRef(true);
  const hasCenteredOnUser = useRef(false);
  const cityBackfillDone = useRef(false);
  const routeCoordsBufferRef = useRef<LatLng[]>([]);
  const lastRouteFlushRef = useRef(0);
  const [tracking, setTracking] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [routeCoords, setRouteCoords] = useState<LatLng[]>([]);
  const [pastLines, setPastLines] = useState<RouteLine[]>([]);
  const [currentPosition, setCurrentPosition] = useState<LatLng | null>(null);
  const [totalDistanceKm, setTotalDistanceKm] = useState(0);

  const [mapMode, setMapMode] = useState<MapMode>('drive');
  const [visitedCities, setVisitedCities] = useState<VisitedCity[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [galleryTarget, setGalleryTarget] = useState<{ visitedId: string; cityCode: string; cityName: string; autoAdd?: boolean; startInEdit?: boolean } | null>(null);
  const [onboardingStep, setOnboardingStep] = useState<0 | 1 | 2>(0);
  const [widgetTip, setWidgetTip] = useState(false);
  const [photoLowDetail, setPhotoLowDetail] = useState(true);
  const photoLowDetailRef = useRef(true);
  const [photoVisibleRegion, setPhotoVisibleRegion] = useState<BBox | null>(null);
  const [driveZoom, setDriveZoom] = useState(ROUTE_WIDTH_BASE_ZOOM);
  const [followingMe, setFollowingMe] = useState(false);
  const [driveDistanceKm, setDriveDistanceKm] = useState(0);
  const [driveElapsedSec, setDriveElapsedSec] = useState(0);
  const [completedDriveId, setCompletedDriveId] = useState<string | null>(null);
  const [completedDrive, setCompletedDrive] = useState<DriveResult | null>(null);
  const driveStartRef = useRef<number | null>(null);
  const driveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 제로백 측정
  type ZHState = 'ready' | 'measuring' | 'done';
  const [zhVisible, setZhVisible] = useState(false);
  const [zhState, setZhState] = useState<ZHState>('ready');
  const [zhSpeed, setZhSpeed] = useState(0);
  const [zhResult, setZhResult] = useState<number | null>(null);
  const [zhTimer, setZhTimer] = useState(0);
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

  const loadTotalDistance = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return;
    const { data } = await supabase.rpc('get_my_stats', { p_user_id: session.user.id }).single();
    if (data) setTotalDistanceKm((data as { total_distance_km: number }).total_distance_km ?? 0);
  }, []);

  const loadVisitedCities = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return;
    setUserId(session.user.id);
    const { data } = await supabase
      .from('visited_cities')
      .select('id, city_code, city_name, photo_url')
      .eq('user_id', session.user.id);
    if (data) setVisitedCities(data);
  }, []);

  useFocusEffect(useCallback(() => {
    loadPastRoutes();
    loadVisitedCities();
    loadTotalDistance();
  }, [loadPastRoutes, loadVisitedCities, loadTotalDistance]));

  useEffect(() => {
    AsyncStorage.getItem(ONBOARDING_SEEN_KEY).then((seen) => {
      if (seen !== 'true') setOnboardingStep(1);
    });
    AsyncStorage.getItem(WIDGET_ONBOARDING_SEEN_KEY).then((seen) => {
      if (seen !== 'true') setWidgetTip(true);
    });
  }, []);

  const dismissWidgetTip = () => {
    setWidgetTip(false);
    AsyncStorage.setItem(WIDGET_ONBOARDING_SEEN_KEY, 'true');
  };

  const advanceOnboarding = () => {
    setMapMode('photo');
    setOnboardingStep(2);
  };

  const finishOnboarding = () => {
    setMapMode('drive');
    setOnboardingStep(0);
    AsyncStorage.setItem(ONBOARDING_SEEN_KEY, 'true');
  };

  useEffect(() => {
    if (isTracking()) {
      setTracking(true);
      isFirstPoint.current = false;
    }

    const removePoint = addPointListener((coord, distanceKm, recordedAt) => {
      const latLng = { latitude: coord.latitude, longitude: coord.longitude, recordedAt };
      routeCoordsBufferRef.current.push(latLng);
      setCurrentPosition(latLng);
      setDriveDistanceKm(distanceKm);

      // 화면(및 네이티브 폴리라인) 반영은 묶어서 — 첫 포인트만 예외로 즉시 반영해 지연 없이 선이 시작되게 함
      const now = Date.now();
      if (isFirstPoint.current || now - lastRouteFlushRef.current >= ROUTE_COORDS_FLUSH_MS) {
        lastRouteFlushRef.current = now;
        setRouteCoords([...routeCoordsBufferRef.current]);
      }

      if (isFirstPoint.current) {
        isFirstPoint.current = false;
        driveStartRef.current = Date.now();
        setDriveElapsedSec(0);
        if (driveTimerRef.current) clearInterval(driveTimerRef.current);
        driveTimerRef.current = setInterval(() => {
          if (driveStartRef.current) setDriveElapsedSec(Math.floor((Date.now() - driveStartRef.current) / 1000));
        }, 1000);
        mapRef.current?.animateCameraTo({ latitude: coord.latitude, longitude: coord.longitude, zoom: 15, duration: 600 });
      } else if (isTracking()) {
        // 주행 중에는 지도가 내 위치를 계속 따라가도록 (줌 레벨은 유지)
        mapRef.current?.animateCameraTo({ latitude: coord.latitude, longitude: coord.longitude, duration: 500 });
      }
    });

    const removeStop = addStopListener((stoppedDriveId) => {
      setTracking(false);
      setRouteCoords([]);
      routeCoordsBufferRef.current = [];
      lastRouteFlushRef.current = 0;
      setDriveDistanceKm(0);
      setDriveElapsedSec(0);
      driveStartRef.current = null;
      if (driveTimerRef.current) { clearInterval(driveTimerRef.current); driveTimerRef.current = null; }
      loadPastRoutes();
      loadVisitedCities();
      loadTotalDistance();
      setCompletedDriveId(stoppedDriveId);
      setCompletedDrive(null);
      fetchDriveResult(stoppedDriveId).then(setCompletedDrive, (error: unknown) => {
        console.error('[DriveResult] summary load failed:', error);
      });
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
  }, [loadPastRoutes, loadVisitedCities, loadTotalDistance]);

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

    // 네이버 지도 Basic 테마 배경이 산/녹지 위주로 초록 계열이라, 기존 그린 그라데이션은
    // 특히 옅은 구간(1회)이 지형과 색이 겹쳐 거의 안 보였음. 지도에 쓰이지 않는 보라 계열
    // 그라데이션(연한 라벤더 → 짙은 바이올렛)으로 교체해 배경과 확실히 대비되게 함
    // 흰 테두리(outline)를 둘러 지도 배경과 대비를 주고 입체감 있게 표현
    const freqStyle = (freq: number): { color: string; width: number } => {
      if (freq >= 7) return { color: '#4C1D95', width: 7 };  // 짙은 바이올렛 (7회+)
      if (freq >= 4) return { color: '#6D28D9', width: 6 };  // 퍼플 (4-6회)
      if (freq >= 2) return { color: '#8B5CF6', width: 5 };  // 라이트 퍼플 (2-3회)
      return { color: '#C4B5FD', width: 4 };                 // 연한 라벤더 (1회)
    };

    const segments: Array<{ coords: LatLng[]; color: string; width: number }> = [];

    for (const line of pastLines) {
      const continuousLines = splitRouteSegments((line.coordinates ?? []).map(([longitude, latitude, recordedAt]) => ({
        latitude,
        longitude,
        recordedAt,
      })));
      for (const continuousLine of continuousLines) {
        let segCoords: LatLng[] = [continuousLine[0]];
        let segFreq = getFreq(continuousLine[0].longitude, continuousLine[0].latitude);

        for (let i = 1; i < continuousLine.length; i++) {
          const pt = continuousLine[i];
          const freq = getFreq(pt.longitude, pt.latitude);
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
    }

    // 저빈도 → 고빈도 순 정렬 (고빈도가 위에 그려짐)
    segments.sort((a, b) => a.width - b.width);
    return segments;
  }, [pastLines]);

  const liveRouteSegments = useMemo(() => splitRouteSegments(routeCoords), [routeCoords]);

  const withCityMeta = useCallback((cities: City[]) => {
    const cityMap = new Map(visitedCities.map((c) => [c.city_code, c]));
    return cities.map((c) => ({
      ...c,
      color: PROVINCE_COLOR_MAP.get(c.province_code) ?? '#94A3B8',
      visited: cityMap.has(c.code),
      visitedId: cityMap.get(c.code)?.id ?? null,
      photoUrl: cityMap.get(c.code)?.photo_url ?? null,
    }));
  }, [visitedCities]);

  const citiesWithMeta = useMemo(() => withCityMeta(CITIES), [withCityMeta]);
  const citiesWithMetaSimplified = useMemo(() => withCityMeta(CITIES_SIMPLIFIED), [withCityMeta]);

  // 사진 모드 진입 시 한반도 전체가 보이도록 줌아웃
  useEffect(() => {
    if (mapMode === 'photo') {
      mapRef.current?.animateCameraTo({ latitude: 36.4, longitude: 127.8, zoom: 6.3, duration: 500 });
      photoLowDetailRef.current = true;
      setPhotoLowDetail(true);
    }
  }, [mapMode]);

  // 사진 모드에서 확대/축소가 끝날 때마다(제스처 도중이 아니라 멈췄을 때만) 배경 렌더링
  // 정밀도와 뷰포트를 갱신 — 제스처 중에는 렌더 트리를 안 건드려야 드래그가 매끄러움
  const handlePhotoCameraIdle = useCallback((params: { zoom?: number; region: Region }) => {
    if (params.zoom != null) {
      if (photoLowDetailRef.current && params.zoom >= PHOTO_LOD_ENTER_HIGH_ZOOM) {
        photoLowDetailRef.current = false;
        setPhotoLowDetail(false);
      } else if (!photoLowDetailRef.current && params.zoom <= PHOTO_LOD_ENTER_LOW_ZOOM) {
        photoLowDetailRef.current = true;
        setPhotoLowDetail(true);
      }
    }

    const { latitude, longitude, latitudeDelta, longitudeDelta } = params.region;
    setPhotoVisibleRegion({
      minLat: latitude, maxLat: latitude + latitudeDelta,
      minLng: longitude, maxLng: longitude + longitudeDelta,
    });
  }, []);

  // 주행 모드에서 줌 레벨이 바뀔 때마다(제스처 멈췄을 때만) 경로선 굵기 재계산
  const handleDriveCameraIdle = useCallback((params: { zoom?: number }) => {
    if (params.zoom != null) setDriveZoom(params.zoom);
  }, []);

  // 사용자가 직접 지도를 움직이면(제스처) 더 이상 내 위치를 따라가는 상태가 아님
  const handleDriveCameraChanged = useCallback((params: { reason: CameraChangeReason }) => {
    if (params.reason === 'Gesture') setFollowingMe(false);
  }, []);

  const handleLocateMe = useCallback(async () => {
    let pos = currentPosition;
    if (!pos) {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      pos = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
      setCurrentPosition(pos);
    }
    mapRef.current?.animateCameraTo({ ...pos, zoom: Math.max(driveZoom, 14), duration: 500 });
    setFollowingMe(true);
  }, [currentPosition, driveZoom]);

  const photoVisibleCities = useMemo(() => {
    const source = photoLowDetail ? citiesWithMetaSimplified : citiesWithMeta;
    if (!photoVisibleRegion) return source;
    const padded = padBBox(photoVisibleRegion, PHOTO_VIEWPORT_PAD_RATIO);
    return source.filter((c) => {
      const bbox = CITY_BBOX_MAP.get(c.code);
      return bbox ? bboxIntersects(bbox, padded) : true;
    });
  }, [photoLowDetail, citiesWithMeta, citiesWithMetaSimplified, photoVisibleRegion]);

  const photoVisibleUnvisitedCities = useMemo(
    () => photoVisibleCities.filter((city) => !city.visited),
    [photoVisibleCities],
  );
  const photoVisibleVisitedCities = useMemo(
    () => photoVisibleCities.filter((city) => city.visited),
    [photoVisibleCities],
  );

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

  // 롱프레스 = 사진 등록(여러 장 선택 가능, 첫 장이 자동 대표사진). 관리(삭제/대표사진 변경)는 탭 -> 갤러리에서.
  // 롱프레스 = 사진 등록 (갤러리를 열고 바로 사진 추가 흐름 시작). 관리(삭제/대표사진 변경)는 탭 -> 갤러리에서.
  const handleMapLongPress = ({ latitude, longitude }: LatLng) => {
    if (mapMode !== 'photo') return;
    const city = matchCity({ latitude, longitude }, CITY_INDEX);
    if (!city) return;

    const meta = citiesWithMeta.find((c) => c.code === city.code);
    if (!meta) return;
    if (!meta.visited || !meta.visitedId) {
      Alert.alert(meta.name, '아직 방문하지 않은 지역이에요. 주행 기록이 있어야 사진을 등록할 수 있어요.');
      return;
    }
    const visitedId = meta.visitedId;

    if (!meta.photoUrl) {
      // 등록된 사진이 없는 도시 — 등록 여부부터 확인
      Alert.alert(meta.name, '이 지역에 사진을 등록할까요?', [
        { text: '취소', style: 'cancel' },
        {
          text: '등록',
          onPress: () => setGalleryTarget({ visitedId, cityCode: meta.code, cityName: meta.name, autoAdd: true }),
        },
      ]);
    } else {
      // 이미 사진이 있는 도시 — 수정(추가/삭제/순서/대표사진) 여부 확인
      Alert.alert(meta.name, undefined, [
        { text: '취소', style: 'cancel' },
        {
          text: '수정',
          onPress: () => setGalleryTarget({ visitedId, cityCode: meta.code, cityName: meta.name, startInEdit: true }),
        },
      ]);
    }
  };

  const openZeroHundred = () => {
    Alert.alert(
      '안전 안내',
      '제로백 측정은 공공도로가 아닌 트랙, 사유지 등 안전하고 합법적인 장소에서만 이용해주세요. 공공도로에서의 급가속은 위험하며 도로교통법 위반일 수 있습니다.',
      [
        { text: '취소', style: 'cancel' },
        { text: '확인, 측정 시작', onPress: () => startZeroHundred() },
      ]
    );
  };

  const startZeroHundred = async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return;
    zhStateRef.current = 'ready';
    zhStartRef.current = null;
    if (zhTimerRef.current) { clearInterval(zhTimerRef.current); zhTimerRef.current = null; }
    setZhState('ready');
    setZhSpeed(0);
    setZhTimer(0);
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
    const gpsHistory: SpeedSample[] = [];

    zhSubRef.current = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.BestForNavigation, distanceInterval: 0, timeInterval: 0 },
      (loc) => {
        const kmh = Math.max(0, (loc.coords.speed ?? 0) * 3.6);
        const ts = loc.timestamp;

        setZhSpeed(Math.round(kmh));

        // 측정 중 GPS 샘플 기록 (이전 가속 비율 계산용)
        if (zhStateRef.current === 'measuring' && kmh > 0) {
          gpsHistory.push({ timestampMs: ts, speedKmh: kmh });
        }

        if (zhStateRef.current === 'measuring' && kmh >= 100 && zhStartRef.current) {
          // 650/700ms 실측 지연 평균에 최근 남은 약 0.1s 오차를 더한 단일 보정값으로 계산한다.
          const elapsed = calculateZeroToHundredSeconds({
            startTimestampMs: zhStartRef.current,
            samples: gpsHistory,
          });
          if (elapsed == null) return;
          if (zhTimerRef.current) { clearInterval(zhTimerRef.current); zhTimerRef.current = null; }
          setZhResult(elapsed);
          setZhState('done');
          zhStateRef.current = 'done';
          zhSubRef.current?.remove();
          zhSubRef.current = null;
          if (elapsed > 0 && elapsed < 60 && isFinite(elapsed)) {
            supabase.auth.getSession().then(({ data: { session } }) => {
              if (!session?.user) return;
              setTimeout(() => {
                supabase.rpc('save_best_zero_to_hundred', {
                  p_user_id: session.user.id,
                  p_seconds: elapsed,
                }).then(({ error }) => {
                  if (error) console.error('save_best_zero_to_hundred failed:', error);
                }, (error: unknown) => {
                  console.error('save_best_zero_to_hundred rejected:', error);
                });
              }, 0);
            });
          }
        }
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

  const startDriveFlow = useCallback(async () => {
    isFirstPoint.current = true;

    const { status: fgStatus } = await Location.getForegroundPermissionsAsync();
    const { status: bgStatus } = await Location.getBackgroundPermissionsAsync();
    if (fgStatus === 'undetermined' || bgStatus === 'undetermined') {
      await new Promise<void>((resolve) => {
        Alert.alert(
          '위치 접근 권한 안내',
          '주행 경로를 기록하려면 위치 접근이 필요해요. 화면을 보고 있지 않은 동안에도 경로가 끊기지 않도록 다음 화면에서 "항상 허용"을 선택해주세요.',
          [{ text: '확인', onPress: () => resolve() }]
        );
      });
    }

    let ok = false;
    try { ok = await startTracking(); } catch (e: any) {
      Alert.alert('오류', e.message ?? String(e)); return;
    }
    if (!ok) {
      Alert.alert('위치 권한 필요', '설정 > 개인정보 보호 > 위치 서비스에서 Driend를 "항상"으로 설정해주세요.');
      return;
    }
    setTracking(true);
  }, []);

  const toggleTracking = async () => {
    if (toggling) return;
    setToggling(true);
    try {
      if (tracking) {
        await stopTracking();
      } else {
        await startDriveFlow();
      }
    } catch {
      Alert.alert('주행 종료 실패', '경로 저장에 실패해 기록을 계속하고 있어요. 네트워크 연결 후 다시 시도해주세요.');
    } finally {
      setToggling(false);
    }
  };

  useFocusEffect(useCallback(() => {
    if (consumePendingWidgetStopDrive()) {
      if (!isTracking() || toggling) return;
      Alert.alert(
        '주행을 종료할까요?',
        '외부 요청으로 주행 종료 화면을 열었어요. 확인하면 현재 위치 기록을 종료합니다.',
        [
          { text: '취소', style: 'cancel' },
          {
            text: '주행 종료',
            style: 'destructive',
            onPress: () => {
              setToggling(true);
              stopTracking()
                .catch(() => {
                  Alert.alert('주행 종료 실패', '경로 저장에 실패해 기록을 계속하고 있어요. 네트워크 연결 후 다시 시도해주세요.');
                })
                .finally(() => setToggling(false));
            },
          },
        ],
      );
      return;
    }
    if (tracking || toggling || !consumePendingWidgetStartDrive()) return;
    Alert.alert(
      '주행을 시작할까요?',
      '위젯에서 주행 시작을 요청했어요. 확인하면 위치 기록을 시작합니다.',
      [
        { text: '취소', style: 'cancel' },
        {
          text: '주행 시작',
          onPress: () => {
            setToggling(true);
            startDriveFlow().finally(() => setToggling(false));
          },
        },
      ],
    );
  }, [startDriveFlow, tracking, toggling]));

  return (
    <View style={s.container}>
      <View style={s.map}>
      <NaverMapView
        ref={mapRef}
        style={[s.map, mapMode === 'photo' && s.mapPhotoMode]}
        initialCamera={{ latitude: 36.5, longitude: 127.5, zoom: 6 }}
        mapType={mapMode === 'photo' ? 'None' : 'Navi'}
        isShowLocationButton={false}
        isShowCompass={mapMode === 'drive'}
        isShowZoomControls={false}
        extent={KOREA_EXTENT}
        minZoom={6.5}
        isRotateGesturesEnabled={false}
        locationOverlay={mapMode === 'drive' && currentPosition ? {
          isVisible: true,
          position: currentPosition,
        } : { isVisible: false }}
        onCameraIdle={
          mapMode === 'photo' ? handlePhotoCameraIdle :
          mapMode === 'drive' ? handleDriveCameraIdle : undefined
        }
        onCameraChanged={mapMode === 'drive' ? handleDriveCameraChanged : undefined}
        onLongPressMap={mapMode === 'photo' ? handleMapLongPress : undefined}
      >
        {mapMode === 'drive' && (
          <>
            {heatSegments.map((seg, i) => (
              <NaverMapPathOverlay
                key={`heat-${i}`}
                coords={seg.coords}
                color={seg.color}
                outlineColor="rgba(255,255,255,0.55)"
                outlineWidth={1.5 * routeWidthScale(driveZoom)}
                width={seg.width * routeWidthScale(driveZoom)}
              />
            ))}
            {liveRouteSegments.map((segment, index) => (
              // 현재 주행 중인 경로는 과거 기록(보라 계열)과 구분되도록 선명한 핑크로 강조
              <NaverMapPathOverlay
                key={`live-route-${index}`}
                coords={segment}
                color="#FF2D78"
                outlineColor="rgba(255,255,255,0.9)"
                outlineWidth={2.5 * routeWidthScale(driveZoom)}
                width={7 * routeWidthScale(driveZoom)}
              />
            ))}
          </>
        )}

        {mapMode === 'photo' && (
          <>
            {photoVisibleUnvisitedCities.flatMap((c) =>
              c.polygons.map((coords, i) => (
                <NaverMapPolygonOverlay
                  key={`poly-${c.code}-${i}`}
                  coords={coords}
                  color={`${c.color}B3`}
                  outlineWidth={1}
                  outlineColor="rgba(255,255,255,0.5)"
                />
              ))
            )}

            {photoVisibleVisitedCities.flatMap((c) => {
              // 사진이 없으면 탭은 아무 동작도 하지 않음 (등록은 롱프레스로만)
              const onTapCity = () =>
                c.visitedId && setGalleryTarget({ visitedId: c.visitedId, cityCode: c.code, cityName: c.name });
              const photoRegion = CITY_REGION_MAP.get(c.code);
              return [
                ...c.polygons.map((coords, i) => (
                  <NaverMapPolygonOverlay
                    key={`visited-poly-${c.code}-${i}`}
                    coords={coords}
                    color={`${c.color}F2`}
                    outlineWidth={1.75}
                    outlineColor="rgba(255,255,255,0.95)"
                  />
                )),
                ...(c.photoUrl && photoRegion ? [
                  <NaverMapGroundOverlay
                    key={`photo-${c.code}`}
                    globalZIndex={1}
                    image={{ httpUri: c.photoUrl }}
                    region={photoRegion}
                    onTap={onTapCity}
                  />,
                  // 지상 오버레이(사진)가 폴리곤 테두리를 덮어버려서, 테두리만 순수 선으로 다시 그림
                  // (채우기 있는 폴리곤을 투명색으로 위에 얹으면 탭을 가로채는 문제가 있어 폴리라인 사용)
                  ...c.polygons.map((coords, i) => (
                    <NaverMapPolylineOverlay
                      key={`visited-poly-border-${c.code}-${i}`}
                      globalZIndex={2}
                      coords={coords}
                      width={1}
                      color="rgba(255,255,255,0.95)"
                    />
                  )),
                ] : []),
              ];
            })}
          </>
        )}
      </NaverMapView>
      </View>

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
              : <Text style={s.trackText}>{tracking ? '중지' : '시작'}</Text>
            }
          </TouchableOpacity>

          <TouchableOpacity style={s.zhBtn} onPress={openZeroHundred}>
            <Text style={s.zhBtnText}>0→100</Text>
          </TouchableOpacity>

          {widgetTip && !tracking && !toggling && onboardingStep === 0 && (
            <View style={s.widgetTipBubble} pointerEvents="box-none">
              <Text style={s.widgetTipTitle}>홈 화면 위젯으로 바로 시작</Text>
              <Text style={s.widgetTipBody}>
                홈 화면에 Driend 위젯을 추가하면{'\n'}앱을 켜지 않고도 한 번에 주행을 시작할 수 있어요.
              </Text>
              <TouchableOpacity style={s.widgetTipBtn} onPress={dismissWidgetTip}>
                <Text style={s.widgetTipBtnText}>알겠어요</Text>
              </TouchableOpacity>
            </View>
          )}

          <View style={s.driveHud} pointerEvents="box-none">
            <View style={s.driveHudStatusRow}>
              <View style={[s.driveHudDot, tracking && s.driveHudDotActive]} />
              <Text style={s.driveHudStatusText}>{tracking ? '기록 중' : '기록 대기'}</Text>
            </View>
            <View style={s.driveHudNumRow}>
              <View style={s.driveHudDistanceGroup}>
                <Text style={s.driveHudDistance}>{(totalDistanceKm + driveDistanceKm).toFixed(2)}</Text>
                <View style={s.driveHudUnitCol}>
                  <Text style={s.driveHudUnit}>km</Text>
                  <Text style={s.driveHudSub}>누적</Text>
                </View>
              </View>
              <TouchableOpacity onPress={handleLocateMe} hitSlop={12}>
                <Svg width={27} height={27} viewBox="0 0 24 24" style={{ transform: [{ rotate: '45deg' }] }}>
                  <Path
                    d="M12 2 4.5 20.29 5.21 21 12 18 18.79 21 19.5 20.29 12 2Z"
                    fill={followingMe ? colors.text : 'none'}
                    stroke={colors.text}
                    strokeWidth={followingMe ? 0 : 1.4}
                    strokeLinejoin="round"
                  />
                </Svg>
              </TouchableOpacity>
            </View>
            {tracking && <Text style={s.driveHudTimer}>{formatElapsed(driveElapsedSec)}</Text>}
          </View>
        </>
      )}

      {mapMode === 'photo' && (
        <View style={s.driveHud} pointerEvents="none">
          <View style={s.driveHudNumRow}>
            <Text style={s.driveHudDistance}>{visitedCities.length}</Text>
            <View style={s.driveHudUnitCol}>
              <Text style={s.driveHudUnit}>곳</Text>
              <Text style={s.driveHudSub}>방문</Text>
            </View>
          </View>
        </View>
      )}

      <CityPhotoGallery
        visible={!!galleryTarget}
        userId={userId}
        visitedId={galleryTarget?.visitedId ?? null}
        cityCode={galleryTarget?.cityCode ?? null}
        cityName={galleryTarget?.cityName ?? ''}
        autoAdd={galleryTarget?.autoAdd ?? false}
        startInEdit={galleryTarget?.startInEdit ?? false}
        onClose={() => setGalleryTarget(null)}
        onChanged={loadVisitedCities}
      />

      <Modal visible={!!completedDriveId} animationType="slide" transparent onRequestClose={() => setCompletedDriveId(null)}>
        <View style={s.completionOverlay}>
          <View style={s.completionSheet}>
            <View style={s.completionHandle} />
            <Text style={s.completionTitle}>주행을 마쳤어요</Text>
            {completedDrive ? (
              <>
                <View style={s.completionStats}>
                  <View style={s.completionStat}><Text style={s.completionValue}>{completedDrive.distanceKm.toFixed(1)}</Text><Text style={s.completionLabel}>거리 km</Text></View>
                  <View style={s.completionStat}><Text style={s.completionValue}>{Math.round(completedDrive.maxSpeedKmh)}</Text><Text style={s.completionLabel}>최고 km/h</Text></View>
                  <View style={s.completionStat}><Text style={s.completionValue}>{Math.round(getAverageSpeedKmh(completedDrive))}</Text><Text style={s.completionLabel}>평균 km/h</Text></View>
                </View>
                <Text style={s.completionDuration}>{formatDriveDuration(getDurationSeconds(completedDrive))} 동안 주행했어요</Text>
              </>
            ) : <ActivityIndicator style={{ marginVertical: 24 }} color={colors.primary} />}
            <TouchableOpacity
              style={[s.completionResultButton, !completedDrive && { opacity: 0.5 }]}
              disabled={!completedDrive}
              onPress={() => {
                const resultId = completedDriveId;
                setCompletedDriveId(null);
                if (resultId) router.push({ pathname: '/drive-result/[id]', params: { id: resultId, editable: '1' } });
              }}
            >
              <Text style={s.completionResultText}>주행 인증 카드</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.completionCloseButton} onPress={() => setCompletedDriveId(null)}>
              <Text style={s.completionCloseText}>닫기</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

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

            <TouchableOpacity style={s.zhCloseBtn} onPress={closeZeroHundred}>
              <Text style={s.zhCloseText}>닫기</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {onboardingStep > 0 && (
        <View style={s.onboardOverlay} pointerEvents="box-none">
          {onboardingStep === 1 && (
            <View style={[s.onboardBubble, s.onboardBubbleBottom]}>
              <Text style={s.onboardText}>도로 모드에서는{'\n'}"시작"을 눌러 주행을 기록하세요</Text>
              <TouchableOpacity style={s.onboardBtn} onPress={advanceOnboarding}>
                <Text style={s.onboardBtnText}>다음</Text>
              </TouchableOpacity>
            </View>
          )}
          {onboardingStep === 2 && (
            <View style={[s.onboardBubble, s.onboardBubbleTop]}>
              <Text style={s.onboardText}>사진 모드에서는{'\n'}방문한 지역을 길게 눌러 사진을 등록하세요</Text>
              <TouchableOpacity style={s.onboardBtn} onPress={finishOnboarding}>
                <Text style={s.onboardBtnText}>확인</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}
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
    width: 140,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#111111',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 5,
  },
  trackBtnActive: { backgroundColor: '#111111' },
  trackBtnDisabled: { opacity: 0.7 },
  trackText: { color: '#fff', fontSize: 16, fontWeight: '600' },

  widgetTipBubble: {
    position: 'absolute',
    bottom: 124,
    left: 24,
    right: 24,
    backgroundColor: '#191919',
    borderRadius: 16,
    padding: 18,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  widgetTipTitle: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 6,
  },
  widgetTipBody: {
    color: 'rgba(255,255,255,0.78)',
    fontSize: 13,
    fontWeight: '400',
    textAlign: 'center',
    lineHeight: 19,
    marginBottom: 14,
  },
  widgetTipBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: 22,
    paddingVertical: 9,
    borderRadius: 16,
  },
  widgetTipBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  driveHud: {
    position: 'absolute',
    top: 116,
    left: 20,
    right: 20,
  },
  driveHudStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  driveHudDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.textTertiary,
  },
  driveHudDotActive: { backgroundColor: colors.danger },
  driveHudStatusText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#4B5563',
    textShadowColor: 'rgba(255,255,255,0.8)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 4,
  },
  driveHudNumRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  driveHudDistanceGroup: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  driveHudDistance: {
    fontSize: 48,
    fontWeight: '500',
    color: colors.text,
    letterSpacing: -1.5,
    lineHeight: 48,
    textShadowColor: 'rgba(255,255,255,0.8)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 6,
  },
  driveHudUnitCol: {
    marginLeft: 6,
    marginBottom: 4,
  },
  driveHudUnit: {
    fontSize: 15,
    fontWeight: '400',
    color: colors.textSecondary,
    lineHeight: 17,
  },
  driveHudSub: {
    fontSize: 12,
    fontWeight: '400',
    color: colors.textTertiary,
    lineHeight: 14,
  },
  driveHudTimer: {
    fontSize: 13,
    fontWeight: '400',
    color: colors.textSecondary,
    marginTop: 4,
    textShadowColor: 'rgba(255,255,255,0.8)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 4,
  },

  zhBtn: {
    position: 'absolute',
    bottom: 48,
    right: 20,
    backgroundColor: '#1a1a2e',
    paddingHorizontal: 20,
    paddingVertical: 15,
    borderRadius: 27,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 5,
  },
  zhBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },

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
  zhCloseBtn: { marginTop: 12 },
  zhCloseText: { color: 'rgba(255,255,255,0.4)', fontSize: 14 },

  completionOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  completionSheet: {
    backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 24, paddingBottom: 32, gap: 12,
  },
  completionHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.textTertiary, alignSelf: 'center', marginBottom: 4 },
  completionTitle: { fontSize: 22, fontWeight: '800', color: colors.text, textAlign: 'center' },
  completionStats: { flexDirection: 'row', paddingVertical: 12 },
  completionStat: { flex: 1, alignItems: 'center', gap: 3 },
  completionValue: { fontSize: 28, fontWeight: '800', color: colors.text },
  completionLabel: { fontSize: 11, color: colors.textSecondary },
  completionDuration: { fontSize: 13, color: colors.textSecondary, textAlign: 'center' },
  completionResultButton: { height: 50, borderRadius: 12, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  completionResultText: { fontSize: 16, fontWeight: '700', color: '#fff' },
  completionCloseButton: { paddingVertical: 8, alignItems: 'center' },
  completionCloseText: { fontSize: 14, color: colors.textSecondary },

  onboardOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  onboardBubble: {
    position: 'absolute',
    left: 24,
    right: 24,
    backgroundColor: '#191919',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  onboardBubbleBottom: { bottom: 160 },
  onboardBubbleTop: { top: 170 },
  onboardText: {
    color: '#fff', fontSize: 15, fontWeight: '600',
    textAlign: 'center', lineHeight: 22, marginBottom: 14,
  },
  onboardBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: 24, paddingVertical: 10, borderRadius: 18,
  },
  onboardBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
});
