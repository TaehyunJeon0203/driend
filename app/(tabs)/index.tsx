import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, StyleSheet, TouchableOpacity, Text, Alert,
  ActivityIndicator, Image, Modal,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import {
  NaverMapView,
  NaverMapPathOverlay,
  NaverMapPolygonOverlay,
  NaverMapMarkerOverlay,
  type NaverMapViewRef,
} from '@mj-studio/react-native-naver-map';
import { supabase } from '../../src/services/supabase';
import {
  startTracking, stopTracking, isTracking,
  addPointListener, addStopListener,
} from '../../src/services/locationTracker';
import { colors } from '../../src/theme';
import PROVINCE_DATA from '../../assets/korea-provinces.json';

type MapMode = 'drive' | 'photo';
type RouteLine = { drive_id: string; coordinates: [number, number][] };
type LatLng = { latitude: number; longitude: number };
type VisitedCity = { city_code: string; city_name: string; photo_url: string | null };
type Province = { code: string; name: string; center: LatLng; polygons: LatLng[][] };

const PROVINCES = PROVINCE_DATA as Province[];

export default function MapScreen() {
  const mapRef = useRef<NaverMapViewRef>(null);
  const isFirstPoint = useRef(true);
  const hasCenteredOnUser = useRef(false);
  const [tracking, setTracking] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [routeCoords, setRouteCoords] = useState<LatLng[]>([]);
  const [pastLines, setPastLines] = useState<RouteLine[]>([]);
  const [currentPosition, setCurrentPosition] = useState<LatLng | null>(null);

  const [mapMode, setMapMode] = useState<MapMode>('drive');
  const [visitedCities, setVisitedCities] = useState<VisitedCity[]>([]);
  const [uploading, setUploading] = useState<string | null>(null);

  // 제로백 측정
  type ZHState = 'ready' | 'measuring' | 'done';
  const [zhVisible, setZhVisible] = useState(false);
  const [zhState, setZhState] = useState<ZHState>('ready');
  const [zhSpeed, setZhSpeed] = useState(0);
  const [zhResult, setZhResult] = useState<number | null>(null);
  const zhStateRef = useRef<ZHState>('ready');
  const zhStartRef = useRef<number | null>(null);
  const zhSubRef = useRef<Location.LocationSubscription | null>(null);

  const loadPastRoutes = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase.rpc('get_user_route_lines', { p_user_id: user.id });
    if (data) setPastLines(data);
  }, []);

  const loadVisitedCities = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase
      .from('visited_cities')
      .select('city_code, city_name, photo_url')
      .eq('user_id', user.id);
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

    const freqStyle = (freq: number): { color: string; width: number } => {
      if (freq >= 7) return { color: '#9333ea', width: 5 };  // 보라 (7회+)
      if (freq >= 4) return { color: '#2563eb', width: 4 };  // 파랑 (4-6회)
      if (freq >= 2) return { color: '#16a34a', width: 3.5 }; // 초록 (2-3회)
      return { color: '#4ade80', width: 2.5 };                // 연초록 (1회)
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

  const visitedProvinces = useMemo(() => {
    const cityMap = new Map(visitedCities.map((c) => [c.city_code, c]));
    return PROVINCES
      .filter((p) => cityMap.has(p.code))
      .map((p) => ({ ...p, photoUrl: cityMap.get(p.code)?.photo_url ?? null }));
  }, [visitedCities]);

  const pickProvincePhoto = async (province: Province & { photoUrl: string | null }) => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('권한 필요', '사진 라이브러리 접근 권한이 필요해요.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (result.canceled) return;

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    setUploading(province.code);
    try {
      const asset = result.assets[0];
      const ext = asset.uri.split('.').pop() ?? 'jpg';
      const path = `${user.id}/${province.code}.${ext}`;
      const { data: { session } } = await supabase.auth.getSession();
      const formData = new FormData();
      formData.append('file', { uri: asset.uri, name: `photo.${ext}`, type: `image/${ext}` } as any);
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `${process.env.EXPO_PUBLIC_SUPABASE_URL}/storage/v1/object/city-photos/${path}`);
        xhr.setRequestHeader('Authorization', `Bearer ${session!.access_token}`);
        xhr.setRequestHeader('x-upsert', 'true');
        xhr.onload = () => {
          if (xhr.status < 300) resolve();
          else { try { reject(new Error(JSON.parse(xhr.responseText).message)); } catch { reject(new Error('업로드 실패')); } }
        };
        xhr.onerror = () => reject(new Error('네트워크 오류'));
        xhr.send(formData);
      });

      const { data: { publicUrl } } = supabase.storage.from('city-photos').getPublicUrl(path);
      await supabase.from('visited_cities')
        .update({ photo_url: publicUrl })
        .eq('user_id', user.id)
        .eq('city_code', province.code);
      setVisitedCities((prev) =>
        prev.map((c) => c.city_code === province.code ? { ...c, photo_url: publicUrl } : c)
      );
    } catch (e: any) {
      Alert.alert('업로드 실패', e.message ?? String(e));
    } finally {
      setUploading(null);
    }
  };

  const openZeroHundred = async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return;
    zhStateRef.current = 'ready';
    zhStartRef.current = null;
    setZhState('ready');
    setZhSpeed(0);
    setZhResult(null);
    setZhVisible(true);
    zhSubRef.current = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.BestForNavigation, distanceInterval: 0, timeInterval: 250 },
      (loc) => {
        const kmh = Math.max(0, (loc.coords.speed ?? 0) * 3.6);
        setZhSpeed(Math.round(kmh));
        if (zhStateRef.current === 'ready' && kmh >= 3) {
          zhStartRef.current = Date.now();
          zhStateRef.current = 'measuring';
          setZhState('measuring');
        }
        if (zhStateRef.current === 'measuring' && kmh >= 100 && zhStartRef.current) {
          const elapsed = Math.round((Date.now() - zhStartRef.current) / 100) / 10;
          setZhResult(elapsed);
          setZhState('done');
          zhStateRef.current = 'done';
          zhSubRef.current?.remove();
          zhSubRef.current = null;
        }
      }
    );
  };

  const closeZeroHundred = () => {
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
        style={s.map}
        initialCamera={{ latitude: 36.5, longitude: 127.5, zoom: 6 }}
        isShowLocationButton={mapMode === 'drive'}
        isShowCompass
        isExtentBoundedInKorea
        locationOverlay={mapMode === 'drive' && currentPosition ? {
          isVisible: true,
          position: currentPosition,
          circleRadius: 60,
          circleColor: 'rgba(0, 120, 255, 0.08)',
          circleOutlineWidth: 1,
          circleOutlineColor: 'rgba(0, 120, 255, 0.25)',
        } : undefined}
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

        {mapMode === 'photo' && visitedProvinces.map((p) => (
          <>
            {p.polygons.map((coords, i) => (
              <NaverMapPolygonOverlay
                key={`poly-${p.code}-${i}`}
                coords={coords}
                color="rgba(4, 120, 87, 0.18)"
                outlineWidth={1.5}
                outlineColor={colors.primary}
                onTap={() => pickProvincePhoto(p)}
              />
            ))}
            <NaverMapMarkerOverlay
              key={`marker-${p.code}`}
              latitude={p.center.latitude}
              longitude={p.center.longitude}
              width={64}
              height={64}
              anchor={{ x: 0.5, y: 0.5 }}
              onTap={() => pickProvincePhoto(p)}
            >
              {uploading === p.code ? (
                <View style={s.markerPlaceholder}>
                  <ActivityIndicator size="small" color={colors.primary} />
                </View>
              ) : p.photoUrl ? (
                <Image source={{ uri: p.photoUrl }} style={s.markerPhoto} />
              ) : (
                <View style={s.markerPlaceholder}>
                  <Text style={s.markerPlus}>+</Text>
                </View>
              )}
            </NaverMapMarkerOverlay>
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
          <View style={s.zhCard}>
            <Text style={s.zhStateLabel}>
              {zhState === 'ready' ? '정지 후 출발하세요' : zhState === 'measuring' ? '측정 중...' : '측정 완료'}
            </Text>

            {zhState === 'done' ? (
              <>
                <Text style={s.zhResultNum}>{zhResult?.toFixed(1)}</Text>
                <Text style={s.zhResultUnit}>초</Text>
                <TouchableOpacity style={s.zhRetryBtn} onPress={openZeroHundred}>
                  <Text style={s.zhRetryText}>다시 측정</Text>
                </TouchableOpacity>
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
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },

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
  zhResultNum: { fontSize: 80, fontWeight: '900', color: '#4ade80', lineHeight: 88 },
  zhResultUnit: { fontSize: 24, color: 'rgba(255,255,255,0.6)', marginTop: -8 },
  zhRetryBtn: {
    marginTop: 16, backgroundColor: colors.primary,
    paddingHorizontal: 28, paddingVertical: 12, borderRadius: 20,
  },
  zhRetryText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  zhCloseBtn: { marginTop: 12 },
  zhCloseText: { color: 'rgba(255,255,255,0.4)', fontSize: 14 },

  markerPhoto: {
    width: 64, height: 64, borderRadius: 32,
    borderWidth: 2.5, borderColor: colors.primary,
  },
  markerPlaceholder: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: 'rgba(4,120,87,0.12)',
    borderWidth: 2, borderColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  markerPlus: { fontSize: 22, color: colors.primary, fontWeight: '300' },
});
