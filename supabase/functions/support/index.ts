const HTML = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Driend 고객지원</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", sans-serif;
    line-height: 1.7; color: #1a1a1a; max-width: 720px; margin: 0 auto; padding: 32px 20px 80px; }
  h1 { font-size: 22px; margin-bottom: 4px; }
  .sub { color: #666; font-size: 13px; margin-bottom: 32px; }
  h2 { font-size: 17px; margin-top: 32px; border-left: 4px solid #047857; padding-left: 10px; }
  p, li { font-size: 14.5px; }
  ul { padding-left: 20px; }
  a { color: #047857; }
  .contact { background: #f3f4f6; border-radius: 10px; padding: 16px 18px; margin-top: 12px; }
</style>
</head>
<body>
<h1>Driend 고객지원</h1>
<div class="sub">문의사항이나 불편사항을 알려주세요</div>

<h2>문의하기</h2>
<p>앱 이용 중 궁금한 점, 버그 신고, 개선 제안이 있으시면 아래 이메일로 연락해주세요. 최대한 빠르게 답변드리겠습니다.</p>
<div class="contact">
  <strong>이메일:</strong> <a href="mailto:jeontaehyun0203@gmail.com">jeontaehyun0203@gmail.com</a>
</div>

<h2>자주 묻는 질문</h2>
<ul>
  <li><strong>주행 기록이 안 돼요.</strong> 설정 &gt; Driend &gt; 위치에서 "항상 허용"으로 설정돼 있는지 확인해주세요. 백그라운드에서도 경로를 기록하려면 이 권한이 필요합니다.</li>
  <li><strong>계정을 삭제하고 싶어요.</strong> 앱 내 프로필 탭 &gt; 회원 탈퇴 메뉴에서 즉시 처리할 수 있습니다.</li>
  <li><strong>사진이 적용이 안 돼요.</strong> 앱을 완전히 종료했다가 다시 실행해보시고, 그래도 안 되면 이메일로 알려주세요.</li>
</ul>

<h2>기타 안내</h2>
<p>
개인정보처리방침은 <a href="https://vrcaacjnbslqrioihwnt.supabase.co/functions/v1/privacy-policy">여기</a>,
이용약관은 <a href="https://vrcaacjnbslqrioihwnt.supabase.co/functions/v1/terms-of-service">여기</a>에서 확인하실 수 있습니다.
</p>

</body>
</html>`;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve((req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  return new Response(HTML, {
    headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' },
  });
});
