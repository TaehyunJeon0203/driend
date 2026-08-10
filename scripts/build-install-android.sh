#!/usr/bin/env bash
# 실기기 빌드 + 설치 (gradlew 직접 빌드, expo start/Expo Go 안 씀 — AGENTS.md 참고)
set -euo pipefail

cd "$(dirname "$0")/.."

export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
APK_PATH="android/app/build/outputs/apk/debug/app-debug.apk"

if ! adb devices | grep -q "device$"; then
  echo "adb devices에 잡힌 기기가 없음 — USB 연결 및 USB 디버깅 허용 확인"
  exit 1
fi

echo "== 빌드 =="
(cd android && ./gradlew assembleDebug)

if [ ! -f "$APK_PATH" ]; then
  echo "빌드 실패: $APK_PATH 없음"
  exit 1
fi

echo "== 설치 =="
adb install -r "$APK_PATH"
echo "설치 완료"
