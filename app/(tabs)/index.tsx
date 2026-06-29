import { useEffect, useRef, useState, useCallback } from 'react';
import { View, StyleSheet, TouchableOpacity, Text, Alert } from 'react-native';
import Mapbox, {
  MapView,
  Camera,
  UserLocation,
  ShapeSource,
  LineLayer,
  HeatmapLayer,
} from '@rnmapbox/maps';
import { supabase } from '../../src/services/supabase';
import { startTracking, stopTracking, Coordinate } from '../../src/services/locationTracker';
import { colors } from '../../src/theme';

Mapbox.setAccessToken(process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN!);

const KOREA_CENTER: [number, number] = [127.5, 36.5];

type GeoPoint = { type: 'Feature'; geometry: { type: 'Point'; coordinates: [number, number] } };

export default function MapScreen() {
  const cameraRef = useRef<Camera>(null);
  const [tracking, setTracking] = useState(false);
  const [followUser, setFollowUser] = useState(false);
  const [routeCoords, setRouteCoords] = useState<[number, number][]>([]);
  const [heatmapPoints, setHeatmapPoints] = useState<GeoPoint[]>([]);

  // 히트맵 데이터 로드 (내 전체 경로)
  useEffect(() => {
    loadHeatmap();
  }, []);

  const loadHeatmap = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data } = await supabase.rpc('get_user_route_points', { p_user_id: user.id });
    if (!data) return;

    const features: GeoPoint[] = data.map((row: { lng: number; lat: number }) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [row.lng, row.lat] },
    }));
    setHeatmapPoints(features);
  };

  const handleLocate = () => setFollowUser(true);

  const toggleTracking = async () => {
    if (tracking) {
      await stopTracking();
      setTracking(false);
      setRouteCoords([]);
      loadHeatmap(); // 히트맵 갱신
    } else {
      let ok = false;
      try {
        ok = await startTracking((coord: Coordinate) => {
          setRouteCoords((prev) => [...prev, [coord.longitude, coord.latitude]]);
          setFollowUser(true);
        });
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

  const routeGeoJSON: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features:
      routeCoords.length >= 2
        ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: routeCoords } }]
        : [],
  };

  const heatmapGeoJSON: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: heatmapPoints,
  };

  return (
    <View style={styles.container}>
      <MapView
        style={styles.map}
        styleURL="mapbox://styles/mapbox/streets-v12"
        logoEnabled={false}
        attributionEnabled={false}
        compassEnabled
        onPress={() => setFollowUser(false)}
      >
        <Camera
          ref={cameraRef}
          zoomLevel={followUser ? 15 : 6}
          centerCoordinate={KOREA_CENTER}
          followUserLocation={followUser}
          followUserMode="normal"
          animationMode="flyTo"
          animationDuration={600}
        />

        <UserLocation visible androidRenderMode="compass" />

        {/* 히트맵 레이어 */}
        {heatmapPoints.length > 0 && (
          <ShapeSource id="heatmap-source" shape={heatmapGeoJSON}>
            <HeatmapLayer
              id="heatmap-layer"
              sourceID="heatmap-source"
              style={{
                heatmapRadius: 20,
                heatmapOpacity: 0.7,
                heatmapIntensity: 1,
                heatmapColor: [
                  'interpolate',
                  ['linear'],
                  ['heatmap-density'],
                  0, 'rgba(0,0,255,0)',
                  0.2, '#4FC3F7',
                  0.5, '#FFF176',
                  0.8, '#FF7043',
                  1, '#B71C1C',
                ],
              }}
            />
          </ShapeSource>
        )}

        {/* 실시간 경로 라인 */}
        {routeCoords.length >= 2 && (
          <ShapeSource id="route-source" shape={routeGeoJSON}>
            <LineLayer
              id="route-layer"
              style={{
                lineColor: colors.primary,
                lineWidth: 4,
                lineJoin: 'round',
                lineCap: 'round',
              }}
            />
          </ShapeSource>
        )}
      </MapView>

      {/* 현재 위치 버튼 */}
      <TouchableOpacity style={styles.locateBtn} onPress={handleLocate}>
        <Text style={styles.locateIcon}>◎</Text>
      </TouchableOpacity>

      {/* 주행 기록 버튼 */}
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
  locateBtn: {
    position: 'absolute',
    right: 16,
    bottom: 128,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
  },
  locateIcon: { fontSize: 22 },
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
