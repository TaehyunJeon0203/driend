import { supabase } from './supabase';

type LngLat = [number, number];

const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN!;
// Mapbox Map Matching API 요청 1회당 좌표 100개 하드 리밋 (공식 문서 권장: 초과 시 나눠서 여러 번 요청)
const MAX_COORDS = 100;
// 청크 경계에서 매칭이 끊겨 보이지 않도록 앞 청크와 겹치게 자름
const CHUNK_OVERLAP = 5;

async function callMatchAPI(coords: LngLat[]): Promise<LngLat[] | null> {
  const coordStr = coords.map(([lng, lat]) => `${lng},${lat}`).join(';');
  try {
    const res = await fetch(
      `https://api.mapbox.com/matching/v5/mapbox/driving/${coordStr}?access_token=${MAPBOX_TOKEN}&overview=full&geometries=geojson&tidy=true`
    );
    const data = await res.json();
    if (data.code !== 'Ok' || !data.matchings?.length) return null;
    return data.matchings[0].geometry.coordinates as LngLat[];
  } catch {
    return null;
  }
}

async function matchRoute(allCoords: LngLat[]): Promise<LngLat[] | null> {
  if (allCoords.length < 2) return null;

  // 100개 이하면 한 번에, 초과하면 겹치게 나눠서 순차 호출 후 이어붙임 — 이전엔 전체를
  // 100개로 균등 샘플링해서 긴 주행일수록 포인트 간격이 벌어져 커브가 직선으로 잘려 보였음
  if (allCoords.length <= MAX_COORDS) {
    return callMatchAPI(allCoords);
  }

  const step = MAX_COORDS - CHUNK_OVERLAP;
  const matched: LngLat[] = [];
  for (let i = 0; i < allCoords.length; i += step) {
    const chunk = allCoords.slice(i, i + MAX_COORDS);
    if (chunk.length < 2) break;
    const result = await callMatchAPI(chunk);
    if (result) matched.push(...result);
    if (i + MAX_COORDS >= allCoords.length) break;
  }

  return matched.length >= 2 ? matched : null;
}

export async function processMatchAsync(driveId: string): Promise<void> {
  const { data } = await supabase.rpc('get_drive_coords', { p_drive_id: driveId });
  if (!data || data.length < 10) return;

  const coords: LngLat[] = data.map((r: { lng: number; lat: number }) => [r.lng, r.lat]);
  const matched = await matchRoute(coords);
  if (!matched || matched.length < 2) return;

  await supabase.from('drives').update({ matched_geometry: matched }).eq('id', driveId);
}
