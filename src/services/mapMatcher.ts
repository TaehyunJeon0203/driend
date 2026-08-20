import { supabase } from './supabase';
import { haversineMeters } from './routeTrackingUtils';

export type LngLat = [number, number];
type MatchChunk = (coords: LngLat[]) => Promise<LngLat[] | null>;

const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN!;
// Mapbox Map Matching API 요청 1회당 좌표 100개 하드 리밋 (공식 문서 권장: 초과 시 나눠서 여러 번 요청)
const MAX_COORDS = 100;
// 청크 경계에서 매칭이 끊겨 보이지 않도록 앞 청크와 겹치게 자름
const CHUNK_OVERLAP = 5;
const MAX_SEAM_DISTANCE_METERS = 50;

export function mergeMatchedChunks(previous: LngLat[], next: LngLat[]): LngLat[] | null {
  let best: { previousIndex: number; nextIndex: number; distance: number } | null = null;
  const previousStart = Math.max(0, previous.length - 100);
  const nextEnd = Math.min(next.length, 100);
  for (let previousIndex = previousStart; previousIndex < previous.length; previousIndex++) {
    for (let nextIndex = 0; nextIndex < nextEnd; nextIndex++) {
      const distance = haversineMeters(
        { longitude: previous[previousIndex][0], latitude: previous[previousIndex][1] },
        { longitude: next[nextIndex][0], latitude: next[nextIndex][1] },
      );
      if (distance <= MAX_SEAM_DISTANCE_METERS
        && (!best || distance < best.distance
          || (distance === best.distance && previousIndex > best.previousIndex)
          || (distance === best.distance && previousIndex === best.previousIndex && nextIndex < best.nextIndex))) {
        best = { previousIndex, nextIndex, distance };
      }
    }
  }
  if (!best) return null;
  return [...previous.slice(0, best.previousIndex + 1), ...next.slice(best.nextIndex + 1)];
}

async function callMatchAPI(coords: LngLat[]): Promise<LngLat[] | null> {
  const coordStr = coords.map(([lng, lat]) => `${lng},${lat}`).join(';');
  try {
    const res = await fetch(
      `https://api.mapbox.com/matching/v5/mapbox/driving/${coordStr}?access_token=${MAPBOX_TOKEN}&overview=full&geometries=geojson&tidy=true`
    );
    const data = await res.json();
    if (data.code !== 'Ok' || data.matchings?.length !== 1) return null;
    return data.matchings[0].geometry.coordinates as LngLat[];
  } catch {
    return null;
  }
}

export async function matchRoute(allCoords: LngLat[], matchChunk: MatchChunk = callMatchAPI): Promise<LngLat[] | null> {
  if (allCoords.length < 2) return null;

  // 100개 이하면 한 번에, 초과하면 겹치게 나눠서 순차 호출 후 이어붙임 — 이전엔 전체를
  // 100개로 균등 샘플링해서 긴 주행일수록 포인트 간격이 벌어져 커브가 직선으로 잘려 보였음
  if (allCoords.length <= MAX_COORDS) {
    return matchChunk(allCoords);
  }

  const step = MAX_COORDS - CHUNK_OVERLAP;
  let matched: LngLat[] | null = null;
  for (let i = 0; i < allCoords.length; i += step) {
    const chunk = allCoords.slice(i, i + MAX_COORDS);
    if (chunk.length < 2) break;
    const result = await matchChunk(chunk);
    if (!result || result.length < 2) return null;
    if (!matched) matched = result;
    else matched = mergeMatchedChunks(matched, result);
    // Saving any proper subset would hide the missing run and let the route appear complete.
    if (!matched) return null;
    if (i + MAX_COORDS >= allCoords.length) break;
  }

  return matched && matched.length >= 2 ? matched : null;
}

export async function processMatchAsync(driveId: string): Promise<void> {
  const { data } = await supabase.rpc('get_drive_coords', { p_drive_id: driveId });
  if (!data || data.length < 10) return;

  const coords: LngLat[] = data.map((r: { lng: number; lat: number }) => [r.lng, r.lat]);
  const matched = await matchRoute(coords);
  if (!matched || matched.length < 2) return;

  await supabase.from('drives').update({ matched_geometry: matched }).eq('id', driveId);
}
