import { useCallback, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, Alert, ActivityIndicator,
} from 'react-native';
import { useFocusEffect, router } from 'expo-router';
import { supabase } from '../../src/services/supabase';
import { colors, spacing, radius, typography } from '../../src/theme';

type Profile = { id: string; username: string };
type Vehicle = { id: string; name: string };

export default function ProfileScreen() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [vehicleName, setVehicleName] = useState('');
  const [editingVehicle, setEditingVehicle] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const [profileRes, vehicleRes] = await Promise.all([
      supabase.from('profiles').select('id, username').eq('id', user.id).single(),
      supabase.from('vehicles').select('id, name').eq('user_id', user.id).maybeSingle(),
    ]);

    if (profileRes.data) setProfile(profileRes.data);
    if (vehicleRes.data) {
      setVehicle(vehicleRes.data);
      setVehicleName(vehicleRes.data.name ?? '');
    }
    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const saveVehicle = async () => {
    if (!vehicleName.trim()) return;
    setSaving(true);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const payload = { user_id: user.id, name: vehicleName.trim() };
    let error;

    if (vehicle) {
      ({ error } = await supabase.from('vehicles').update({ name: vehicleName.trim() }).eq('id', vehicle.id));
    } else {
      const res = await supabase.from('vehicles').insert(payload).select('id, name').single();
      error = res.error;
      if (res.data) setVehicle(res.data);
    }

    if (error) {
      Alert.alert('오류', error.message);
    } else {
      setVehicle((v) => v ? { ...v, name: vehicleName.trim() } : { id: '', name: vehicleName.trim() });
      setEditingVehicle(false);
    }
    setSaving(false);
  };

  const handleLogout = () => {
    Alert.alert('로그아웃', '정말 로그아웃하시겠어요?', [
      { text: '취소', style: 'cancel' },
      {
        text: '로그아웃', style: 'destructive',
        onPress: async () => {
          await supabase.auth.signOut();
          router.replace('/(auth)/login');
        },
      },
    ]);
  };

  if (loading) {
    return <View style={s.center}><ActivityIndicator size="large" color={colors.primary} /></View>;
  }

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content}>
      <Text style={s.screenTitle}>프로필</Text>

      {/* 사용자 정보 */}
      <View style={s.card}>
        <View style={s.avatarCircle}>
          <Text style={s.avatarText}>{(profile?.username ?? '?')[0].toUpperCase()}</Text>
        </View>
        <Text style={s.username}>{profile?.username ?? '게스트'}</Text>
        <Text style={s.userSub}>익명 계정 · 카카오 연동 준비 중</Text>
      </View>

      {/* 내 차량 */}
      <View style={s.card}>
        <View style={s.cardHeader}>
          <Text style={s.cardTitle}>내 차량</Text>
          {!editingVehicle && (
            <TouchableOpacity onPress={() => setEditingVehicle(true)}>
              <Text style={s.editBtn}>{vehicle ? '수정' : '+ 추가'}</Text>
            </TouchableOpacity>
          )}
        </View>

        {editingVehicle ? (
          <View style={s.inputRow}>
            <TextInput
              style={s.input}
              value={vehicleName}
              onChangeText={setVehicleName}
              placeholder="예: 2023 현대 아반떼"
              placeholderTextColor={colors.textTertiary}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={saveVehicle}
            />
            <TouchableOpacity
              style={[s.saveBtn, saving && { opacity: 0.6 }]}
              onPress={saveVehicle}
              disabled={saving}
            >
              {saving
                ? <ActivityIndicator size="small" color="#fff" />
                : <Text style={s.saveBtnText}>저장</Text>}
            </TouchableOpacity>
          </View>
        ) : vehicle ? (
          <Text style={s.vehicleName}>{vehicle.name}</Text>
        ) : (
          <Text style={s.empty}>등록된 차량이 없어요</Text>
        )}
      </View>

      {/* 로그아웃 */}
      <TouchableOpacity style={s.logoutBtn} onPress={handleLogout}>
        <Text style={s.logoutText}>로그아웃</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, paddingTop: 56, gap: spacing.sm, paddingBottom: spacing.xl },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },

  screenTitle: { ...typography.title, marginBottom: spacing.sm },

  card: { backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { ...typography.heading },
  editBtn: { fontSize: 14, fontWeight: '600', color: colors.primary },

  avatarCircle: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: colors.primary, alignSelf: 'center',
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontSize: 28, fontWeight: '700', color: '#fff' },
  username: { fontSize: 20, fontWeight: '700', color: colors.text, textAlign: 'center' },
  userSub: { ...typography.label, textAlign: 'center' },

  vehicleName: { fontSize: 17, fontWeight: '600', color: colors.text },
  empty: { ...typography.label, paddingVertical: spacing.xs },

  inputRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  input: {
    flex: 1, height: 44, borderRadius: radius.sm,
    backgroundColor: colors.background, paddingHorizontal: spacing.sm,
    fontSize: 15, color: colors.text,
  },
  saveBtn: {
    backgroundColor: colors.primary, borderRadius: radius.sm,
    height: 44, paddingHorizontal: spacing.md,
    alignItems: 'center', justifyContent: 'center',
  },
  saveBtnText: { color: '#fff', fontWeight: '600', fontSize: 14 },

  logoutBtn: {
    marginTop: spacing.sm, padding: spacing.md,
    alignItems: 'center', borderRadius: radius.md,
    backgroundColor: colors.card,
  },
  logoutText: { fontSize: 15, fontWeight: '600', color: colors.danger },
});
