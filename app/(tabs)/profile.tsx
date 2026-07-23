import { useCallback, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, Alert, ActivityIndicator, Platform, Switch,
} from 'react-native';
import { useFocusEffect, router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../../src/services/supabase';
import {
  DRIVE_DETECT_NOTIFICATION_KEY, startMonitoring,
} from '../../src/services/locationTracker';
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
  const [driveDetectEnabled, setDriveDetectEnabled] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return;
      const user = session.user;

      const [profileRes, vehicleRes, detectVal] = await Promise.all([
        supabase.from('profiles').select('id, username').eq('id', user.id).single(),
        supabase.from('vehicles').select('id, name, bt_device_name').eq('user_id', user.id).maybeSingle(),
        AsyncStorage.getItem(DRIVE_DETECT_NOTIFICATION_KEY),
      ]);

      setDriveDetectEnabled(detectVal === 'true');
      setIsKakaoUser(!!user.user_metadata?.kakao_id);
      if (profileRes.data) setProfile(profileRes.data);
      if (vehicleRes.data) {
        setVehicle(vehicleRes.data);
        setVehicleName(vehicleRes.data.name ?? '');
        setBtDeviceName(vehicleRes.data.bt_device_name ?? '');
      }
    } finally {
      setLoading(false);
    }
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

    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return;

    const payload = {
      user_id: session.user.id,
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

  const toggleDriveDetect = async (value: boolean) => {
    setDriveDetectEnabled(value);
    await AsyncStorage.setItem(DRIVE_DETECT_NOTIFICATION_KEY, value ? 'true' : 'false');
    if (value) startMonitoring();
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

  const handleDeleteAccount = () => {
    Alert.alert(
      '회원 탈퇴',
      '주행 기록, 지역 사진, 친구 관계 등 모든 데이터가 영구적으로 삭제되며 복구할 수 없습니다. 정말 탈퇴하시겠어요?',
      [
        { text: '취소', style: 'cancel' },
        { text: '탈퇴하기', style: 'destructive', onPress: confirmDeleteAccount },
      ]
    );
  };

  const confirmDeleteAccount = async () => {
    setDeleting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const res = await fetch(
        `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/delete-account`,
        { method: 'POST', headers: { Authorization: `Bearer ${session.access_token}` } }
      );
      if (!res.ok) throw new Error(await res.text());

      await supabase.auth.signOut();
      router.replace('/(auth)/login');
    } catch (e: any) {
      Alert.alert('오류', '계정 삭제 중 문제가 발생했습니다. 잠시 후 다시 시도해주세요.');
    } finally {
      setDeleting(false);
    }
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

      {/* 주행 감지 알림 */}
      <View style={s.card}>
        <View style={s.cardHeader}>
          <Text style={s.cardTitle}>주행 감지 알림</Text>
          <Switch
            value={driveDetectEnabled}
            onValueChange={toggleDriveDetect}
            trackColor={{ false: colors.textTertiary, true: colors.primary }}
            thumbColor="#fff"
          />
        </View>
        <Text style={s.guideDesc}>
          주행 중인 것 같을 때 알림을 보내드려요. 알림을 탭하면 바로 기록을 시작할 수 있어요.
        </Text>
        {driveDetectEnabled && (
          <Text style={s.fieldHint}>
            위치 권한을 "항상 허용"으로 설정해야 백그라운드에서 동작합니다.
          </Text>
        )}
      </View>

      {/* 로그아웃 */}
      <TouchableOpacity style={s.logoutBtn} onPress={handleLogout}>
        <Text style={s.logoutText}>로그아웃</Text>
      </TouchableOpacity>

      {/* 회원 탈퇴 */}
      <TouchableOpacity
        style={s.deleteBtn}
        onPress={handleDeleteAccount}
        disabled={deleting}
      >
        {deleting
          ? <ActivityIndicator size="small" color={colors.textTertiary} />
          : <Text style={s.deleteText}>회원 탈퇴</Text>}
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

  deleteBtn: {
    marginTop: spacing.xs, padding: spacing.sm,
    alignItems: 'center', borderRadius: radius.md,
  },
  deleteText: { fontSize: 13, fontWeight: '500', color: colors.textTertiary },
});
