import { useCallback, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet,
  RefreshControl, ActivityIndicator,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { supabase } from '../../src/services/supabase';
import { colors, spacing, radius, typography } from '../../src/theme';

type Stats = { total_distance_km: number; total_drives: number; visited_cities_count: number };
type MonthlyData = { month: string; distance_km: number };
type Drive = { id: string; started_at: string; ended_at: string | null; distance_km: number | null };
type Vehicle = { id: string; name: string; photo_url: string | null };

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
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const [statsRes, monthlyRes, drivesRes, vehicleRes] = await Promise.all([
      supabase.rpc('get_my_stats', { p_user_id: user.id }),
      supabase.rpc('get_monthly_distances', { p_user_id: user.id }),
      supabase.rpc('get_recent_drives', { p_user_id: user.id, p_limit: 10 }),
      supabase.from('vehicles').select('*').eq('user_id', user.id).maybeSingle(),
    ]);

    if (statsRes.data?.[0]) setStats(statsRes.data[0]);
    if (monthlyRes.data) setMonthly(monthlyRes.data);
    if (drivesRes.data) setDrives(drivesRes.data);
    if (vehicleRes.data) setVehicle(vehicleRes.data);
    setLoading(false);
    setRefreshing(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  const onRefresh = () => { setRefreshing(true); load(); };

  if (loading) {
    return <View style={s.center}><ActivityIndicator size="large" color={colors.primary} /></View>;
  }

  const maxKm = Math.max(...monthly.map((m) => m.distance_km), 1);

  return (
    <ScrollView
      style={s.container}
      contentContainerStyle={s.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
    >
      {/* 헤더 */}
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
              <Text style={s.driveDate}>{formatDate(d.started_at)}</Text>
              <Text style={s.driveDur}>{formatDuration(d.started_at, d.ended_at)}</Text>
              <Text style={s.driveKm}>{formatKm(d.distance_km)} km</Text>
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, paddingTop: 56, gap: spacing.sm },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },

  screenTitle: { ...typography.title, marginBottom: spacing.sm },

  heroCard: {
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  heroLabel: { fontSize: 13, color: 'rgba(255,255,255,0.75)', marginBottom: spacing.xs },
  heroRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  heroNum: { fontSize: 56, fontWeight: '800', color: '#fff', lineHeight: 64 },
  heroUnit: { fontSize: 18, color: 'rgba(255,255,255,0.75)', marginBottom: 6 },

  row: { flexDirection: 'row', gap: spacing.sm },
  statCard: {
    flex: 1, backgroundColor: colors.card, borderRadius: radius.md,
    padding: spacing.md, gap: 4,
  },
  statNum: { fontSize: 28, fontWeight: '700', color: colors.text },
  statLabel: { ...typography.label },

  card: { backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  cardTitle: { ...typography.heading },
  empty: { ...typography.label, textAlign: 'center', paddingVertical: spacing.sm },

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
});
