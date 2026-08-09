import { Component, type ReactNode } from 'react';
import { Alert } from 'react-native';

// 조용히 화면이 꺼지는 대신(원인 파악 불가) 에러 내용을 알림으로 보여줌 — 디버깅용
export default class CrashAlertBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    Alert.alert('화면 오류', `${error.message}\n\n${info.componentStack.slice(0, 300)}`);
  }

  render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}
