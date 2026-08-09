-- 개인정보처리방침/이용약관 정적 HTML 호스팅용 버킷.
-- Edge Function으로 서빙하면 Supabase 게이트웨이가 Content-Type을 text/plain으로
-- 강제 재작성해 브라우저가 HTML을 렌더링하지 않고 소스 그대로 보여주는 문제가 있었음
-- (함수 코드에서 text/html; charset=utf-8을 명시해도 무시됨). Storage 객체는 업로드 시
-- 지정한 Content-Type을 그대로 서빙하므로 이 문제가 없음.
insert into storage.buckets (id, name, public)
values ('legal', 'legal', true)
on conflict (id) do nothing;

drop policy if exists "public_read_legal" on storage.objects;
create policy "public_read_legal"
  on storage.objects for select
  using (bucket_id = 'legal');
