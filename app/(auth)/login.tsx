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
import { login } from '@react-native-kakao/user';
import { supabase } from '../../src/services/supabase';
import { colors } from '../../src/theme';

export default function LoginScreen() {
  const [isLoading, setIsLoading] = useState(false);
  const [isKakaoLoading, setIsKakaoLoading] = useState(false);

  const handleKakaoLogin = async () => {
    setIsKakaoLoading(true);
    try {
      const token = await login();

      const { data, error } = await supabase.functions.invoke('kakao-auth', {
        body: { access_token: token.accessToken },
      });

      if (error) {
        let msg = error.message;
        try {
          const body = await (error as any).context?.json?.();
          if (body?.error) msg = body.error;
        } catch {}
        throw new Error(msg);
      }
      if (data?.error) throw new Error(data.error);

      await supabase.auth.setSession({
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      });

      router.replace('/(tabs)');
    } catch (error: any) {
      Alert.alert('카카오 로그인 실패', error.message ?? '다시 시도해주세요.');
    } finally {
      setIsKakaoLoading(false);
    }
  };

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
        <TouchableOpacity
          style={[styles.kakaoButton, isKakaoLoading && styles.disabled]}
          onPress={handleKakaoLogin}
          disabled={isKakaoLoading}
        >
          {isKakaoLoading ? (
            <ActivityIndicator color="#3C1E1E" />
          ) : (
            <Text style={styles.kakaoText}>카카오로 시작하기</Text>
          )}
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
  kakaoButton: {
    backgroundColor: '#FEE500',
    borderRadius: 14,
    height: 54,
    alignItems: 'center',
    justifyContent: 'center',
  },
  kakaoText: { color: '#3C1E1E', fontSize: 16, fontWeight: '600' },
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
