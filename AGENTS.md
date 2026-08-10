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

## Android 빌드 & 실기기 테스트

`android/` 폴더도 checked-in 되어 있음. gradlew 직접 빌드 + adb install로 실기기 테스트한다.

```bash
# 디버그 빌드
cd android && ANDROID_HOME="$HOME/Library/Android/sdk" ./gradlew assembleDebug

# 설치 (기기가 adb devices에 잡혀 있어야 함, USB 디버깅 허용 필요)
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

- `app.json`의 config-plugin 설정을 바꾼 후엔 `npx expo prebuild --platform android` 로 네이티브 반영.
- **prebuild 이후 항상 확인 (수동 패치 2건, `--clean` 아니어도 사라질 수 있음):**
  1. `android/build.gradle`의 `allprojects.repositories`에 네이버맵/카카오 전용 maven repo 추가: `https://repository.map.naver.com/archive/maven`, `https://devrepo.kakao.com/nexus/content/groups/public/`. 둘 다 Maven Central/jitpack엔 없는 아티팩트라 빠지면 `Could not find com.naver.maps:map-sdk`/`com.kakao.sdk:v2-common` 에러로 빌드가 깨짐.
  2. `android/app/build.gradle`에 릴리스 서명 설정 추가 (`keystore.properties` 읽어서 `signingConfigs.release` 구성 + `buildTypes.release.signingConfig`를 `keystoreProperties` 존재 여부로 분기). 없으면 릴리스 빌드가 debug 키로 서명됨 — Play Store 업로드 불가.
- 카카오 로그인은 `app.json`의 `@react-native-kakao/core` 플러그인에 `android: { authCodeHandlerActivity: true }`가 있어야 AndroidManifest에 `AuthCodeHandlerActivity` 인텐트 필터가 생성됨 (이건 app.json에 있으므로 prebuild --clean 해도 안 날아감).
- **릴리스 서명 keystore:** `android/app/driend-release.keystore` (PKCS12, alias `driend-release`) + `android/keystore.properties` (둘 다 gitignore됨, 로컬에만 존재). Play Store에는 이 키를 "업로드 키"로 쓰고 Play App Signing이 실제 배포 서명을 대신 관리하게 설정할 것. **keystore.properties와 keystore 파일을 잃어버리면 이 앱으로는 다시 업데이트를 못 올리므로 반드시 별도 백업(비밀번호 관리자 등) 필요.**
- 네이버 지도/카카오 로그인은 앱 서명 SHA-1(또는 카카오는 base64 key hash)을 각 콘솔에 등록해야 정상 동작함 — debug와 release 키 둘 다 따로 등록해야 함. 현재 등록 필요한 값은 아래 "외부 콘솔 등록 필요" 참고.

## Android 출시 전 외부 콘솔 등록 필요 (사용자가 직접 해야 함)

네이버 클라우드 플랫폼 Maps 콘솔과 카카오 디벨로퍼스 콘솔에 아래 값들을 Android 패키지(`com.driend.app`) 기준으로 등록해야 지도/로그인이 정상 동작함. (iOS는 이미 등록되어 있던 bundle ID 방식과 별개로 Android는 서명 지문 기반이라 새로 등록 필요.)

- **네이버 지도 콘솔** (Maps > Application 설정 > Android 앱 등록): 패키지명 `com.driend.app` + 아래 SHA-1 두 개 다 등록
  - debug SHA-1: `5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25`
  - release SHA-1: `19:72:6D:98:5D:E6:77:1F:1F:4B:8E:2E:F6:BD:AC:05:C2:F8:04:79`
- **카카오 디벨로퍼스 콘솔** (내 애플리케이션 > 플랫폼 > Android 등록): 패키지명 `com.driend.app` + 아래 키 해시(base64) 두 개 다 등록
  - debug key hash: `Xo8WBi6jzSxKDVR4drqm84yr9iU=`
  - release key hash: `GXJtmF3mdx8fS44u9r2sBcL4BHk=`
- 재발급 필요 시 계산법: `keytool -exportcert -alias <alias> -keystore <keystore파일> -storepass <비번> | openssl sha1 -binary | openssl base64` (카카오), `keytool -list -v -keystore <keystore파일> -alias <alias> -storepass <비번>`로 SHA1 확인 (네이버).
- **Google Play Console**: 별도 계정 필요(사용자가 아직 미확정). AAB 최초 업로드 시 Play App Signing에 위 release keystore를 업로드 키로 등록하는 절차가 콘솔에서 안내됨.

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
