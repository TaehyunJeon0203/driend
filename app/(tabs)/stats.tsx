import { useCallback, useRef, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, Modal, TextInput,
  RefreshControl, ActivityIndicator, TouchableOpacity, Image, Alert,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../../src/services/supabase';
import { setActiveTripId } from '../../src/services/locationTracker';
import { colors, spacing, radius, typography } from '../../src/theme';

type Stats = { total_distance_km: number; total_drives: number; visited_cities_count: number; max_speed_kmh: number };
type MonthlyData = { month: string; distance_km: number };
type Trip = { id: string; name: string; started_at: string; ended_at: string | null; total_distance_km: number; total_drives: number };
type Drive = { id: string; started_at: string; ended_at: string | null; distance_km: number | null; max_speed_kmh: number | null; start_address: string | null; end_address: string | null };
type Vehicle = { id: string; name: string };
type VisitedCity = { id: string; city_code: string; city_name: string; photo_url: string | null };

const BAR_MAX_H = 72;

function formatKm(km: number | null) {
  if (!km) return '0.0';
  return km >= 1000 ? `${(km / 1000).toFixed(1)}천` : km.toFixed(1);
}

function formatDuration(start: string, end: string | null) {
  if (!end) return '-';
  const mins = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000);
  if (mins < 60) return `${mins}분`;
  return `${Math.floor(mins / 60)}시간 ${mins % 60}분`;
}

