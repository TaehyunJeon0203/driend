#!/usr/bin/env bash
# 실기기 빌드 + 설치 (Xcode 직접 빌드, expo start/Expo Go 안 씀 — AGENTS.md 참고)
set -euo pipefail

cd "$(dirname "$0")/.."

DEVICE_UDID="${DEVICE_UDID:-FE58F39A-4089-5CD8-997D-FAFFE3A5FE59}"
DERIVED_DATA_PATH="$(pwd)/ios/build"
APP_PATH="$DERIVED_DATA_PATH/Build/Products/Release-iphoneos/Driend.app"

echo "== 빌드 (device: $DEVICE_UDID) =="
EXPO_USE_PRECOMPILED_MODULES=false REACT_NATIVE_PRODUCTION=1 xcodebuild \
  -workspace ios/Driend.xcworkspace -scheme Driend -configuration Release \
  -destination "platform=iOS,id=$DEVICE_UDID" -allowProvisioningUpdates \
  -derivedDataPath "$DERIVED_DATA_PATH"

if [ ! -d "$APP_PATH" ]; then
  echo "빌드 실패: $APP_PATH 없음"
  exit 1
fi

echo "== 설치 (devicectl install, 실패 시 최대 3회 재시도) =="
for attempt in 1 2 3; do
  if xcrun devicectl device install app --device "$DEVICE_UDID" "$APP_PATH"; then
    echo "설치 완료"
    exit 0
  fi
  echo "설치 실패 (시도 $attempt/3), 재시도..."
  sleep 3
done

echo "설치 3회 모두 실패"
exit 1
