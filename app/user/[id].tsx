import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Image } from 'react-native';
import { useLocalSearchParams, useFocusEffect, router } from 'expo-router';
import { supabase } from '../../src/services/supabase';
import { colors, spacing, radius, typography } from '../../src/theme';

type PublicProfile = { username: string; tag: string; avatar_url: string | null; best_zero_to_hundred_s: number | null };

export default function UserProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [bestSpeedKmh, setBestSpeedKmh] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useFocusEffect(useCallback(() => {
    if (!id) return;
    setLoading(true);
    (async () => {
      const [profileRes, statsRes] = await Promise.all([
        supabase.from('profiles').select('username, tag, avatar_url, best_zero_to_hundred_s').eq('id', id).single(),
        supabase.rpc('get_my_stats', { p_user_id: id }),
      ]);
      if (profileRes.data) setProfile(profileRes.data);
      if (statsRes.data?.[0]) setBestSpeedKmh(statsRes.data[0].max_speed_kmh ?? null);
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

          <View style={s.card}>
            <Text style={s.cardTitle}>기록</Text>
            <View style={s.recordRow}>
              <View style={s.recordItem}>
                <Text style={s.recordValue}>
                  {bestSpeedKmh ? Math.round(bestSpeedKmh) : '-'}
                  <Text style={s.recordUnit}> km/h</Text>
                </Text>
                <Text style={s.recordLabel}>최고속도</Text>
              </View>
              <View style={s.recordDivider} />
              <View style={s.recordItem}>
                <Text style={s.recordValue}>
                  {profile.best_zero_to_hundred_s ? profile.best_zero_to_hundred_s.toFixed(1) : '-'}
                  <Text style={s.recordUnit}> 초</Text>
                </Text>
                <Text style={s.recordLabel}>제로백</Text>
              </View>
            </View>
          </View>
        </View>
      )}
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

  card: {
    width: '100%', backgroundColor: colors.card, borderRadius: radius.md,
    padding: spacing.md, gap: spacing.sm,
  },
  cardTitle: { ...typography.heading },
  recordRow: { flexDirection: 'row', alignItems: 'center' },
  recordItem: { flex: 1, alignItems: 'center', gap: 4 },
  recordDivider: { width: 1, height: 36, backgroundColor: colors.divider },
  recordValue: { fontSize: 20, fontWeight: '700', color: colors.text },
  recordUnit: { fontSize: 13, fontWeight: '400', color: colors.textSecondary },
  recordLabel: { ...typography.label },
});
