import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { code, redirect_uri } = await req.json();

    // 1. code → access token 교환
    const tokenRes = await fetch('https://kauth.kakao.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: Deno.env.get('KAKAO_REST_API_KEY')!,
        redirect_uri,
        code,
      }),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      throw new Error(`카카오 토큰 교환 실패: ${err}`);
    }

    const { access_token } = await tokenRes.json();

    // 2. 카카오 유저 정보 조회
    const kakaoRes = await fetch('https://kapi.kakao.com/v2/user/me', {
      headers: { Authorization: `Bearer ${access_token}` },
    });

    if (!kakaoRes.ok) throw new Error('카카오 유저 정보 조회 실패');

    const kakaoUser = await kakaoRes.json();
    const kakaoId = String(kakaoUser.id);
    const nickname = kakaoUser.kakao_account?.profile?.nickname ?? '드라이버';
    const avatarUrl = kakaoUser.kakao_account?.profile?.profile_image_url ?? null;

    // 3. Supabase Admin 클라이언트
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const email = `kakao_${kakaoId}@driend.app`;
    const password = `kakao_${kakaoId}_${Deno.env.get('KAKAO_SECRET_SALT')}`;

    // 4. 유저 생성 또는 로그인
    const { data: existingUsers } = await supabase.auth.admin.listUsers();
    const found = existingUsers?.users?.find((u) => u.email === email);

    if (!found) {
      const { data: newUser, error } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { kakao_id: kakaoId, nickname, avatar_url: avatarUrl },
      });
      if (error) throw error;

      await supabase.from('profiles').insert({
        id: newUser.user!.id,
        username: nickname,
        avatar_url: avatarUrl,
      });
    }

    // 5. 세션 발급
    const { data: signIn, error: signInErr } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (signInErr) throw signInErr;

    return new Response(JSON.stringify(signIn), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
