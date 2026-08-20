import { supabase } from './supabase';
import type { DriveResult } from './driveResultUtils';

export * from './driveResultUtils';

export async function uploadDriveResultCard(driveId: string, uri: string): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) throw new Error('로그인이 필요해요.');

  const path = `${session.user.id}/${driveId}.png`;
  const formData = new FormData();
  formData.append('file', { uri, name: 'result.png', type: 'image/png' } as any);

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${process.env.EXPO_PUBLIC_SUPABASE_URL}/storage/v1/object/drive-result-cards/${path}`);
    xhr.setRequestHeader('Authorization', `Bearer ${session.access_token}`);
    xhr.setRequestHeader('x-upsert', 'true');
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error('주행 인증 카드 업로드에 실패했어요.'));
    };
    xhr.onerror = () => reject(new Error('네트워크 오류로 카드를 업로드하지 못했어요.'));
    xhr.send(formData);
  });

  const { error } = await supabase.from('drives').update({ result_image_path: path }).eq('id', driveId).eq('user_id', session.user.id);
  if (error) throw error;
}

type DriveResultRow = {
  id: string;
  started_at: string;
  ended_at: string | null;
  distance_km: number | null;
  max_speed_kmh: number | null;
  start_address: string | null;
  end_address: string | null;
  result_image_path: string | null;
  route_points: Array<{
    lat: number;
    lng: number;
    speed_kmh: number | null;
    recorded_at: string;
  }> | null;
};

export async function fetchDriveResult(driveId: string): Promise<DriveResult> {
  const { data, error } = await supabase.rpc('get_drive_result', { p_drive_id: driveId });
  if (error) throw error;
  const row = (data as DriveResultRow[] | null)?.[0];
  if (!row) throw new Error('주행 기록을 찾을 수 없어요.');

  return {
    id: row.id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    distanceKm: Number(row.distance_km) || 0,
    maxSpeedKmh: Number(row.max_speed_kmh) || 0,
    resultImageUrl: row.result_image_path
      ? supabase.storage.from('drive-result-cards').getPublicUrl(row.result_image_path).data.publicUrl
      : null,
    startAddress: row.start_address,
    endAddress: row.end_address,
    points: (row.route_points ?? []).map((point) => ({
      latitude: Number(point.lat),
      longitude: Number(point.lng),
      speedKmh: point.speed_kmh == null ? null : Number(point.speed_kmh),
      recordedAt: point.recorded_at,
    })).filter((point) => Number.isFinite(point.latitude) && Number.isFinite(point.longitude)),
  };
}
