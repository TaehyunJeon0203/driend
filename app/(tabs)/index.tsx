import { useEffect, useRef, useState } from 'react';
import { View, StyleSheet, TouchableOpacity, Text, Alert } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import {
  NaverMapView,
  NaverMapPathOverlay,
  type NaverMapViewRef,
} from '@mj-studio/react-native-naver-map';
import { supabase } from '../../src/services/supabase';
import {
  startTracking, stopTracking, isTracking,
  addPointListener, addStopListener,
} from '../../src/services/locationTracker';
import { colors } from '../../src/theme';

type RouteLine = { drive_id: string; coordinates: [number, number][] };
type LatLng = { latitude: number; longitude: number };

export default function MapScreen() {
  const mapRef = useRef<NaverMapViewRef>(null);
  const isFirstPoint = useRef(true);
  const [tracking, setTracking] = useState(false);
  const [routeCoords, setRouteCoords] = useState<LatLng[]>([]);
  const [pastLines, setPastLines] = useState<RouteLine[]>([]);

  const loadPastRoutes = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase.rpc('get_user_route_lines', { p_user_id: user.id });
    if (data) setPastLines(data);
  };

  // 포커스될 때마다 과거 경로 갱신 (딥링크 중지 후 탭 이동 시에도 반영)
  useFocusEffect(useCallback(() => { loadPastRoutes(); }, []));

  useEffect(() => {
    // 딥링크로 이미 주행 중이면 상태 동기화
    if (isTracking()) {
      setTracking(true);
      isFirstPoint.current = false;
    }

    // 전역 포인트 리스너: 딥링크/버튼 어디서 시작해도 경로 수신
    const removePoint = addPointListener((coord) => {
      const latLng = { latitude: coord.latitude, longitude: coord.longitude };
      setRouteCoords((prev) => [...prev, latLng]);
      if (isFirstPoint.current) {
        isFirstPoint.current = false;
        mapRef.current?.animateCameraTo({
          latitude: coord.latitude,
          longitude: coord.longitude,
          zoom: 15,
          duration: 600,
        });
      }
    });

    // 전역 중지 리스너: 딥링크로 중지해도 지도 갱신
    const removeStop = addStopListener(() => {
      setTracking(false);
      setRouteCoords([]);
      loadPastRoutes();
    });

    return () => {
      removePoint();
      removeStop();
    };
  }, []);

  const toggleTracking = async () => {
    if (tracking) {
      await stopTracking();
      // stopListeners가 위에서 처리하므로 여기선 상태만 관리
    } else {
      isFirstPoint.current = true;
      let ok = false;
      try {
        ok = await startTracking();
      } catch (e: any) {
        Alert.alert('오류', e.message ?? String(e));
        return;
      }
      if (!ok) {
        Alert.alert('시작 실패', '로그를 확인해주세요.');
        return;
      }
      setTracking(true);
    }
  };

  return (
    <View style={styles.container}>
      <NaverMapView
        ref={mapRef}
        style={styles.map}
        initialCamera={{ latitude: 36.5, longitude: 127.5, zoom: 6 }}
        isShowLocationButton
        isShowCompass
        isExtentBoundedInKorea
      >
        {pastLines.map((line) =>
          line.coordinates?.length >= 2 ? (
            <NaverMapPathOverlay
              key={line.drive_id}
              coords={line.coordinates.map(([lng, lat]) => ({ latitude: lat, longitude: lng }))}
              color={colors.primary}
              outlineColor="transparent"
              width={3}
            />
          ) : null
        )}

        {routeCoords.length >= 2 && (
          <NaverMapPathOverlay
            coords={routeCoords}
            color="#00D084"
            outlineColor="transparent"
            width={5}
          />
        )}
      </NaverMapView>

      <TouchableOpacity
        style={[styles.trackBtn, tracking && styles.trackBtnActive]}
        onPress={toggleTracking}
      >
        <Text style={styles.trackText}>{tracking ? '⏹ 기록 중지' : '▶ 주행 시작'}</Text>
      </TouchableOpacity>

      {tracking && (
        <View style={styles.recordingBadge}>
          <Text style={styles.recordingText}>● 기록 중</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },
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
  },
  trackBtnActive: { backgroundColor: colors.danger },
  trackText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  recordingBadge: {
    position: 'absolute',
    top: 56,
    alignSelf: 'center',
    backgroundColor: 'rgba(240,68,82,0.9)',
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 20,
  },
  recordingText: { color: '#fff', fontWeight: '600', fontSize: 14 },
});
