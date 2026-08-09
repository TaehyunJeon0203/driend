import { useCallback, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, Image,
  StyleSheet, Alert, ActivityIndicator, Platform, Switch,
} from 'react-native';
import { useFocusEffect, router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../../src/services/supabase';
import {
  DRIVE_DETECT_NOTIFICATION_KEY, startMonitoring,
} from '../../src/services/locationTracker';
import { uploadAvatar } from '../../src/services/avatar';
import OnboardingTip from '../../src/components/OnboardingTip';
import { colors, spacing, radius, typography } from '../../src/theme';

type Profile = { id: string; username: string; tag: string; avatar_url: string | null; best_zero_to_hundred_s: number | null };
type Vehicle = { id: string; make: string | null; name: string; bt_device_name: string | null };

export default function ProfileScreen() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [vehicleMake, setVehicleMake] = useState('');
  const [vehicleName, setVehicleName] = useState('');
  const [btDeviceName, setBtDeviceName] = useState('');
  const [editingVehicle, setEditingVehicle] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [accountType, setAccountType] = useState<'kakao' | 'apple' | 'anonymous'>('anonymous');
  const [editingNickname, setEditingNickname] = useState(false);
  const [nicknameInput, setNicknameInput] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [savingNickname, setSavingNickname] = useState(false);
  const [driveDetectEnabled, setDriveDetectEnabled] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [bestSpeedKmh, setBestSpeedKmh] = useState<number | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return;
      const user = session.user;

      const [profileRes, vehicleRes, detectVal, statsRes] = await Promise.all([
        supabase.from('profiles').select('id, username, tag, avatar_url, best_zero_to_hundred_s').eq('id', user.id).single(),
        supabase.from('vehicles').select('id, make, name, bt_device_name').eq('user_id', user.id).maybeSingle(),
        AsyncStorage.getItem(DRIVE_DETECT_NOTIFICATION_KEY),
        supabase.rpc('get_my_stats', { p_user_id: user.id }),
      ]);

      setDriveDetectEnabled(detectVal === 'true');
      setAccountType(
        user.user_metadata?.kakao_id ? 'kakao' :
        user.app_metadata?.provider === 'apple' ? 'apple' :
        'anonymous'
      );
      if (profileRes.data) setProfile(profileRes.data);
      if (statsRes.data?.[0]) setBestSpeedKmh(statsRes.data[0].max_speed_kmh ?? null);
      if (vehicleRes.data) {
        setVehicle(vehicleRes.data);
        setVehicleMake(vehicleRes.data.make ?? '');
        setVehicleName(vehicleRes.data.name ?? '');
        setBtDeviceName(vehicleRes.data.bt_device_name ?? '');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const startEditing = () => {
    setVehicleMake(vehicle?.make ?? '');
    setVehicleName(vehicle?.name ?? '');
    setBtDeviceName(vehicle?.bt_device_name ?? '');
    setEditingVehicle(true);
  };

  const saveVehicle = async () => {
    if (!vehicleName.trim()) return;
    setSaving(true);

    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return;

    const fields = {
      make: vehicleMake.trim() || null,
      name: vehicleName.trim(),
      bt_device_name: btDeviceName.trim() || null,
    };
    let error;

    if (vehicle) {
      ({ error } = await supabase.from('vehicles').update(fields).eq('id', vehicle.id));
    } else {
      const res = await supabase.from('vehicles')
        .insert({ user_id: session.user.id, ...fields })
        .select('id, make, name, bt_device_name').single();
      error = res.error;
      if (res.data) setVehicle(res.data);
    }

    if (error) {
      Alert.alert('오류', error.message);
    } else {
      setVehicle((v) => v ? { ...v, ...fields } : { id: '', ...fields });
      setEditingVehicle(false);
    }
    setSaving(false);
  };

  const pickAvatar = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('사진 접근 권한', '설정에서 사진 접근 권한을 허용해주세요.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
      preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
    });
    if (result.canceled || !result.assets[0]) return;

    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return;

    setUploadingAvatar(true);
    try {
      const url = await uploadAvatar(session.user.id, result.assets[0].uri);
      await supabase.from('profiles').update({ avatar_url: url }).eq('id', session.user.id);
      setProfile((p) => p ? { ...p, avatar_url: url } : p);
    } catch (e: any) {
      Alert.alert('업로드 실패', e.message ?? String(e));
    } finally {
      setUploadingAvatar(false);
    }
  };

  const removeAvatar = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return;

    setUploadingAvatar(true);
    try {
      await supabase.storage.from('avatars').remove([`${session.user.id}/avatar.jpg`]);
      await supabase.from('profiles').update({ avatar_url: null }).eq('id', session.user.id);
      setProfile((p) => p ? { ...p, avatar_url: null } : p);
    } catch (e: any) {
      Alert.alert('삭제 실패', e.message ?? String(e));
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handleAvatarPress = () => {
    if (!profile?.avatar_url) {
      pickAvatar();
      return;
    }
    Alert.alert('프로필 사진', undefined, [
      { text: '취소', style: 'cancel' },
      { text: '사진 변경', onPress: pickAvatar },
      { text: '사진 삭제', style: 'destructive', onPress: removeAvatar },
    ]);
  };

  const startEditingNickname = () => {
    setNicknameInput(profile?.username ?? '');
    setTagInput(profile?.tag ?? '');
    setEditingNickname(true);
  };

  const saveNickname = async () => {
    if (!nicknameInput.trim() || !tagInput.trim()) return;
    setSavingNickname(true);

    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) { setSavingNickname(false); return; }

    const { error } = await supabase
      .from('profiles')
      .update({ username: nicknameInput.trim(), tag: tagInput.trim() })
      .eq('id', session.user.id);

    if (error) {
      Alert.alert(
        error.code === '23505' ? '닉네임+태그 중복' : '오류',
        error.code === '23505' ? '이미 같은 닉네임과 태그를 쓰는 유저가 있어요. 태그를 바꿔주세요.' : error.message
      );
    } else {
      setProfile((p) => p ? { ...p, username: nicknameInput.trim(), tag: tagInput.trim() } : p);
      setEditingNickname(false);
    }
    setSavingNickname(false);
  };

  const toggleDriveDetect = async (value: boolean) => {
    if (!value) {
      setDriveDetectEnabled(false);
      await AsyncStorage.setItem(DRIVE_DETECT_NOTIFICATION_KEY, 'false');
      return;
    }

    const { status: bgStatus } = await Location.getBackgroundPermissionsAsync();
    if (bgStatus !== 'granted') {
      await new Promise<void>((resolve) => {
        Alert.alert(
          '백그라운드 위치 권한 안내',
          '이 기능은 앱을 사용하지 않는 동안에도 주행 여부를 확인해 알림을 보내드려요. 다음 화면에서 위치 접근을 "항상 허용"으로 선택해주세요.',
          [{ text: '확인', onPress: () => resolve() }]
        );
      });

      const { status: fgStatus } = await Location.requestForegroundPermissionsAsync();
      if (fgStatus !== 'granted') {
        Alert.alert('권한 필요', '위치 권한이 없으면 주행 감지 알림을 사용할 수 없어요.');
        return;
      }
      let { status: newBgStatus } = await Location.requestBackgroundPermissionsAsync();
      if (newBgStatus !== 'granted') {
        // iOS: 방금 "항상 허용"을 선택해도 권한 상태 반영에 약간의 지연이 있을 수 있어
        // 잠깐 대기 후 한 번 더 확인
        await new Promise((r) => setTimeout(r, 500));
        ({ status: newBgStatus } = await Location.getBackgroundPermissionsAsync());
      }
      if (newBgStatus !== 'granted') {
        Alert.alert('권한 필요', '설정 > 개인정보 보호 > 위치 서비스에서 Driend를 "항상"으로 설정해주세요.');
        return;
      }
    }

    setDriveDetectEnabled(true);
    await AsyncStorage.setItem(DRIVE_DETECT_NOTIFICATION_KEY, 'true');
    startMonitoring();
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
    <View style={{ flex: 1 }}>
    <ScrollView style={s.container} contentContainerStyle={s.content}>
      <Text style={s.screenTitle}>프로필</Text>

      {/* 사용자 정보 */}
      <View style={s.card}>
        <TouchableOpacity style={s.avatarCircle} onPress={handleAvatarPress} disabled={uploadingAvatar}>
          {profile?.avatar_url ? (
            <Image source={{ uri: profile.avatar_url }} style={s.avatarImage} />
          ) : (
            <Text style={s.avatarText}>{(profile?.username ?? '?')[0].toUpperCase()}</Text>
          )}
          <View style={s.avatarEditBadge}>
            {uploadingAvatar
              ? <ActivityIndicator size="small" color="#fff" />
              : <Text style={s.avatarEditBadgeText}>✎</Text>}
          </View>
        </TouchableOpacity>
        {editingNickname ? (
          <View style={s.nicknameEditGroup}>
            <View style={s.nicknameTagRow}>
              <TextInput
                style={[s.nicknameInput, s.nicknameInputFlex]}
                value={nicknameInput}
                onChangeText={setNicknameInput}
                placeholder="닉네임"
                placeholderTextColor={colors.textTertiary}
                maxLength={20}
                autoFocus
                returnKeyType="next"
              />
              <TextInput
                style={[s.nicknameInput, s.tagInput]}
                value={tagInput}
                onChangeText={setTagInput}
                placeholder="태그"
                placeholderTextColor={colors.textTertiary}
                maxLength={10}
                returnKeyType="done"
                onSubmitEditing={saveNickname}
              />
            </View>
            <View style={s.nicknameEditActions}>
              <TouchableOpacity onPress={() => setEditingNickname(false)}>
                <Text style={s.nicknameCancel}>취소</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={saveNickname} disabled={savingNickname}>
                {savingNickname
                  ? <ActivityIndicator size="small" color={colors.primary} />
                  : <Text style={s.nicknameSave}>저장</Text>}
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <TouchableOpacity onPress={startEditingNickname}>
            <Text style={s.username}>
              {profile?.username ?? '게스트'}
              {profile ? <Text style={s.usernameTag}>#{profile.tag}</Text> : null}
              {' '}<Text style={s.editBtn}>수정</Text>
            </Text>
          </TouchableOpacity>
        )}
        <Text style={s.userSub}>
          {accountType === 'kakao' ? '카카오 계정' : accountType === 'apple' ? 'Apple 계정' : '익명 계정'}
        </Text>
      </View>

      {/* 내 기록 */}
      <View style={s.card}>
        <Text style={s.cardTitle}>내 기록</Text>
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
              {profile?.best_zero_to_hundred_s ? profile.best_zero_to_hundred_s.toFixed(1) : '-'}
              <Text style={s.recordUnit}> 초</Text>
            </Text>
            <Text style={s.recordLabel}>제로백</Text>
          </View>
        </View>
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
            <Text style={s.fieldLabel}>제조사</Text>
            <TextInput
              style={s.input}
              value={vehicleMake}
              onChangeText={setVehicleMake}
              placeholder="예: 현대"
              placeholderTextColor={colors.textTertiary}
              autoFocus
              returnKeyType="next"
            />
            <Text style={s.fieldLabel}>차량 이름</Text>
            <TextInput
              style={s.input}
              value={vehicleName}
              onChangeText={setVehicleName}
              placeholder="예: 아반떼"
              placeholderTextColor={colors.textTertiary}
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
            <Text style={s.vehicleName}>{vehicle.make ? `${vehicle.make} ${vehicle.name}` : vehicle.name}</Text>
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

      {/* 약관/정책 */}
      <View style={s.card}>
        <TouchableOpacity
          style={s.legalRow}
          onPress={() => router.push('/legal/privacy')}
        >
          <Text style={s.legalText}>개인정보처리방침</Text>
        </TouchableOpacity>
        <View style={s.legalDivider} />
        <TouchableOpacity
          style={s.legalRow}
          onPress={() => router.push('/legal/terms')}
        >
          <Text style={s.legalText}>이용약관</Text>
        </TouchableOpacity>
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

    <OnboardingTip
      storageKey="profile_onboarding_seen"
      message={'차량 정보와 계정 설정을 관리하세요'}
    />
    </View>
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
    overflow: 'visible',
  },
  avatarImage: { width: 72, height: 72, borderRadius: 36 },
  avatarText: { fontSize: 28, fontWeight: '700', color: '#fff' },
  avatarEditBadge: {
    position: 'absolute', bottom: -2, right: -2,
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: colors.text, borderWidth: 2, borderColor: colors.card,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarEditBadgeText: { color: '#fff', fontSize: 12 },
  username: { fontSize: 20, fontWeight: '700', color: colors.text, textAlign: 'center' },
  userSub: { ...typography.label, textAlign: 'center' },

  recordRow: { flexDirection: 'row', alignItems: 'center' },
  recordItem: { flex: 1, alignItems: 'center', gap: 4 },
  recordDivider: { width: 1, height: 36, backgroundColor: colors.divider },
  recordValue: { fontSize: 20, fontWeight: '700', color: colors.text },
  recordUnit: { fontSize: 13, fontWeight: '400', color: colors.textSecondary },
  recordLabel: { ...typography.label },

  nicknameEditGroup: { gap: spacing.xs },
  nicknameTagRow: { flexDirection: 'row', gap: spacing.xs },
  nicknameInput: {
    height: 44, borderRadius: radius.sm,
    backgroundColor: colors.background, paddingHorizontal: spacing.sm,
    fontSize: 16, color: colors.text, textAlign: 'center',
  },
  nicknameInputFlex: { flex: 1 },
  tagInput: { width: 90 },
  usernameTag: { color: colors.textTertiary, fontWeight: '400' },
  nicknameEditActions: { flexDirection: 'row', justifyContent: 'center', gap: spacing.md },
  nicknameCancel: { fontSize: 14, color: colors.textSecondary },
  nicknameSave: { fontSize: 14, fontWeight: '600', color: colors.primary },

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

  legalRow: { paddingVertical: spacing.xs },
  legalText: { fontSize: 14, color: colors.textSecondary },
  legalDivider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.textTertiary, opacity: 0.3 },
});
