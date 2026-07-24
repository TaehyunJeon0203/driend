// 사진 모드 축소 상태(전국 조망) 전용 저해상도 시군구 데이터셋 생성.
// 시/군/구 개별 경계는 그대로 유지하되(도 단위로 뭉개지 않음), 그 축척에서
// 어차피 안 보이는 요소를 정리해서 렌더링 오브젝트/정점 수만 줄인다:
//   1) 도시 하나에 딸린 아주 작은 섬(2km² 미만)은 제외 — 단, 그 도시의 유일한
//      조각이면 화면에서 아예 사라지지 않도록 예외로 남겨둠
//   2) 남은 링은 simplify-js로 정점을 더 단순화(원본보다 더 굵은 tolerance)
//
// 실행: node scripts/generate-simplified-cities.mjs

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import simplify from 'simplify-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const CITIES = JSON.parse(readFileSync(path.join(ROOT, 'assets/korea-cities.json'), 'utf-8'));

const MIN_RING_AREA_KM2 = 2.0;
const SIMPLIFY_TOLERANCE_DEG = 0.01; // 원본 생성 시 tolerance(0.0005)보다 훨씬 굵게

function ringAreaKm2(ring) {
  const avgLatRad = (ring.reduce((s, p) => s + p.latitude, 0) / ring.length) * (Math.PI / 180);
  const k = Math.cos(avgLatRad);
  let area = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    area += a.longitude * k * b.latitude - b.longitude * k * a.latitude;
  }
  return Math.abs(area) / 2 * (111.32 ** 2);
}

function simplifyRing(ring) {
  const points = ring.map((p) => ({ x: p.longitude, y: p.latitude }));
  const simplified = simplify(points, SIMPLIFY_TOLERANCE_DEG, true);
  if (simplified.length < 4) return ring; // 삼각형 미만으로 뭉개지면 원본 유지
  const result = simplified.map((p) => ({ latitude: p.y, longitude: p.x }));
  // 폐곡선 유지 (첫 좌표 === 끝 좌표)
  const first = result[0];
  const last = result[result.length - 1];
  if (first.latitude !== last.latitude || first.longitude !== last.longitude) result.push(first);
  return result;
}

let totalRingsBefore = 0;
let totalRingsAfter = 0;
let totalVertsBefore = 0;
let totalVertsAfter = 0;

const result = CITIES.map((city) => {
  totalRingsBefore += city.polygons.length;
  totalVertsBefore += city.polygons.reduce((s, r) => s + r.length, 0);

  const withArea = city.polygons.map((ring) => ({ ring, area: ringAreaKm2(ring) }));
  let kept = withArea.filter((r) => r.area >= MIN_RING_AREA_KM2);
  if (kept.length === 0) {
    // 전부 작은 섬뿐인 도시(예: 초소형 도서 지역)는 가장 큰 조각만 남김
    kept = [withArea.reduce((a, b) => (a.area >= b.area ? a : b))];
  }

  const polygons = kept.map(({ ring }) => simplifyRing(ring));
  totalRingsAfter += polygons.length;
  totalVertsAfter += polygons.reduce((s, r) => s + r.length, 0);

  return { code: city.code, name: city.name, province_code: city.province_code, center: city.center, polygons };
});

writeFileSync(
  path.join(ROOT, 'assets/korea-cities-simplified.json'),
  JSON.stringify(result)
);

console.log(`생성 완료: assets/korea-cities-simplified.json`);
console.log(`링 수: ${totalRingsBefore} -> ${totalRingsAfter}`);
console.log(`정점 수: ${totalVertsBefore} -> ${totalVertsAfter}`);
