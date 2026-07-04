import { supabase } from './supabase';

type LngLat = [number, number];

const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN!;
const MAX_COORDS = 100;

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

  // 100개 초과 시 균등 샘플링
  let coords = allCoords;
  if (allCoords.length > MAX_COORDS) {
    const step = Math.ceil(allCoords.length / MAX_COORDS);
    coords = allCoords.filter((_, i) => i % step === 0);
    if (coords[coords.length - 1] !== allCoords[allCoords.length - 1]) {
      coords.push(allCoords[allCoords.length - 1]);
    }
    coords = coords.slice(0, MAX_COORDS);
  }

  return callMatchAPI(coords);
}

export async function processMatchAsync(driveId: string): Promise<void> {
  const { data } = await supabase.rpc('get_drive_coords', { p_drive_id: driveId });
  if (!data || data.length < 10) return;

  const coords: LngLat[] = data.map((r: { lng: number; lat: number }) => [r.lng, r.lat]);
  const matched = await matchRoute(coords);
  if (!matched || matched.length < 2) return;

  await supabase.from('drives').update({ matched_geometry: matched }).eq('id', driveId);
}
