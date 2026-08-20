import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Image } from 'react-native';
import { useLocalSearchParams, useFocusEffect, router } from 'expo-router';
import { supabase } from '../../src/services/supabase';
import { colors, spacing, radius, typography } from '../../src/theme';

type PublicProfile = { username: string; tag: string; avatar_url: string | null; best_zero_to_hundred_s: number | null };
type Vehicle = { make: string | null; name: string };
type PublicStats = {
  total_distance_km: number;
  total_drives: number;
  visited_cities_count: number;
  monthly_distance_km: number;
  longest_drive_km: number;
  avg_distance_km: number;
  max_speed_kmh: number;
};

export default function UserProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [stats, setStats] = useState<PublicStats | null>(null);
  const [loading, setLoading] = useState(true);

  useFocusEffect(useCallback(() => {
    if (!id) return;
    setLoading(true);
    (async () => {
      const [profileRes, vehicleRes, statsRes] = await Promise.all([
        supabase.from('profiles').select('username, tag, avatar_url, best_zero_to_hundred_s').eq('id', id).single(),
        supabase.rpc('get_public_user_vehicle', { p_user_id: id }),
        supabase.rpc('get_public_user_stats', { p_user_id: id }),
      ]);
      if (profileRes.data) setProfile(profileRes.data);
      if (vehicleRes.data?.[0]) setVehicle(vehicleRes.data[0]);
      if (statsRes.data?.[0]) setStats(statsRes.data[0]);
      setLoading(false);
    })();
  }, [id]));

  return (
    <View style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={s.backBtn}>‹ 뒤로</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={s.center}><ActivityIndicator color={colors.primary} /></View>
      ) : !profile ? (
        <View style={s.center}><Text style={s.empty}>사용자를 찾을 수 없어요</Text></View>
      ) : (
        <View style={s.content}>
          <View style={s.avatarCircle}>
            {profile.avatar_url ? (
              <Image source={{ uri: profile.avatar_url }} style={s.avatarImage} />
            ) : (
              <Text style={s.avatarText}>{profile.username[0]?.toUpperCase()}</Text>
            )}
           </View>
           <Text style={s.username}>{profile.username}<Text style={s.usernameTag}>#{profile.tag}</Text></Text>

           <View style={s.vehiclePill}>
             <Text style={s.vehicleIcon}>⌁</Text>
             <Text style={s.vehicleText}>{vehicle ? `${vehicle.make ? `${vehicle.make} ` : ''}${vehicle.name}` : '등록된 차량 없음'}</Text>
           </View>

           <View style={s.card}>
             <Text style={s.cardTitle}>주행 기록</Text>
             <View style={s.recordGrid}>
               <ProfileStat label="누적 거리" value={formatDistance(stats?.total_distance_km)} unit="km" />
               <ProfileStat label="이번 달" value={formatDistance(stats?.monthly_distance_km)} unit="km" />
               <ProfileStat label="최장 주행" value={formatDistance(stats?.longest_drive_km)} unit="km" />
               <ProfileStat label="총 주행" value={formatCount(stats?.total_drives)} unit="회" />
               <ProfileStat label="방문 도시" value={formatCount(stats?.visited_cities_count)} unit="곳" />
               <ProfileStat label="평균 거리" value={formatDistance(stats?.avg_distance_km)} unit="km" />
               <ProfileStat label="최고속도" value={formatCount(stats?.max_speed_kmh)} unit="km/h" />
               <ProfileStat label="제로백" value={profile.best_zero_to_hundred_s == null ? '-' : profile.best_zero_to_hundred_s.toFixed(1)} unit="초" />
             </View>
           </View>
        </View>
      )}
    </View>
  );
}

function formatDistance(value: number | null | undefined) {
  if (value == null) return '-';
  return value.toLocaleString('en-US', { maximumFractionDigits: 1 });
}

function formatCount(value: number | null | undefined) {
  if (value == null) return '-';
  return Math.round(value).toLocaleString('en-US');
}

function ProfileStat({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <View style={s.recordItem}>
      <Text style={s.recordValue}>{value}<Text style={s.recordUnit}> {unit}</Text></Text>
      <Text style={s.recordLabel}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { paddingTop: 56, paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  backBtn: { fontSize: 16, fontWeight: '600', color: colors.primary },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { ...typography.label },
  content: { padding: spacing.md, alignItems: 'center', gap: spacing.md },

  avatarCircle: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontSize: 28, fontWeight: '700', color: '#fff' },
  avatarImage: { width: 72, height: 72, borderRadius: 36 },
  username: { fontSize: 20, fontWeight: '700', color: colors.text },
  usernameTag: { fontWeight: '400', color: colors.textTertiary },
  vehiclePill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: 20, backgroundColor: colors.card },
  vehicleIcon: { fontSize: 18, color: colors.primary, fontWeight: '700' },
  vehicleText: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },

  card: {
    width: '100%', backgroundColor: colors.card, borderRadius: radius.md,
    padding: spacing.md, gap: spacing.sm,
  },
  cardTitle: { ...typography.heading },
  recordGrid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: spacing.lg },
  recordItem: { width: '50%', alignItems: 'center', gap: 4 },
  recordValue: { fontSize: 20, fontWeight: '700', color: colors.text },
  recordUnit: { fontSize: 13, fontWeight: '400', color: colors.textSecondary },
  recordLabel: { ...typography.label },
});
