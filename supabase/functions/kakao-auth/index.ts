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
    const { access_token } = await req.json();
    if (!access_token) throw new Error('access_token이 없습니다');

    // 1. 카카오 유저 정보 조회
    const kakaoRes = await fetch('https://kapi.kakao.com/v2/user/me', {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    if (!kakaoRes.ok) throw new Error(`카카오 유저 정보 조회 실패: ${kakaoRes.status}`);

    const kakaoUser = await kakaoRes.json();
    const kakaoId = String(kakaoUser.id);
    const nickname = kakaoUser.kakao_account?.profile?.nickname ?? '드라이버';
    const avatarUrl = kakaoUser.kakao_account?.profile?.profile_image_url ?? null;

    // 2. Supabase Admin 클라이언트
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const email = `kakao_${kakaoId}@driend.app`;
    const password = `kakao_${kakaoId}_${Deno.env.get('KAKAO_SECRET_SALT')}`;

    // 3. 로그인 먼저 시도
    let signIn = await supabase.auth.signInWithPassword({ email, password });

    // 4. 유저가 없으면 생성
    if (signIn.error) {
      const { data: newUser, error: createErr } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { kakao_id: kakaoId, nickname, avatar_url: avatarUrl },
      });
      if (createErr) throw new Error(`유저 생성 실패: ${createErr.message}`);

      // 프로필 생성 (이미 있으면 무시)
      await supabase.from('profiles').upsert({
        id: newUser.user!.id,
        username: nickname,
        avatar_url: avatarUrl,
      }, { onConflict: 'id', ignoreDuplicates: true });

      // 재로그인
      signIn = await supabase.auth.signInWithPassword({ email, password });
    }

    if (signIn.error) throw new Error(`로그인 실패: ${signIn.error.message}`);

    return new Response(JSON.stringify(signIn.data), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
