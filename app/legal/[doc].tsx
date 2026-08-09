import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { WebView } from 'react-native-webview';
import { useLocalSearchParams, router } from 'expo-router';
import { PRIVACY_POLICY_HTML } from '../../src/legal/privacyPolicyHtml';
import { TERMS_OF_SERVICE_HTML } from '../../src/legal/termsOfServiceHtml';
import { colors, spacing } from '../../src/theme';

// Supabase가 서빙하는 정적 콘텐츠는 프로젝트 게이트웨이에서 Content-Type을
// text/plain으로 강제 재작성해(코드에서 text/html을 지정해도 무시됨) 브라우저가
// HTML을 렌더링하지 않고 소스 그대로 보여주는 문제가 있었음. 네트워크 요청 없이
// 앱에 번들된 HTML 문자열을 WebView에 직접 주입해 이 문제를 우회함.
const DOCS: Record<string, { title: string; html: string }> = {
  privacy: { title: '개인정보처리방침', html: PRIVACY_POLICY_HTML },
  terms: { title: '이용약관', html: TERMS_OF_SERVICE_HTML },
};

export default function LegalDocScreen() {
  const { doc } = useLocalSearchParams<{ doc: string }>();
  const entry = DOCS[doc ?? ''];

  return (
    <View style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={s.backBtn}>‹ 뒤로</Text>
        </TouchableOpacity>
        <Text style={s.title} numberOfLines={1}>{entry?.title ?? ''}</Text>
        <View style={s.headerSpacer} />
      </View>
      {entry ? (
        <WebView source={{ html: entry.html }} style={s.webview} />
      ) : (
        <View style={s.center}><Text>문서를 찾을 수 없어요</Text></View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.card },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 56, paddingHorizontal: spacing.md, paddingBottom: spacing.sm,
  },
  backBtn: { fontSize: 16, fontWeight: '600', color: colors.primary, width: 60 },
  title: { fontSize: 16, fontWeight: '700', color: colors.text, flex: 1, textAlign: 'center' },
  headerSpacer: { width: 60 },
  webview: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
