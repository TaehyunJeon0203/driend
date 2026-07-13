# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v56.0.0/ before writing any code.

## 빌드 & 실기기 테스트

`ios/` 폴더가 checked-in 되어 있음. `expo start` / Expo Go가 아니라 **Xcode 직접 빌드 + devicectl 설치**로 실기기 테스트한다.

```bash
# 빌드
EXPO_USE_PRECOMPILED_MODULES=false REACT_NATIVE_PRODUCTION=1 xcodebuild \
  -workspace ios/Driend.xcworkspace -scheme Driend -configuration Release \
  -destination "platform=iOS,id=<DEVICE_UDID>" -allowProvisioningUpdates

# 설치 (빌드 성공 후)
xcrun devicectl device install app --device <DEVICE_UDID> \
  "<DerivedData 경로>/Build/Products/Release-iphoneos/Driend.app"
```

- devicectl install이 가끔 "Connection reset by peer"로 실패함 — 재시도하면 대부분 성공.
- 새 네이티브 의존성 추가 시: `npx expo install <pkg> -- --legacy-peer-deps` (expo-router의 @radix-ui 계열 peer dep 충돌, 무해함) → `cd ios && pod install`
- `app.json`의 icon/splash 등 config-plugin 설정을 바꾼 후엔 `npx expo prebuild --platform ios` 로 네이티브 반영.
  **`--clean` 옵션은 절대 쓰지 말 것** — 아래 수동 패치가 전부 날아감.
- **prebuild 이후 항상 확인:** `ios/Driend/Driend.entitlements`에 `aps-environment` 키가 재생성됨. 개인 Apple 개발자 계정은 Push Notifications entitlement를 지원하지 않으므로 매번 다시 제거해야 함(`<dict/>`로 비우기). 앱은 local notification(trigger: null)만 쓰므로 이 키 없이도 정상 동작.

## Supabase auth 콜백 규칙

`supabase.auth.onAuthStateChange` / `getSession().then()` 콜백 안에서 다른 Supabase 쿼리를 직접 `await`하지 말 것.

**Why:** supabase-js의 알려진 데드락 패턴 — 콜백 실행 중 GoTrue 세션 락이 풀리지 않아, 다른 화면에서 동시에 호출하는 `getSession()`이 영원히 대기 상태에 빠짐 (cold start 시 통계/랭킹/프로필 탭 무한로딩으로 나타났던 버그의 원인).

**How to apply:** 콜백 자체는 동기 함수로 유지하고, 실제 비동기 작업은 별도 함수로 추출해 `setTimeout(fn, 0)`으로 다음 틱에 실행한다.

## 스토리지 경로 / city_code 규칙

Supabase Storage 키에 한글·콜론 등 특수문자가 들어가면 "Invalid key" 에러가 남. `city_code` 같은 식별자를 스토리지 경로에 쓸 때는 언더스코어 구분자만 사용(예: `Gyeonggi-do_수원시`). 사진 업로드 경로는 한글 대신 `city.id`(UUID) 기준으로 구성한다.

## 알려진 한계 (재작업 불필요)

경로 시각화에서 왕복 도로가 지도에 평행선 2개로 표시되는 경우가 있음. Valhalla map-matching이 편도/왕복 차선을 별도 center line(~40m 간격)으로 스냅하기 때문 — 도로 토폴로지 데이터 없이는 해결 불가하며, 사용자도 인지하고 허용 중인 사항. 버그로 취급하지 말 것.

## 작업 방식

- 기능 추가나 유의미한 버그 수정처럼 실질적인 요청을 받으면, 바로 파일을 고치기 전에 무엇을 어떻게 바꿀지(변경 대상 파일, 접근 방식) 짧게 먼저 설명한다. 한 줄짜리 사소한 수정에는 적용하지 않는다.
- 파일 3개 이상 수정 또는 기능 단위 하나가 완성되는 등 의미 있는 작업 단위가 끝나면 커밋을 제안한다.
- 커밋 메시지에 `Co-Authored-By` 태그를 넣지 않는다.