function formatDate(iso: string) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}.${d.getDate()}`;
}

export default function StatsScreen() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [monthly, setMonthly] = useState<MonthlyData[]>([]);
  const [drives, setDrives] = useState<Drive[]>([]);
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [cities, setCities] = useState<VisitedCity[]>([]);
  const [uploading, setUploading] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Drive | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [activeTrip, setActiveTripState] = useState<Trip | null>(null);
  const [creatingTrip, setCreatingTrip] = useState(false);
  const [tripName, setTripName] = useState('');
  const [selectedTrip, setSelectedTrip] = useState<Trip | null>(null);
  const [tripSaving, setTripSaving] = useState(false);

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const [statsRes, monthlyRes, drivesRes, vehicleRes, citiesRes, tripsRes] = await Promise.all([
      supabase.rpc('get_my_stats', { p_user_id: user.id }),
      supabase.rpc('get_monthly_distances', { p_user_id: user.id }),
      supabase.rpc('get_recent_drives', { p_user_id: user.id, p_limit: 10 }),
      supabase.from('vehicles').select('id, name').eq('user_id', user.id).maybeSingle(),
      supabase.from('visited_cities')
        .select('id, city_code, city_name, photo_url')
        .eq('user_id', user.id)
        .order('first_visited_at', { ascending: false }),
      supabase.rpc('get_my_trips', { p_user_id: user.id }),
    ]);

    if (statsRes.data?.[0]) setStats(statsRes.data[0]);
    if (monthlyRes.data) setMonthly(monthlyRes.data);
    if (drivesRes.data) setDrives(drivesRes.data);
    if (vehicleRes.data) setVehicle(vehicleRes.data);
    if (citiesRes.data) setCities(citiesRes.data);
    if (tripsRes.data) {
      const all = tripsRes.data as Trip[];
      setActiveTripState(all.find((t) => !t.ended_at) ?? null);
      setTrips(all.filter((t) => !!t.ended_at));
    }
    setLoading(false);
    setRefreshing(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  const onRefresh = () => { setRefreshing(true); load(); };

  const confirmDelete = async (drive: Drive) => {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    // 이전 pendingDelete가 있으면 실제 삭제 확정
    if (pendingDelete) {
      await supabase.from('route_points').delete().eq('drive_id', pendingDelete.id);
      await supabase.from('drives').delete().eq('id', pendingDelete.id);
    }
    setDrives((prev) => prev.filter((d) => d.id !== drive.id));
    setPendingDelete(drive);
    undoTimerRef.current = setTimeout(async () => {
      await supabase.from('route_points').delete().eq('drive_id', drive.id);
      await supabase.from('drives').delete().eq('id', drive.id);
      setPendingDelete(null);
    }, 5000);
  };

  const undoDelete = () => {
    if (!pendingDelete) return;
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    setDrives((prev) =>
      [...prev, pendingDelete].sort((a, b) =>
        new Date(b.started_at).getTime() - new Date(a.started_at).getTime()
      )
    );
    setPendingDelete(null);
  };

  const startTrip = async () => {
    if (!tripName.trim() || tripSaving) return;
    setTripSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: trip, error } = await supabase
        .from('trips')
        .insert({ user_id: user.id, name: tripName.trim() })
        .select('id, name, started_at, ended_at')
        .single();
      if (error) { Alert.alert('오류', error.message); return; }
      if (trip) {
        const newTrip: Trip = { ...trip, total_distance_km: 0, total_drives: 0 };
        setActiveTripState(newTrip);
        setActiveTripId(newTrip.id);
        setCreatingTrip(false);
        setTripName('');
      }
    } catch (e: any) {
      Alert.alert('오류', e.message ?? String(e));
    } finally {
      setTripSaving(false);
    }
  };

  const deleteTrip = (trip: Trip) => {
    Alert.alert(
      '여행 삭제',
      `"${trip.name}" 여행을 삭제할까요?\n주행 기록은 삭제되지 않아요.`,
      [
        { text: '취소', style: 'cancel' },
        {
          text: '삭제', style: 'destructive', onPress: async () => {
            await supabase.from('trips').delete().eq('id', trip.id);
            setTrips((prev) => prev.filter((t) => t.id !== trip.id));
          },
        },
      ]
    );
  };

  const endTrip = () => {
    if (!activeTrip) return;
    Alert.alert('여행 종료', `"${activeTrip.name}" 여행을 종료할까요?`, [
      { text: '취소', style: 'cancel' },
      {
        text: '종료', style: 'destructive', onPress: async () => {
          const now = new Date().toISOString();
          await supabase.from('trips').update({ ended_at: now }).eq('id', activeTrip.id);
          setTrips((prev) => [{ ...activeTrip, ended_at: now }, ...prev]);
          setActiveTripState(null);
          setActiveTripId(null);
        },
      },
    ]);
  };

  const pickCityPhoto = async (city: VisitedCity) => {
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

    setUploading(city.city_code);
    try {
      const asset = result.assets[0];
      const ext = asset.uri.split('.').pop() ?? 'jpg';
      const path = `${user.id}/${city.city_code}.${ext}`;

      const response = await fetch(asset.uri);
      const blob = await response.blob();
      const arrayBuffer = await new Response(blob).arrayBuffer();

      const { error: uploadError } = await supabase.storage
        .from('city-photos')
        .upload(path, arrayBuffer, { contentType: `image/${ext}`, upsert: true });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('city-photos')
        .getPublicUrl(path);

      const { error: updateError } = await supabase
        .from('visited_cities')
        .update({ photo_url: publicUrl })
        .eq('id', city.id);

      if (updateError) throw updateError;

      setCities((prev) =>
        prev.map((c) => c.id === city.id ? { ...c, photo_url: publicUrl } : c)
      );
    } catch (e: any) {
      Alert.alert('업로드 실패', e.message ?? String(e));
    } finally {
      setUploading(null);
    }
  };

  if (loading) {
    return <View style={s.center}><ActivityIndicator size="large" color={colors.primary} /></View>;
  }

  const maxKm = Math.max(...monthly.map((m) => m.distance_km), 1);

  return (
    <View style={s.container}>
    <ScrollView
      style={s.flex}
      contentContainerStyle={s.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
    >
      <Text style={s.screenTitle}>통계</Text>

      {/* 누적 거리 히어로 */}
      <View style={s.heroCard}>
        <Text style={s.heroLabel}>누적 총 거리</Text>
        <View style={s.heroRow}>
          <Text style={s.heroNum}>{formatKm(stats?.total_distance_km ?? 0)}</Text>
          <Text style={s.heroUnit}>km</Text>
        </View>
      </View>

      {/* 요약 카드 */}
      <View style={s.row}>
        <View style={s.statCard}>
          <Text style={s.statNum}>{stats?.total_drives ?? 0}</Text>
          <Text style={s.statLabel}>총 주행</Text>
        </View>
        <View style={s.statCard}>
          <Text style={s.statNum}>{stats?.visited_cities_count ?? 0}</Text>
          <Text style={s.statLabel}>방문 도시</Text>
        </View>
        <View style={s.statCard}>
          <Text style={s.statNum}>{Math.round(stats?.max_speed_kmh ?? 0)}</Text>
          <Text style={s.statLabel}>최고 속도 km/h</Text>
        </View>
      </View>

      {/* 여행 기록 */}
      <View style={s.card}>
        <Text style={s.cardTitle}>여행 기록</Text>
        {activeTrip ? (
          <View style={s.activeTripCard}>
            <View style={s.activeTripHeader}>
              <View style={s.activeTripDot} />
              <Text style={s.activeTripName}>{activeTrip.name}</Text>
            </View>
            <Text style={s.activeTripStats}>
              {formatKm(activeTrip.total_distance_km)} km · {activeTrip.total_drives}회 주행
            </Text>
            <TouchableOpacity style={s.endTripBtn} onPress={endTrip}>
              <Text style={s.endTripText}>여행 종료</Text>
            </TouchableOpacity>
          </View>
        ) : creatingTrip ? (
          <View style={s.tripForm}>
            <TextInput
              style={s.tripInput}
              value={tripName}
              onChangeText={setTripName}
              placeholder="여행 이름 (예: 제주도 여행)"
              placeholderTextColor={colors.textTertiary}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={startTrip}
            />
            <View style={s.tripFormBtns}>
              <TouchableOpacity onPress={() => { setCreatingTrip(false); setTripName(''); }}>
                <Text style={s.tripCancelText}>취소</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.tripStartBtn, (!tripName.trim() || tripSaving) && { opacity: 0.5 }]}
                onPress={startTrip}
                disabled={!tripName.trim() || tripSaving}
              >
                {tripSaving
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={s.tripStartText}>시작</Text>}
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <TouchableOpacity style={s.createTripBtn} onPress={() => setCreatingTrip(true)}>
            <Text style={s.createTripText}>+ 여행 만들기</Text>
          </TouchableOpacity>
        )}

        {trips.length > 0 && (
          <View style={s.tripList}>
            {trips.map((trip, i) => (
              <View key={trip.id} style={[s.tripRow, i === 0 && { borderTopWidth: 0 }]}>
                <TouchableOpacity style={s.tripRowMain} onPress={() => setSelectedTrip(trip)}>
                  <View style={s.tripRowInfo}>
                    <Text style={s.tripRowName}>{trip.name}</Text>
                    <Text style={s.tripRowDate}>
                      {formatDate(trip.started_at)}{trip.ended_at ? ` - ${formatDate(trip.ended_at)}` : ''}
                    </Text>
                  </View>
                  <Text style={s.tripRowKm}>{formatKm(trip.total_distance_km)} km</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => deleteTrip(trip)} hitSlop={8}>
                  <Text style={s.driveDelete}>✕</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}
      </View>

      {/* 방문 도시 스탬프 */}
      <View style={s.card}>
        <Text style={s.cardTitle}>방문 도시</Text>
        {cities.length === 0 ? (
          <Text style={s.empty}>주행을 마치면 방문한 도시가 기록돼요</Text>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.cityList}>
            {cities.map((city) => (
              <TouchableOpacity
                key={city.id}
                style={s.cityCard}
                onPress={() => pickCityPhoto(city)}
                disabled={uploading === city.city_code}
              >
                {uploading === city.city_code ? (
                  <View style={s.cityImgPlaceholder}>
                    <ActivityIndicator color={colors.primary} />
                  </View>
                ) : city.photo_url ? (
                  <Image source={{ uri: city.photo_url }} style={s.cityImg} />
                ) : (
                  <View style={s.cityImgPlaceholder}>
                    <Text style={s.cityPlaceholderIcon}>+</Text>
                  </View>
                )}
                <Text style={s.cityName} numberOfLines={1}>{city.city_name}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}
      </View>

      {/* 월별 그래프 */}
      <View style={s.card}>
        <Text style={s.cardTitle}>월별 주행 거리</Text>
        {monthly.length === 0 ? (
          <Text style={s.empty}>주행 기록이 없어요</Text>
        ) : (
          <View style={s.chart}>
            {monthly.map((m) => (
              <View key={m.month} style={s.barCol}>
                <Text style={s.barVal}>{formatKm(m.distance_km)}</Text>
                <View style={s.barTrack}>
                  <View style={[s.bar, { height: Math.max((m.distance_km / maxKm) * BAR_MAX_H, 3) }]} />
                </View>
                <Text style={s.barLbl}>{Number(m.month.split('-')[1])}월</Text>
              </View>
            ))}
          </View>
        )}
      </View>

      {/* 내 차량 */}
      <View style={s.card}>
        <Text style={s.cardTitle}>내 차량</Text>
        {vehicle ? (
          <Text style={s.vehicleName}>{vehicle.name}</Text>
        ) : (
          <Text style={s.empty}>등록된 차량이 없어요 → 프로필에서 추가</Text>
        )}
      </View>

      {/* 최근 주행 */}
      <View style={[s.card, { marginBottom: spacing.xl }]}>
        <Text style={s.cardTitle}>최근 주행</Text>
        {drives.length === 0 ? (
          <Text style={s.empty}>완료된 주행이 없어요</Text>
        ) : (
          drives.map((d, i) => (
            <View key={d.id} style={[s.driveRow, i === 0 && { borderTopWidth: 0 }]}>
              <View style={s.driveMain}>
                {(d.start_address || d.end_address) ? (
                  <Text style={s.driveRoute} numberOfLines={1}>
                    {d.start_address ?? '?'} → {d.end_address ?? '?'}
                  </Text>
                ) : null}
                <View style={s.driveInfo}>
                  <Text style={s.driveDate}>{formatDate(d.started_at)}</Text>
                  <Text style={s.driveDur}>{formatDuration(d.started_at, d.ended_at)}</Text>
                  <Text style={s.driveKm}>{formatKm(d.distance_km)} km</Text>
                  {d.max_speed_kmh ? (
                    <Text style={s.driveSpeed}>{Math.round(d.max_speed_kmh)}km/h</Text>
                  ) : null}
                </View>
              </View>
              <TouchableOpacity onPress={() => confirmDelete(d)} hitSlop={8}>
                <Text style={s.driveDelete}>✕</Text>
              </TouchableOpacity>
            </View>
          ))
        )}
      </View>
    </ScrollView>

    {/* 되돌리기 배너 */}
    {pendingDelete && (
      <View style={s.undoBanner}>
        <Text style={s.undoText}>주행 기록이 삭제되었습니다</Text>
        <TouchableOpacity onPress={undoDelete}>
          <Text style={s.undoBtn}>되돌리기</Text>
        </TouchableOpacity>
      </View>
    )}

    {/* 여행 상세 모달 */}
    <Modal visible={!!selectedTrip} animationType="slide" transparent onRequestClose={() => setSelectedTrip(null)}>
      <View style={s.modalOverlay}>
        <View style={s.modalCard}>
          <Text style={s.modalTitle}>{selectedTrip?.name}</Text>
          <Text style={s.modalDate}>
            {selectedTrip ? formatDate(selectedTrip.started_at) : ''}
            {selectedTrip?.ended_at ? ` - ${formatDate(selectedTrip.ended_at)}` : ''}
          </Text>
          <View style={s.modalStats}>
            <View style={s.modalStatItem}>
              <Text style={s.modalStatNum}>{formatKm(selectedTrip?.total_distance_km ?? 0)}</Text>
              <Text style={s.modalStatLabel}>km</Text>
            </View>
            <View style={s.modalDivider} />
            <View style={s.modalStatItem}>
              <Text style={s.modalStatNum}>{selectedTrip?.total_drives ?? 0}</Text>
              <Text style={s.modalStatLabel}>회 주행</Text>
            </View>
          </View>
          <TouchableOpacity style={s.modalCloseBtn} onPress={() => setSelectedTrip(null)}>
            <Text style={s.modalCloseText}>닫기</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  content: { padding: spacing.md, paddingTop: 56, gap: spacing.sm },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },

  screenTitle: { ...typography.title, marginBottom: spacing.sm },

  heroCard: { backgroundColor: colors.primary, borderRadius: radius.lg, padding: spacing.lg },
  heroLabel: { fontSize: 13, color: 'rgba(255,255,255,0.75)', marginBottom: spacing.xs },
  heroRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  heroNum: { fontSize: 56, fontWeight: '800', color: '#fff', lineHeight: 64 },
  heroUnit: { fontSize: 18, color: 'rgba(255,255,255,0.75)', marginBottom: 6 },

  row: { flexDirection: 'row', gap: spacing.sm },
  statCard: { flex: 1, backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md, gap: 4 },
  statNum: { fontSize: 28, fontWeight: '700', color: colors.text },
  statLabel: { ...typography.label },

  card: { backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  cardTitle: { ...typography.heading },
  empty: { ...typography.label, textAlign: 'center', paddingVertical: spacing.sm },

  cityList: { gap: spacing.sm, paddingVertical: 4 },
  cityCard: { width: 88, alignItems: 'center', gap: 6 },
  cityImg: { width: 80, height: 80, borderRadius: radius.md },
  cityImgPlaceholder: {
    width: 80, height: 80, borderRadius: radius.md,
    backgroundColor: colors.background,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: colors.divider, borderStyle: 'dashed',
  },
  cityPlaceholderIcon: { fontSize: 24, color: colors.textTertiary },
  cityName: { fontSize: 11, color: colors.textSecondary, textAlign: 'center', fontWeight: '500' },

  chart: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, paddingTop: 4 },
  barCol: { flex: 1, alignItems: 'center', gap: 4 },
  barVal: { fontSize: 9, color: colors.textTertiary },
  barTrack: { width: '100%', height: BAR_MAX_H, justifyContent: 'flex-end' },
  bar: { backgroundColor: colors.primary, borderRadius: 4, width: '100%', opacity: 0.9 },
  barLbl: { fontSize: 10, color: colors.textSecondary },

  vehicleName: { fontSize: 17, fontWeight: '600', color: colors.text },

  driveRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 12, borderTopWidth: 1, borderTopColor: colors.divider,
  },
  driveDate: { width: 44, ...typography.label },
  driveDur: { flex: 1, ...typography.body, color: colors.textSecondary },
  driveKm: { fontSize: 15, fontWeight: '600', color: colors.primary },
  driveSpeed: { fontSize: 12, color: colors.textTertiary, width: 52, textAlign: 'right' },
  driveDelete: { fontSize: 14, color: colors.textTertiary, paddingLeft: 8 },
  driveMain: { flex: 1, gap: 2 },
  driveRoute: { fontSize: 13, fontWeight: '600', color: colors.text },
  driveInfo: { flexDirection: 'row', alignItems: 'center', gap: 8 },

  undoBanner: {
    position: 'absolute', bottom: 80, left: spacing.md, right: spacing.md,
    backgroundColor: colors.text, borderRadius: radius.md,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingVertical: 14,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2, shadowRadius: 6, elevation: 6,
  },
  undoText: { fontSize: 14, color: '#fff' },
  undoBtn: { fontSize: 14, fontWeight: '700', color: colors.primary },

  activeTripCard: { gap: spacing.sm },
  activeTripHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  activeTripDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary },
  activeTripName: { fontSize: 16, fontWeight: '700', color: colors.text },
  activeTripStats: { fontSize: 13, color: colors.textSecondary },
  endTripBtn: {
    backgroundColor: colors.danger, borderRadius: radius.sm,
    paddingHorizontal: spacing.md, paddingVertical: 8, alignSelf: 'flex-start',
  },
  endTripText: { fontSize: 14, fontWeight: '600', color: '#fff' },

  tripForm: { gap: spacing.sm },
  tripInput: {
    borderWidth: 1, borderColor: colors.divider, borderRadius: radius.sm,
    paddingHorizontal: spacing.md, paddingVertical: 10,
    fontSize: 15, color: colors.text, backgroundColor: colors.background,
  },
  tripFormBtns: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, alignItems: 'center' },
  tripCancelText: { fontSize: 14, color: colors.textSecondary },
  tripStartBtn: {
    backgroundColor: colors.primary, borderRadius: radius.sm,
    paddingHorizontal: spacing.md, paddingVertical: 8, minWidth: 56, alignItems: 'center',
  },
  tripStartText: { fontSize: 14, fontWeight: '600', color: '#fff' },
  createTripBtn: { alignSelf: 'flex-start' },
  createTripText: { fontSize: 14, fontWeight: '600', color: colors.primary },

  tripList: { borderTopWidth: 1, borderTopColor: colors.divider, marginTop: spacing.xs },
  tripRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 12,
    borderTopWidth: 1, borderTopColor: colors.divider,
  },
  tripRowMain: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  tripRowInfo: { flex: 1, gap: 2 },
  tripRowName: { fontSize: 14, fontWeight: '600', color: colors.text },
  tripRowDate: { fontSize: 12, color: colors.textTertiary },
  tripRowKm: { fontSize: 14, fontWeight: '600', color: colors.primary },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalCard: {
    backgroundColor: colors.card, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg,
    padding: spacing.lg, gap: spacing.md,
  },
  modalTitle: { fontSize: 20, fontWeight: '700', color: colors.text },
  modalDate: { fontSize: 13, color: colors.textTertiary },
  modalStats: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around',
    paddingVertical: spacing.md, borderTopWidth: 1, borderTopColor: colors.divider,
    borderBottomWidth: 1, borderBottomColor: colors.divider,
  },
  modalStatItem: { alignItems: 'center', gap: 4 },
  modalStatNum: { fontSize: 32, fontWeight: '800', color: colors.text },
  modalStatLabel: { fontSize: 13, color: colors.textSecondary },
  modalDivider: { width: 1, height: 40, backgroundColor: colors.divider },
  modalCloseBtn: {
    backgroundColor: colors.background, borderRadius: radius.sm,
    paddingVertical: 12, alignItems: 'center',
  },
  modalCloseText: { fontSize: 15, fontWeight: '600', color: colors.text },
});
