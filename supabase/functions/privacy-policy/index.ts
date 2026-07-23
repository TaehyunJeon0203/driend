const HTML = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Driend 개인정보처리방침</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", sans-serif;
    line-height: 1.7; color: #1a1a1a; max-width: 720px; margin: 0 auto; padding: 32px 20px 80px; }
  h1 { font-size: 22px; margin-bottom: 4px; }
  .sub { color: #666; font-size: 13px; margin-bottom: 32px; }
  h2 { font-size: 17px; margin-top: 32px; border-left: 4px solid #047857; padding-left: 10px; }
  p, li { font-size: 14.5px; }
  table { border-collapse: collapse; width: 100%; margin: 12px 0; font-size: 13.5px; }
  th, td { border: 1px solid #ddd; padding: 8px 10px; text-align: left; vertical-align: top; }
  th { background: #f3f4f6; }
  ul { padding-left: 20px; }
</style>
</head>
<body>
<h1>Driend 개인정보처리방침</h1>
<div class="sub">시행일자: 2026년 7월 23일</div>

<p>
Driend(이하 "회사" 또는 "서비스")는 이용자의 개인정보를 중요하게 생각하며,
「개인정보 보호법」 등 관련 법령을 준수합니다. 본 방침은 서비스가 어떤 개인정보를
수집·이용·보관·파기하는지 안내합니다.
</p>

<h2>1. 수집하는 개인정보 항목 및 수집 방법</h2>
<table>
<tr><th>구분</th><th>수집 항목</th><th>수집 방법</th></tr>
<tr><td>카카오 로그인</td><td>카카오 고유 ID, 닉네임, 프로필 사진 URL</td><td>카카오 로그인 연동 시 자동 수집</td></tr>
<tr><td>위치정보</td><td>실시간 GPS 좌표, 주행 경로, 방문 지역(시/군/구)</td><td>주행 기록 중 및 백그라운드 자동 감지 시 수집(이용자 위치 권한 허용 시)</td></tr>
<tr><td>사진</td><td>지역 인증용 사진</td><td>이용자가 카메라 또는 사진 라이브러리에서 직접 촬영·선택하여 업로드</td></tr>
<tr><td>이용자 입력 정보</td><td>차량 이름, 블루투스 기기명, 트립(여행) 이름</td><td>이용자가 앱 내에서 직접 입력</td></tr>
<tr><td>서비스 이용 기록</td><td>주행 거리·속도·소요시간·제로백 기록 등 통계</td><td>주행 기록 종료 시 자동 생성</td></tr>
</table>

<h2>2. 개인정보의 수집 및 이용 목적</h2>
<ul>
  <li>카카오 계정을 통한 회원 식별 및 로그인</li>
  <li>주행 경로 기록, 통계(거리·속도·제로백) 산출 및 표시</li>
  <li>방문 지역 인증("도장깨기") 및 지역 사진 표시</li>
  <li>친구 등록 이용자 간 랭킹·기록 비교 제공</li>
  <li>주행 중 자동 감지 알림 등 부가 기능 제공</li>
</ul>

<h2>3. 위치정보의 이용</h2>
<p>
서비스는 주행 경로 기록 및 자동 주행 감지를 위해 포그라운드 및 백그라운드에서
위치정보를 수집합니다. 백그라운드 위치 권한은 이용자가 기기 설정에서 언제든 회수할 수 있으며,
권한을 회수하면 앱이 실행되지 않는 동안에는 위치가 수집되지 않습니다.
수집된 위치정보는 주행 경로·방문 지역 계산 목적으로만 이용되며, 목적 외 용도로 이용하거나
제3자에게 제공하지 않습니다.
</p>

<h2>4. 개인정보의 보유 및 이용 기간</h2>
<p>
이용자의 개인정보는 회원 탈퇴 시까지 보유합니다. 이용자가 앱 내 "회원 탈퇴" 기능을 이용하면
계정 정보, 주행 기록, 위치 데이터, 업로드한 사진, 친구 관계 등 모든 개인정보가 즉시 파기됩니다.
단, 관계 법령에 따라 보존이 필요한 경우 해당 법령이 정한 기간 동안만 별도 보관합니다.
</p>

<h2>5. 개인정보의 제3자 제공</h2>
<p>
회사는 이용자의 개인정보를 원칙적으로 외부에 제공하지 않습니다. 다만 이용자가 서비스 내에서
"친구"로 등록한 다른 이용자에게는 닉네임, 주행 통계, 랭킹 정보가 서비스 화면을 통해 공개될 수 있습니다.
</p>

<h2>6. 개인정보처리의 위탁</h2>
<table>
<tr><th>수탁업체</th><th>위탁 업무</th></tr>
<tr><td>Supabase, Inc.</td><td>데이터베이스, 인증, 파일 저장 등 서버 인프라 운영</td></tr>
<tr><td>주식회사 카카오</td><td>소셜 로그인 인증</td></tr>
</table>

<h2>7. 이용자의 권리와 행사 방법</h2>
<p>
이용자는 언제든 앱 내 "프로필 &gt; 회원 탈퇴" 메뉴를 통해 본인의 개인정보 삭제를 요청할 수 있으며,
요청 즉시 관련 데이터가 삭제됩니다. 그 외 문의사항은 아래 연락처로 접수할 수 있습니다.
</p>

<h2>8. 개인정보의 파기 절차 및 방법</h2>
<p>
회원 탈퇴 시 데이터베이스에 저장된 개인정보와 저장소에 업로드된 사진 파일은 복구할 수 없는 방법으로
즉시 삭제됩니다.
</p>

<h2>9. 개인정보 보호 책임자 및 문의처</h2>
<p>
서비스 운영자: 전태현 (개인 개발자)<br/>
이메일: jeontaehyun0203@gmail.com
</p>

<h2>10. 고지의 의무</h2>
<p>
본 방침은 2026년 7월 23일부터 적용되며, 내용의 추가·삭제·수정이 있을 경우 시행 전 앱 내 공지를 통해
안내합니다.
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
