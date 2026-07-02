import { useEffect, useRef, useState } from 'react';
import { View, StyleSheet, TouchableOpacity, Text, Alert, ActivityIndicator } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import * as Location from 'expo-location';
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
  const [toggling, setToggling] = useState(false);
  const [routeCoords, setRouteCoords] = useState<LatLng[]>([]);
  const [pastLines, setPastLines] = useState<RouteLine[]>([]);
  const [currentPosition, setCurrentPosition] = useState<LatLng | null>(null);

  const loadPastRoutes = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase.rpc('get_user_route_lines', { p_user_id: user.id });
    if (data) setPastLines(data);
  };

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
      setCurrentPosition(latLng);
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

    // 포그라운드 위치 감시 — 현재 위치 파란 점 표시용
    let locationSub: Location.LocationSubscription | null = null;
    Location.requestForegroundPermissionsAsync().then(({ status }) => {
      if (status !== 'granted') return;
      Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, distanceInterval: 5 },
        (loc) => {
          setCurrentPosition({
            latitude: loc.coords.latitude,
            longitude: loc.coords.longitude,
          });
        }
      ).then((sub) => { locationSub = sub; });
    });

    return () => {
      removePoint();
      removeStop();
      locationSub?.remove();
    };
  }, []);

  const toggleTracking = async () => {
    if (toggling) return;
    setToggling(true);
    try {
      if (tracking) {
        await stopTracking();
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
          Alert.alert(
            '위치 권한 필요',
            '백그라운드 주행 기록을 위해 설정 > 개인정보 보호 > 위치 서비스에서 Driend를 "항상"으로 설정해주세요.',
          );
          return;
        }
        setTracking(true);
      }
    } finally {
      setToggling(false);
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
        locationOverlay={currentPosition ? {
          isVisible: true,
          position: currentPosition,
          circleRadius: 60,
          circleColor: 'rgba(0, 120, 255, 0.08)',
          circleOutlineWidth: 1,
          circleOutlineColor: 'rgba(0, 120, 255, 0.25)',
        } : undefined}
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
        style={[styles.trackBtn, tracking && styles.trackBtnActive, toggling && styles.trackBtnDisabled]}
        onPress={toggleTracking}
        disabled={toggling}
      >
        {toggling
          ? <ActivityIndicator size="small" color="#fff" />
          : <Text style={styles.trackText}>{tracking ? '⏹ 기록 중지' : '▶ 주행 시작'}</Text>
        }
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
    minWidth: 160,
    alignItems: 'center',
  },
  trackBtnActive: { backgroundColor: colors.danger },
  trackBtnDisabled: { opacity: 0.7 },
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
