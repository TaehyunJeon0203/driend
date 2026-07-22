# Driend

**Drive + Friend** — 드라이브를 자동으로 기록하고, 방문한 지역을 모으고, 친구와 랭킹을 겨루는 한국 타겟 드라이브 기록 앱.

## 주요 기능

- **자동/수동 주행 기록** — 백그라운드에서 자동으로 주행 시작을 감지하고, 정차가 길어지면 알림 후 자동 종료. 경로는 Valhalla map-matching으로 도로 위에 스냅.
- **지도 시각화**
  - *도로 모드*: 내가 달린 경로를 통과 빈도에 따라 브랜드 그린 계열 그라데이션으로 표시
  - *사진 모드*: 전국 시/군/구(230개) 단위로 방문 지역을 채워나가는 모자이크 지도. 방문한 지역에는 실제 폴리곤 모양대로 잘린 사진을 스탬프로 등록 가능
- **통계** — 누적 거리, 월별 주행량, 여행(Trip) 단위 기록 묶기, 최근 주행 목록
- **제로백(0→100) 측정** — 가속도계 + GPS로 출발 순간과 100km/h 도달 시점을 감지해 자동 측정
- **랭킹 & 친구** — 누적 거리 / 최고속도 / 제로백 / 방문 도시 등 카테고리별 전체·친구 랭킹, 닉네임 검색 기반 친구 요청/수락
- **카카오 로그인** (게스트 로그인도 지원)

## 기술 스택

| 영역 | 사용 기술 |
|---|---|
| 클라이언트 | Expo SDK 56, React Native 0.85, TypeScript, Expo Router |
| 지도 | `@mj-studio/react-native-naver-map` (Naver Maps) |
| 상태 관리 | Zustand |
| 백엔드 | Supabase (PostgreSQL + PostGIS, Storage, Auth, Edge Functions) |
| 인증 | 카카오 로그인(`@react-native-kakao`), Supabase 익명 로그인 |
| 경로 맵매칭 | Mapbox Map Matching API (Supabase Edge Function에서 호출) |
| 사진 클리핑 | Supabase Edge Function + Jimp (지역 폴리곤 모양대로 픽셀 마스킹) |

## 프로젝트 구조

```
app/                    # Expo Router 화면 (파일 기반 라우팅)
  (auth)/               # 로그인
  (tabs)/               # 지도 / 랭킹 / 통계 / 프로필 탭
src/
  services/              # locationTracker, geo(point-in-polygon), mapMatcher, supabase 클라이언트 등
  components/             # 재사용 컴포넌트 (사진 크롭 UI 등)
  stores/                 # Zustand 스토어
  theme.ts                # 디자인 토큰
assets/                   # 아이콘, 로고, 시/군/구 GeoJSON(korea-cities.json)
supabase/
  migrations/             # DB 스키마 / RPC 함수
  functions/               # Edge Functions (카카오 인증, 맵매칭, 사진 클리핑)
ios/, android/            # 네이티브 프로젝트 (checked-in)
```

## 시작하기

### 1. 의존성 설치

```bash
npm install
```

### 2. 환경 변수

`.env.example`을 참고해 `.env` 파일을 만들고 값을 채운다.

```
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_ANON_KEY=
EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN=
EXPO_PUBLIC_NAVER_MAP_CLIENT_ID=
EXPO_PUBLIC_KAKAO_NATIVE_KEY=
KAKAO_REST_API_KEY=
```

### 3. 실기기 빌드 (iOS)

이 프로젝트는 `expo start` / Expo Go가 아니라 **Xcode 직접 빌드 + devicectl 설치**로 실기기 테스트한다 (`ios/` 폴더가 checked-in되어 있음).

```bash
# 빌드
EXPO_USE_PRECOMPILED_MODULES=false REACT_NATIVE_PRODUCTION=1 xcodebuild \
  -workspace ios/Driend.xcworkspace -scheme Driend -configuration Release \
  -destination "platform=iOS,id=<DEVICE_UDID>" -allowProvisioningUpdates

# 설치
xcrun devicectl device install app --device <DEVICE_UDID> \
  "<DerivedData 경로>/Build/Products/Release-iphoneos/Driend.app"
```

자세한 개발 규칙(네이티브 의존성 추가, prebuild 시 주의사항 등)은 [`AGENTS.md`](./AGENTS.md) 참고.

## 데이터베이스

`supabase/migrations/`에 스키마와 RPC 함수(랭킹 집계, 통계 조회 등)가 마이그레이션 단위로 정리되어 있다. `supabase/functions/`에는 카카오 인증 콜백, 경로 맵매칭, 사진 클리핑용 Edge Function이 있다.

## 알려진 한계

경로 시각화에서 왕복 도로가 지도에 평행선 2개로 표시될 수 있다. Valhalla map-matching이 편도/왕복 차선을 별도 center line(~40m 간격)으로 스냅하기 때문으로, 도로 토폴로지 데이터 없이는 해결이 어렵다.
