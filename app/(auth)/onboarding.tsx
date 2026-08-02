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
} from 'react-native';
import { router } from 'expo-router';
import { supabase } from '../../src/services/supabase';
import { colors } from '../../src/theme';

export default function OnboardingScreen() {
  const [nickname, setNickname] = useState('');
  const [vehicleMake, setVehicleMake] = useState('');
  const [vehicleName, setVehicleName] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!nickname.trim()) {
      Alert.alert('닉네임을 입력해주세요');
      return;
    }
    setSaving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return;

      const { error: profileError } = await supabase
        .from('profiles')
        .update({ username: nickname.trim() })
        .eq('id', session.user.id);
      if (profileError) {
        if (profileError.code === '23505') {
          Alert.alert('닉네임 중복', '이미 사용 중인 닉네임이에요. 다른 닉네임을 입력해주세요.');
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
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>프로필을 설정해주세요</Text>
        <Text style={styles.subtitle}>나중에 언제든 바꿀 수 있어요</Text>

        <Text style={styles.label}>닉네임</Text>
        <TextInput
          style={styles.input}
          value={nickname}
          onChangeText={setNickname}
          placeholder="다른 드라이버에게 보여질 이름"
          placeholderTextColor={colors.textTertiary}
          maxLength={20}
          returnKeyType="next"
        />

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
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  content: { flexGrow: 1, justifyContent: 'center', padding: 32 },
  title: { fontSize: 24, fontWeight: '700', color: colors.text, textAlign: 'center' },
  subtitle: { fontSize: 14, color: '#888', textAlign: 'center', marginTop: 6, marginBottom: 36 },
  label: { fontSize: 14, fontWeight: '600', color: colors.text, marginBottom: 8, marginTop: 16 },
  optional: { fontWeight: '400', color: colors.textTertiary },
  input: {
    height: 50, borderRadius: 12, backgroundColor: colors.background,
    paddingHorizontal: 14, fontSize: 15, color: colors.text, marginBottom: 10,
  },
  submitButton: {
    backgroundColor: colors.primary, borderRadius: 14, height: 54,
    alignItems: 'center', justifyContent: 'center', marginTop: 24,
  },
  disabled: { opacity: 0.6 },
  submitText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
