import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { colors } from '../theme';

export default function OnboardingTip({
  storageKey,
  message,
}: {
  storageKey: string;
  message: string;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(storageKey).then((seen) => {
      if (seen !== 'true') setVisible(true);
    });
  }, [storageKey]);

  if (!visible) return null;

  const dismiss = () => {
    setVisible(false);
    AsyncStorage.setItem(storageKey, 'true');
  };

  return (
    <View style={s.overlay} pointerEvents="box-none">
      <View style={s.bubble}>
        <Text style={s.text}>{message}</Text>
        <TouchableOpacity style={s.btn} onPress={dismiss}>
          <Text style={s.btnText}>확인</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  bubble: {
    position: 'absolute',
    top: 60, left: 24, right: 24,
    backgroundColor: '#191919',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  text: {
    color: '#fff', fontSize: 15, fontWeight: '600',
    textAlign: 'center', lineHeight: 22, marginBottom: 14,
  },
  btn: {
    backgroundColor: colors.primary,
    paddingHorizontal: 24, paddingVertical: 10, borderRadius: 18,
  },
  btnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
});
