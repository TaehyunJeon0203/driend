import { supabase } from './supabase';

// city-photos 업로드에서 확인된 문제(HEIC 오라벨링, iOS 광색역 PNG)를 피하려고
// expo-image-picker에서 JPEG로 강제 변환된 결과만 받는다는 전제로 mimeType 고정
export async function uploadAvatar(userId: string, imageUri: string): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('세션 없음');

  const path = `${userId}/avatar.jpg`;
  const formData = new FormData();
  formData.append('file', { uri: imageUri, name: 'avatar.jpg', type: 'image/jpeg' } as any);

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${process.env.EXPO_PUBLIC_SUPABASE_URL}/storage/v1/object/avatars/${path}`);
    xhr.setRequestHeader('Authorization', `Bearer ${session.access_token}`);
    xhr.setRequestHeader('x-upsert', 'true');
    xhr.onload = () => {
      if (xhr.status < 300) resolve();
      else { try { reject(new Error(JSON.parse(xhr.responseText).message)); } catch { reject(new Error('업로드 실패')); } }
    };
    xhr.onerror = () => reject(new Error('네트워크 오류'));
    xhr.send(formData);
  });

  const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(path);
  // 같은 경로를 덮어쓰므로 URL이 동일 — CDN 캐시 무효화용 쿼리스트링
  return `${publicUrl}?v=${Date.now()}`;
}
