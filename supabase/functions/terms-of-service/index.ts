const HTML = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Driend 이용약관</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", sans-serif;
    line-height: 1.7; color: #1a1a1a; max-width: 720px; margin: 0 auto; padding: 32px 20px 80px; }
  h1 { font-size: 22px; margin-bottom: 4px; }
  .sub { color: #666; font-size: 13px; margin-bottom: 32px; }
  h2 { font-size: 17px; margin-top: 32px; border-left: 4px solid #047857; padding-left: 10px; }
  p, li { font-size: 14.5px; }
  ul { padding-left: 20px; }
</style>
</head>
<body>
<h1>Driend 이용약관</h1>
<div class="sub">시행일자: 2026년 7월 23일</div>

<h2>제1조 (목적)</h2>
<p>
본 약관은 Driend(이하 "서비스")의 이용과 관련하여 서비스 운영자와 이용자 간의 권리, 의무 및
책임사항, 기타 필요한 사항을 규정함을 목적으로 합니다.
</p>

<h2>제2조 (정의)</h2>
<ul>
  <li>"서비스"란 주행 경로 기록, 통계 산출, 지역 방문 인증, 친구 간 랭킹 비교 등을 제공하는
  Driend 애플리케이션을 말합니다.</li>
  <li>"이용자"란 본 약관에 따라 서비스를 이용하는 회원을 말합니다.</li>
  <li>"회원"이란 카카오 계정을 연동하여 서비스에 가입한 자를 말합니다.</li>
</ul>

<h2>제3조 (서비스의 내용)</h2>
<ul>
  <li>GPS 기반 주행 경로 기록 및 거리·속도·제로백 등 통계 제공</li>
  <li>방문한 지역 인증 및 지역 사진 등록·표시</li>
  <li>친구 등록 및 친구 간 주행 기록·랭킹 비교</li>
  <li>주행 감지 알림 등 부가 기능</li>
</ul>

<h2>제4조 (회원가입 및 탈퇴)</h2>
<p>
이용자는 카카오 계정 연동을 통해 회원가입을 신청하며, 서비스 운영자가 이를 승낙함으로써 회원가입이
완료됩니다. 회원은 앱 내 "프로필 &gt; 회원 탈퇴" 메뉴를 통해 언제든 자유롭게 탈퇴할 수 있으며,
탈퇴 즉시 관련 데이터가 삭제됩니다.
</p>

<h2>제5조 (이용자의 의무)</h2>
<ul>
  <li>이용자는 타인의 개인정보, 저작물, 초상권을 침해하는 사진이나 정보를 업로드해서는 안 됩니다.</li>
  <li>이용자는 허위 정보를 등록하거나 타인의 계정을 도용해서는 안 됩니다.</li>
  <li>이용자는 서비스의 정상적인 운영을 방해하는 행위를 해서는 안 됩니다.</li>
  <li>이용자는 관계 법령, 본 약관의 규정, 이용안내 및 서비스와 관련하여 공지한 주의사항을
  준수하여야 합니다.</li>
</ul>

<h2>제6조 (서비스 제공자의 의무 및 면책)</h2>
<p>
서비스 운영자는 안정적인 서비스 제공을 위해 노력하나, GPS 신호 오차, 기기·통신 환경, 지도 데이터의
한계 등으로 인해 발생하는 주행 기록의 오차에 대해서는 책임을 지지 않습니다. 천재지변, 불가항력적
사유로 서비스를 제공할 수 없는 경우 서비스 제공 책임이 면제됩니다.
</p>

<h2>제7조 (저작권 및 콘텐츠의 이용)</h2>
<p>
이용자가 서비스 내에 업로드한 사진 및 콘텐츠에 대한 저작권은 해당 이용자에게 있습니다. 다만
이용자는 서비스 운영자가 서비스 제공·개선을 위해 해당 콘텐츠를 서비스 내에서 표시·저장하는 것을
허락합니다.
</p>

<h2>제8조 (약관의 변경)</h2>
<p>
서비스 운영자는 필요한 경우 본 약관을 변경할 수 있으며, 변경 시 적용일자 및 변경사유를 명시하여
시행일 이전에 앱 내 공지를 통해 안내합니다.
</p>

<h2>제9조 (분쟁 해결)</h2>
<p>
서비스 이용과 관련하여 분쟁이 발생한 경우, 서비스 운영자와 이용자는 상호 협의하여 원만히
해결하도록 노력합니다. 문의사항은 jeontaehyun0203@gmail.com 으로 접수할 수 있습니다.
</p>

<h2>부칙</h2>
<p>본 약관은 2026년 7월 23일부터 시행합니다.</p>

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
