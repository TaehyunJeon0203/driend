import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { Buffer } from 'node:buffer';
import { Jimp } from 'npm:jimp@^1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type Coord = { latitude: number; longitude: number };

function isInsideAnyRing(px: number, py: number, rings: { x: number; y: number }[][]): boolean {
  for (const ring of rings) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i].x, yi = ring[i].y;
      const xj = ring[j].x, yj = ring[j].y;
      if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) {
        inside = !inside;
      }
    }
    if (inside) return true;
  }
  return false;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return new Response('Unauthorized', { status: 401 });

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (!user || authError) return new Response('Unauthorized', { status: 401 });

    const { photoUrl, polygons, bboxRegion, storagePath } = await req.json() as {
      photoUrl: string;
      polygons: Coord[][];
      bboxRegion: { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number };
      storagePath: string;
    };

    // Deno native fetch → Node.js Buffer (jimp이 이해하는 형식)
    const photoRes = await fetch(photoUrl);
    if (!photoRes.ok) throw new Error(`사진 다운로드 실패: ${photoRes.status}`);
    const photoBuffer = Buffer.from(await photoRes.arrayBuffer());

    const image = await Jimp.read(photoBuffer);

    const minLat = bboxRegion.latitude;
    const maxLat = bboxRegion.latitude + bboxRegion.latitudeDelta;
    const minLng = bboxRegion.longitude;
    const maxLng = bboxRegion.longitude + bboxRegion.longitudeDelta;

    // 지역 bbox의 실제 가로세로 비율 유지 (경도는 위도 보정, 크롭 화면과 동일한 계산)
    const avgLatRad = ((minLat + maxLat) / 2) * (Math.PI / 180);
    const geoW = (maxLng - minLng) * Math.cos(avgLatRad);
    const geoH = maxLat - minLat;
    const aspect = geoW / geoH;
    const MAX_DIM = 800;
    let targetW = MAX_DIM, targetH = MAX_DIM / aspect;
    if (targetH > MAX_DIM) { targetH = MAX_DIM; targetW = MAX_DIM * aspect; }
    await image.resize({ w: Math.round(targetW), h: Math.round(targetH) });

    const { width, height } = image;

    // 폴리곤 좌표 → 픽셀 공간으로 변환 (한 번만)
    const pixelRings = polygons.map((ring) =>
      ring.map((pt) => ({
        x: (pt.longitude - minLng) / (maxLng - minLng) * width,
        y: (maxLat - pt.latitude) / (maxLat - minLat) * height,
      }))
    );

    // 폴리곤 바깥 픽셀 투명화
    const data = image.bitmap.data as Buffer;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (!isInsideAnyRing(x + 0.5, y + 0.5, pixelRings)) {
          data[(y * width + x) * 4 + 3] = 0;
        }
      }
    }

    const outputBuffer = await image.getBuffer('image/png');

    const clippedPath = storagePath.replace(/\.[^.]+$/, '_clipped.png');
    const { error: uploadError } = await supabase.storage
      .from('city-photos')
      .upload(clippedPath, outputBuffer, { contentType: 'image/png', upsert: true });
    if (uploadError) throw uploadError;

    const { data: { publicUrl } } = supabase.storage
      .from('city-photos')
      .getPublicUrl(clippedPath);

    return new Response(JSON.stringify({ url: publicUrl }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('clip-city-photo error:', (err as Error).message, (err as Error).stack);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
