import { useCallback, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, Alert, ActivityIndicator, Platform,
} from 'react-native';
import { useFocusEffect, router } from 'expo-router';
import { supabase } from '../../src/services/supabase';
import { colors, spacing, radius, typography } from '../../src/theme';

type Profile = { id: string; username: string };
type Vehicle = { id: string; name: string; bt_device_name: string | null };

export default function ProfileScreen() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [vehicleName, setVehicleName] = useState('');
  const [btDeviceName, setBtDeviceName] = useState('');
  const [editingVehicle, setEditingVehicle] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isKakaoUser, setIsKakaoUser] = useState(false);

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const [profileRes, vehicleRes] = await Promise.all([
      supabase.from('profiles').select('id, username').eq('id', user.id).single(),
      supabase.from('vehicles').select('id, name, bt_device_name').eq('user_id', user.id).maybeSingle(),
    ]);

    setIsKakaoUser(!!user.user_metadata?.kakao_id);
    if (profileRes.data) setProfile(profileRes.data);
    if (vehicleRes.data) {
      setVehicle(vehicleRes.data);
      setVehicleName(vehicleRes.data.name ?? '');
      setBtDeviceName(vehicleRes.data.bt_device_name ?? '');
    }
    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const startEditing = () => {
    setVehicleName(vehicle?.name ?? '');
    setBtDeviceName(vehicle?.bt_device_name ?? '');
    setEditingVehicle(true);
  };

  const saveVehicle = async () => {
    if (!vehicleName.trim()) return;
    setSaving(true);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const payload = {
      user_id: user.id,
      name: vehicleName.trim(),
      bt_device_name: btDeviceName.trim() || null,
    };
    let error;

    if (vehicle) {
      ({ error } = await supabase.from('vehicles').update({
        name: vehicleName.trim(),
        bt_device_name: btDeviceName.trim() || null,
      }).eq('id', vehicle.id));
    } else {
      const res = await supabase.from('vehicles').insert(payload).select('id, name, bt_device_name').single();
      error = res.error;
      if (res.data) setVehicle(res.data);
    }

    if (error) {
      Alert.alert('오류', error.message);
    } else {
      setVehicle((v) => v
        ? { ...v, name: vehicleName.trim(), bt_device_name: btDeviceName.trim() || null }
        : { id: '', name: vehicleName.trim(), bt_device_name: btDeviceName.trim() || null }
      );
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
        <Text style={s.userSub}>{isKakaoUser ? '카카오 계정' : '익명 계정'}</Text>
      </View>

      {/* 내 차량 */}
      <View style={s.card}>
        <View style={s.cardHeader}>
          <Text style={s.cardTitle}>내 차량</Text>
          {!editingVehicle && (
            <TouchableOpacity onPress={startEditing}>
              <Text style={s.editBtn}>{vehicle ? '수정' : '+ 추가'}</Text>
            </TouchableOpacity>
          )}
        </View>

        {editingVehicle ? (
          <View style={s.editGroup}>
            <Text style={s.fieldLabel}>차량 이름</Text>
            <TextInput
              style={s.input}
              value={vehicleName}
              onChangeText={setVehicleName}
              placeholder="예: 2023 현대 아반떼"
              placeholderTextColor={colors.textTertiary}
              autoFocus
              returnKeyType="next"
            />
            {Platform.OS === 'android' && (
              <>
                <Text style={s.fieldLabel}>블루투스 기기명 <Text style={s.fieldSub}>(자동 주행 감지용)</Text></Text>
                <TextInput
                  style={s.input}
                  value={btDeviceName}
                  onChangeText={setBtDeviceName}
                  placeholder="예: My Car, HYUNDAI AV"
                  placeholderTextColor={colors.textTertiary}
                  returnKeyType="done"
                  onSubmitEditing={saveVehicle}
                />
                <Text style={s.fieldHint}>설정 → 블루투스에서 차량 기기 이름을 확인하세요</Text>
              </>
            )}
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
          <View style={s.vehicleInfo}>
            <Text style={s.vehicleName}>{vehicle.name}</Text>
            {Platform.OS === 'android' && vehicle.bt_device_name && (
              <Text style={s.btDeviceName}>BT: {vehicle.bt_device_name}</Text>
            )}
          </View>
        ) : (
          <Text style={s.empty}>등록된 차량이 없어요</Text>
        )}
      </View>

      {/* 자동 주행 감지 */}
      <View style={s.card}>
        <Text style={s.cardTitle}>자동 주행 감지</Text>
        <Text style={s.guideDesc}>
          별도 설정 없이 자동으로 주행을 감지합니다.{'\n'}
          위치 권한을 "항상 허용"으로 설정해야 백그라운드에서 동작합니다.
        </Text>
        <View style={s.autoInfoList}>
          <Text style={s.autoInfoItem}>▶ 시작: 25km/h 이상으로 30초 이상 주행</Text>
          <Text style={s.autoInfoItem}>⏹ 종료: 5분 정차 시 알림 → 10분 시 자동 종료</Text>
        </View>
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

  vehicleInfo: { gap: 4 },
  vehicleName: { fontSize: 17, fontWeight: '600', color: colors.text },
  btDeviceName: { fontSize: 13, color: colors.textTertiary },
  empty: { ...typography.label, paddingVertical: spacing.xs },

  editGroup: { gap: spacing.xs },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: colors.textSecondary, marginTop: spacing.xs },
  fieldSub: { fontWeight: '400', color: colors.textTertiary },
  fieldHint: { fontSize: 12, color: colors.textTertiary },
  input: {
    height: 44, borderRadius: radius.sm,
    backgroundColor: colors.background, paddingHorizontal: spacing.sm,
    fontSize: 15, color: colors.text,
  },
  saveBtn: {
    backgroundColor: colors.primary, borderRadius: radius.sm,
    height: 44, alignItems: 'center', justifyContent: 'center',
    marginTop: spacing.xs,
  },
  saveBtnText: { color: '#fff', fontWeight: '600', fontSize: 14 },

  guideDesc: { ...typography.label, lineHeight: 20 },
  autoInfoList: { gap: 6, marginTop: 4 },
  autoInfoItem: { fontSize: 13, color: colors.textSecondary, lineHeight: 20 },

  logoutBtn: {
    marginTop: spacing.sm, padding: spacing.md,
    alignItems: 'center', borderRadius: radius.md,
    backgroundColor: colors.card,
  },
  logoutText: { fontSize: 15, fontWeight: '600', color: colors.danger },
});
