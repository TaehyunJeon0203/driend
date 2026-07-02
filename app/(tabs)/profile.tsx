import { useCallback, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, Alert, ActivityIndicator, Linking, Platform,
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

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const [profileRes, vehicleRes] = await Promise.all([
      supabase.from('profiles').select('id, username').eq('id', user.id).single(),
      supabase.from('vehicles').select('id, name, bt_device_name').eq('user_id', user.id).maybeSingle(),
    ]);

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
        <Text style={s.userSub}>익명 계정 · 카카오 연동 준비 중</Text>
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
      {Platform.OS === 'ios' ? (
        <View style={s.card}>
          <Text style={s.cardTitle}>자동 주행 감지 (iOS)</Text>
          <Text style={s.guideDesc}>
            CarPlay 또는 차량 블루투스 연결 시 자동으로 주행이 시작되도록 단축어를 설정하세요.
            한 번만 설정하면 이후 완전 자동으로 동작합니다.
          </Text>
          <Text style={s.guideSubTitle}>CarPlay 자동화 (권장)</Text>
          <View style={s.steps}>
            {[
              '단축어 앱 → 자동화 탭 → + 버튼',
              'CarPlay → 연결됨',
              '동작 추가 → URL 열기 → driend://start-drive',
              '실행 전 확인 끄기 → 완료',
              '(선택) CarPlay 해제 시 → driend://stop-drive 동일하게 설정',
            ].map((step, i) => (
              <View key={i} style={s.step}>
                <Text style={s.stepNum}>{i + 1}</Text>
                <Text style={s.stepText}>{step}</Text>
              </View>
            ))}
          </View>
          <Text style={s.guideSubTitle}>블루투스 자동화 (CarPlay 미사용 시)</Text>
          <View style={s.steps}>
            {[
              '단축어 앱 → 자동화 탭 → + 버튼',
              '블루투스 → 차량 기기 선택 → 연결됨',
              '동작 추가 → URL 열기 → driend://start-drive',
              '실행 전 확인 끄기',
            ].map((step, i) => (
              <View key={i} style={s.step}>
                <Text style={s.stepNum}>{i + 1}</Text>
                <Text style={s.stepText}>{step}</Text>
              </View>
            ))}
          </View>
          <TouchableOpacity style={s.shortcutsBtn} onPress={() => Linking.openURL('shortcuts://')}>
            <Text style={s.shortcutsBtnText}>단축어 앱 열기</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={s.card}>
          <Text style={s.cardTitle}>자동 주행 감지 (Android)</Text>
          <Text style={s.guideDesc}>
            차량 블루투스 기기명을 등록하면, 해당 기기가 연결될 때 자동으로 주행이 시작됩니다.
          </Text>
          {vehicle?.bt_device_name ? (
            <View style={s.btRegistered}>
              <Text style={s.btRegisteredText}>✓ {vehicle.bt_device_name} 등록됨</Text>
              <TouchableOpacity onPress={startEditing}>
                <Text style={s.editBtn}>변경</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity style={s.shortcutsBtn} onPress={startEditing}>
              <Text style={s.shortcutsBtnText}>블루투스 기기명 등록</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

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
  guideSubTitle: { fontSize: 13, fontWeight: '700', color: colors.text, marginTop: spacing.xs },
  steps: { gap: spacing.xs },
  step: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  stepNum: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: colors.primaryLight, textAlign: 'center',
    fontSize: 12, fontWeight: '700', color: colors.primary, lineHeight: 22,
  },
  stepText: { flex: 1, fontSize: 13, color: colors.text, lineHeight: 20 },
  shortcutsBtn: {
    marginTop: spacing.xs, backgroundColor: colors.primary,
    borderRadius: radius.sm, padding: spacing.sm + 2, alignItems: 'center',
  },
  shortcutsBtnText: { color: '#fff', fontWeight: '600', fontSize: 14 },

  btRegistered: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.background,
    borderRadius: radius.sm, padding: spacing.sm,
  },
  btRegisteredText: { fontSize: 14, fontWeight: '600', color: colors.primary },

  logoutBtn: {
    marginTop: spacing.sm, padding: spacing.md,
    alignItems: 'center', borderRadius: radius.md,
    backgroundColor: colors.card,
  },
  logoutText: { fontSize: 15, fontWeight: '600', color: colors.danger },
});
