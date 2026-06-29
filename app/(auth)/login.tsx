import { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { router } from 'expo-router';
import { supabase } from '../../src/services/supabase';
import { colors } from '../../src/theme';

export default function LoginScreen() {
  const [isLoading, setIsLoading] = useState(false);

  const handleAnonymousLogin = async () => {
    setIsLoading(true);
    try {
      const { error } = await supabase.auth.signInAnonymously();
      if (error) throw error;
      router.replace('/(tabs)');
    } catch (error: any) {
      Alert.alert('오류', error.message ?? '다시 시도해주세요.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.top}>
        <Text style={styles.logo}>Driend</Text>
        <Text style={styles.subtitle}>드라이브를 기록하고{'\n'}친구와 함께 달려요</Text>
      </View>

      <View style={styles.bottom}>
        {/* 카카오 로그인은 비즈니스 인증 후 활성화 예정 */}
        <TouchableOpacity style={styles.kakaoButtonDisabled} disabled>
          <Text style={styles.kakaoText}>카카오로 시작하기</Text>
          <Text style={styles.soonText}>준비 중</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.guestButton, isLoading && styles.disabled]}
          onPress={handleAnonymousLogin}
          disabled={isLoading}
        >
          {isLoading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.guestText}>게스트로 시작하기</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  top: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  logo: { fontSize: 52, fontWeight: 'bold', color: colors.primary },
  subtitle: { fontSize: 17, color: '#888', textAlign: 'center', lineHeight: 26 },
  bottom: { padding: 32, paddingBottom: 48, gap: 12 },
  kakaoButtonDisabled: {
    backgroundColor: '#FEE500',
    borderRadius: 14,
    height: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    opacity: 0.5,
  },
  kakaoText: { color: '#3C1E1E', fontSize: 16, fontWeight: '600' },
  soonText: { color: '#3C1E1E', fontSize: 12, opacity: 0.7 },
  guestButton: {
    backgroundColor: colors.primary,
    borderRadius: 14,
    height: 54,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: { opacity: 0.6 },
  guestText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
