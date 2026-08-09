import { supabase } from './supabase';
import { clipAndUploadCityPhoto } from './cityPhotoClipper';

export type CityPhoto = {
  id: string;
  visited_city_id: string;
  storage_path: string;
  url: string;
  is_cover: boolean;
  position: number;
};

export async function listCityPhotos(visitedCityId: string): Promise<CityPhoto[]> {
  const { data } = await supabase
    .from('city_photos')
    .select('id, visited_city_id, storage_path, url, is_cover, position')
    .eq('visited_city_id', visitedCityId)
    .order('position', { ascending: true });
  return data ?? [];
}

// iOS 갤러리는 기본적으로 HEIC 포맷을 주는 경우가 많음. 무조건 PNG로 라벨링해서 올리면
// 서버(Jimp)가 실제 HEIC 바이트를 못 읽어 클리핑이 실패함 — 실제 mimeType/확장자를 맞춰서 업로드
function extFromMimeType(mimeType?: string): string {
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/heic' || mimeType === 'image/heif') return 'heic';
  return 'jpg';
}

async function uploadToStorage(path: string, imageUri: string, mimeType: string): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('세션 없음');

  const formData = new FormData();
  formData.append('file', { uri: imageUri, name: `photo.${extFromMimeType(mimeType)}`, type: mimeType } as any);
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${process.env.EXPO_PUBLIC_SUPABASE_URL}/storage/v1/object/city-photos/${path}`);
    xhr.setRequestHeader('Authorization', `Bearer ${session.access_token}`);
    xhr.setRequestHeader('x-upsert', 'true');
    xhr.onload = () => {
      if (xhr.status < 300) resolve();
      else { try { reject(new Error(JSON.parse(xhr.responseText).message)); } catch { reject(new Error('업로드 실패')); } }
    };
    xhr.onerror = () => reject(new Error('네트워크 오류'));
    xhr.send(formData);
  });

  const { data: { publicUrl } } = supabase.storage.from('city-photos').getPublicUrl(path);
  // 같은 경로를 덮어쓰는 경우(재크롭 등) CDN이 이전 파일을 계속 서빙하는 걸 방지
  return `${publicUrl}?v=${Date.now()}`;
}

async function insertCityPhoto(params: {
  userId: string;
  visitedCityId: string;
  imageUri: string;
  mimeType: string;
  position: number;
}): Promise<CityPhoto> {
  const { userId, visitedCityId, imageUri, mimeType, position } = params;
  const path = `${userId}/${visitedCityId}/${Date.now()}-${position}.${extFromMimeType(mimeType)}`;
  const url = await uploadToStorage(path, imageUri, mimeType);

  const { data, error } = await supabase
    .from('city_photos')
    .insert({
      visited_city_id: visitedCityId,
      user_id: userId,
      storage_path: path,
      url,
      is_cover: false,
      position,
    })
    .select('id, visited_city_id, storage_path, url, is_cover, position')
    .single();
  if (error || !data) throw error ?? new Error('사진 등록 실패');
  return data;
}

// 방문 도시에 사진 여러 장을 병렬로 추가. 도시의 첫 배치면 그중 첫 장을 자동으로
// 대표사진(지도 오버레이용)으로 지정 — 클리핑은 배치당 한 번만 실행됨.
export async function addCityPhotos(params: {
  userId: string;
  visitedCityId: string;
  cityCode: string;
  images: { uri: string; mimeType?: string }[];
  onProgress?: (done: number, total: number) => void;
}): Promise<CityPhoto[]> {
  const { userId, visitedCityId, cityCode, images, onProgress } = params;

  const existing = await listCityPhotos(visitedCityId);
  const needsCover = existing.length === 0;

  let done = 0;
  const uploaded = await Promise.all(
    images.map((img, i) =>
      insertCityPhoto({
        userId, visitedCityId, imageUri: img.uri,
        mimeType: img.mimeType ?? 'image/jpeg', position: existing.length + i,
      }).then((photo) => {
        done++;
        onProgress?.(done, images.length);
        return photo;
      })
    )
  );

  if (needsCover && uploaded.length > 0) {
    await setCoverPhoto({ visitedCityId, cityCode, photo: uploaded[0] });
    uploaded[0].is_cover = true;
  }

  return uploaded;
}

// 기존에 등록된 사진 중 하나를 대표사진(지도 오버레이용)으로 지정.
// 도시 모양대로 클리핑한 결과를 별도 고정 경로에 저장해 원본 갤러리 사진은 그대로 둠.
export async function setCoverPhoto(params: {
  visitedCityId: string;
  cityCode: string;
  photo: CityPhoto;
}): Promise<void> {
  const { visitedCityId, cityCode, photo } = params;
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return;

  const coverPath = `${session.user.id}/${visitedCityId}/cover.png`;
  const { url: clippedUrl, error: clipError } = await clipAndUploadCityPhoto({
    cityCode, storagePath: coverPath, publicUrl: photo.url,
  });
  if (clipError) console.warn('clip-city-photo failed:', clipError);

  // 클리핑 결과는 항상 같은 경로에 덮어써져 URL이 동일 — 캐시버스터 필요
  // (클리핑 실패 시 폴백 URL에 이미 쿼리스트링이 붙어있을 수 있어 먼저 제거하고 새로 붙임)
  const cacheBustedUrl = `${clippedUrl.split('?')[0]}?v=${Date.now()}`;

  await supabase.from('city_photos').update({ is_cover: false }).eq('visited_city_id', visitedCityId);
  await supabase.from('city_photos').update({ is_cover: true }).eq('id', photo.id);
  await supabase.from('visited_cities').update({ photo_url: cacheBustedUrl }).eq('id', visitedCityId);
}

// 갤러리에서 순서를 바꾼 뒤 position 컬럼을 일괄 반영.
export async function reorderCityPhotos(photos: CityPhoto[]): Promise<void> {
  await Promise.all(
    photos.map((p, position) =>
      p.position === position ? Promise.resolve() : supabase.from('city_photos').update({ position }).eq('id', p.id)
    )
  );
}

// 순서 변경으로 1번(대표) 사진이 바뀐 경우 — 새로 프레이밍한 이미지를 원본 자리에 덮어쓰고 재클리핑.
export async function recropAndSetCover(params: {
  visitedCityId: string;
  cityCode: string;
  photo: CityPhoto;
  croppedUri: string;
}): Promise<void> {
  const { visitedCityId, cityCode, photo, croppedUri } = params;
  const newUrl = await uploadToStorage(photo.storage_path, croppedUri, 'image/jpeg');
  await supabase.from('city_photos').update({ url: newUrl }).eq('id', photo.id);
  await setCoverPhoto({ visitedCityId, cityCode, photo: { ...photo, url: newUrl } });
}

// 사진 삭제. 대표사진이었으면 남은 사진 중 하나를 새 대표사진으로 승격, 없으면 오버레이 제거.
export async function deleteCityPhoto(params: {
  visitedCityId: string;
  cityCode: string;
  photo: CityPhoto;
}): Promise<void> {
  return deleteCityPhotos({ visitedCityId: params.visitedCityId, cityCode: params.cityCode, photos: [params.photo] });
}

// 여러 장을 한 번에 삭제. 개별 삭제를 반복 호출하면 도중에 바뀐 대표사진 상태를 놓칠 수 있어
// (예: 대표사진 삭제로 다른 사진이 승격된 직후 그 사진도 지워지는 경우) 전부 지운 뒤
// 마지막에 한 번만 서버 최신 상태를 조회해서 대표사진을 정리함.
export async function deleteCityPhotos(params: {
  visitedCityId: string;
  cityCode: string;
  photos: CityPhoto[];
}): Promise<void> {
  const { visitedCityId, cityCode, photos } = params;
  if (!photos.length) return;

  await Promise.all(photos.map((photo) => supabase.storage.from('city-photos').remove([photo.storage_path])));
  await supabase.from('city_photos').delete().in('id', photos.map((p) => p.id));

  const remaining = await listCityPhotos(visitedCityId);
  if (remaining.length === 0) {
    await supabase.from('visited_cities').update({ photo_url: null }).eq('id', visitedCityId);
  } else if (!remaining.some((p) => p.is_cover)) {
    await setCoverPhoto({ visitedCityId, cityCode, photo: remaining[0] });
  }
}
