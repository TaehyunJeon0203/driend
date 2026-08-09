// 헷갈리기 쉬운 글자(0/O, 1/I 등) 제외한 문자셋으로 무작위 태그 생성
const TAG_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateRandomTag(length = 4): string {
  let tag = '';
  for (let i = 0; i < length; i++) {
    tag += TAG_CHARS[Math.floor(Math.random() * TAG_CHARS.length)];
  }
  return tag;
}
