Deno.serve((req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  if (error || !code) {
    return new Response(`카카오 로그인 실패: ${error ?? 'code 없음'}`, { status: 400 });
  }

  // 앱의 딥링크로 리다이렉트 (ASWebAuthenticationSession이 가로챔)
  return Response.redirect(`driend://oauth?code=${code}`, 302);
});
