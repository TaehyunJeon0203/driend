import { supabase } from './supabase';
import CITY_DATA from '../../assets/korea-cities.json';

type Coord = { latitude: number; longitude: number };
type CityGeo = { code: string; polygons: Coord[][] };

const CITIES = CITY_DATA as CityGeo[];

export async function clipAndUploadCityPhoto(params: {
  cityCode: string;
  storagePath: string;
  publicUrl: string;
}): Promise<{ url: string; error?: string }> {
  const { cityCode, storagePath, publicUrl } = params;

  const cityGeo = CITIES.find((c) => c.code === cityCode);
  if (!cityGeo || !cityGeo.polygons.length) return { url: publicUrl, error: '지역 폴리곤 없음' };

  const all = cityGeo.polygons.flat();
  const minLat = all.reduce((m, c) => Math.min(m, c.latitude), Infinity);
  const maxLat = all.reduce((m, c) => Math.max(m, c.latitude), -Infinity);
  const minLng = all.reduce((m, c) => Math.min(m, c.longitude), Infinity);
  const maxLng = all.reduce((m, c) => Math.max(m, c.longitude), -Infinity);

  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { url: publicUrl, error: '세션 없음' };

  try {
    const res = await fetch(
      `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/clip-city-photo`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          photoUrl: publicUrl,
          polygons: cityGeo.polygons,
          bboxRegion: {
            latitude: minLat,
            longitude: minLng,
            latitudeDelta: maxLat - minLat,
            longitudeDelta: maxLng - minLng,
          },
          storagePath,
        }),
      }
    );

    if (!res.ok) {
      const text = await res.text();
      console.warn('clip-city-photo failed:', text);
      return { url: publicUrl, error: `HTTP ${res.status}: ${text}` };
    }

    const { url } = await res.json();
    return { url: url ?? publicUrl };
  } catch (e: any) {
    console.warn('clip-city-photo error:', e);
    return { url: publicUrl, error: e?.message ?? String(e) };
  }
}
