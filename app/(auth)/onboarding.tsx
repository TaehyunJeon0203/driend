import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  useWindowDimensions,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../../src/services/supabase';
import { generateRandomTag } from '../../src/services/profileTag';
import { colors, spacing } from '../../src/theme';
import {
  AUTH_CONTENT_MAX_WIDTH,
  isCompactWindow,
  preserveLegacyInset,
} from '../../src/utils/responsiveLayout';

export default function OnboardingScreen() {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const compact = isCompactWindow(width);
  const [nickname, setNickname] = useState('');
  const [tag, setTag] = useState(generateRandomTag());
  const [vehicleMake, setVehicleMake] = useState('');
  const [vehicleName, setVehicleName] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!nickname.trim()) {
      Alert.alert('닉네임을 입력해주세요');
      return;
    }
    if (!tag.trim()) {
      Alert.alert('태그를 입력해주세요');
      return;
    }
    setSaving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return;

      const { error: profileError } = await supabase
        .from('profiles')
        .update({ username: nickname.trim(), tag: tag.trim() })
        .eq('id', session.user.id);
      if (profileError) {
        if (profileError.code === '23505') {
          Alert.alert('닉네임+태그 중복', '이미 같은 닉네임과 태그를 쓰는 유저가 있어요. 태그를 바꿔주세요.');
          return;
        }
        throw profileError;
      }

      if (vehicleName.trim()) {
        const { error: vehicleError } = await supabase.from('vehicles').insert({
          user_id: session.user.id,
          make: vehicleMake.trim() || null,
          name: vehicleName.trim(),
        });
        if (vehicleError) throw vehicleError;
      }

      router.replace('/(tabs)');
    } catch (error: any) {
      Alert.alert('오류', error.message ?? '다시 시도해주세요.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: preserveLegacyInset(spacing.xl, insets.top, spacing.md),
            paddingHorizontal: preserveLegacyInset(
              spacing.xl,
              Math.max(insets.left, insets.right),
              spacing.md,
            ),
            paddingBottom: preserveLegacyInset(spacing.xl, insets.bottom, spacing.md),
          },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.form}>
          <Text style={styles.title}>프로필을 설정해주세요</Text>
          <Text style={styles.subtitle}>나중에 언제든 바꿀 수 있어요</Text>

          <Text style={styles.label}>닉네임</Text>
          <Text style={styles.hint}>닉네임이 겹칠 수 있어 뒤에 태그를 붙여 구분해요 (예: 전태현#3027)</Text>
          <View style={[styles.nicknameTagRow, compact && styles.nicknameTagColumn]}>
            <TextInput
              style={[
                styles.input,
                styles.nicknameInput,
                compact && styles.compactNicknameInput,
              ]}
              value={nickname}
              onChangeText={setNickname}
              placeholder="다른 드라이버에게 보여질 이름"
              placeholderTextColor={colors.textTertiary}
              maxLength={20}
              returnKeyType="next"
            />
            <TextInput
              style={[styles.input, styles.tagInput, compact && styles.compactTagInput]}
              value={tag}
              onChangeText={setTag}
              placeholder="태그"
              placeholderTextColor={colors.textTertiary}
              maxLength={10}
              returnKeyType="next"
            />
          </View>

          <Text style={styles.label}>차량 <Text style={styles.optional}>(선택)</Text></Text>
          <TextInput
            style={styles.input}
            value={vehicleMake}
            onChangeText={setVehicleMake}
            placeholder="제조사 (예: 현대)"
            placeholderTextColor={colors.textTertiary}
            returnKeyType="next"
          />
          <TextInput
            style={styles.input}
            value={vehicleName}
            onChangeText={setVehicleName}
            placeholder="차량 이름 (예: 아반떼)"
            placeholderTextColor={colors.textTertiary}
            returnKeyType="done"
            onSubmitEditing={handleSubmit}
          />

          <TouchableOpacity
            style={[styles.submitButton, saving && styles.disabled]}
            onPress={handleSubmit}
            disabled={saving}
          >
            {saving ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.submitText}>시작하기</Text>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  content: { flexGrow: 1, justifyContent: 'center' },
  form: { width: '100%', maxWidth: AUTH_CONTENT_MAX_WIDTH, alignSelf: 'center' },
  title: { fontSize: 24, fontWeight: '700', color: colors.text, textAlign: 'center' },
  subtitle: { fontSize: 14, color: '#888', textAlign: 'center', marginTop: 6, marginBottom: 36 },
  label: { fontSize: 14, fontWeight: '600', color: colors.text, marginBottom: 8, marginTop: 16 },
  optional: { fontWeight: '400', color: colors.textTertiary },
  hint: { fontSize: 12, color: colors.textTertiary, marginBottom: 8, marginTop: -4 },
  input: {
    height: 50, borderRadius: 12, backgroundColor: colors.background,
    paddingHorizontal: 14, fontSize: 15, color: colors.text, marginBottom: 10,
  },
  nicknameTagRow: { flexDirection: 'row', gap: 8 },
  nicknameTagColumn: { flexDirection: 'column' },
  nicknameInput: { flex: 1 },
  compactNicknameInput: { flex: 0, width: '100%' },
  tagInput: { width: 90 },
  compactTagInput: { width: '100%' },
  submitButton: {
    backgroundColor: colors.primary, borderRadius: 14, height: 54,
    alignItems: 'center', justifyContent: 'center', marginTop: 24,
  },
  disabled: { opacity: 0.6 },
  submitText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
