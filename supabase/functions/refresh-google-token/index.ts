type GoogleRefreshResponse = {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json'
    }
  });

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return jsonResponse({ error: 'method_not_allowed' }, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const googleClientId = Deno.env.get('GOOGLE_OAUTH_CLIENT_ID');
  const googleClientSecret = Deno.env.get('GOOGLE_OAUTH_CLIENT_SECRET');

  if (!supabaseUrl || !supabaseAnonKey || !googleClientId || !googleClientSecret) {
    return jsonResponse({
      error: 'server_config_missing',
      error_description: 'Required Supabase or Google OAuth environment variables are missing.'
    }, 500);
  }

  const authorization = request.headers.get('Authorization');
  if (!authorization) {
    return jsonResponse({ error: 'unauthorized' }, 401);
  }

  // The profiles RLS policy returns a row only for an authenticated, allow-listed user.
  const profileResponse = await fetch(`${supabaseUrl}/rest/v1/profiles?select=email&limit=1`, {
    headers: {
      apikey: supabaseAnonKey,
      Authorization: authorization
    }
  });

  if (!profileResponse.ok) {
    return jsonResponse({ error: 'authorization_check_failed' }, 502);
  }

  const profiles = await profileResponse.json().catch(() => []);
  if (!Array.isArray(profiles) || profiles.length === 0) {
    return jsonResponse({ error: 'forbidden' }, 403);
  }

  let refreshToken: string | undefined;
  try {
    const body = await request.json() as { refresh_token?: unknown };
    refreshToken = typeof body.refresh_token === 'string' ? body.refresh_token : undefined;
  } catch {
    return jsonResponse({
      error: 'invalid_request',
      error_description: 'Request body must be JSON.'
    }, 400);
  }

  if (!refreshToken) {
    return jsonResponse({
      error: 'invalid_request',
      error_description: 'refresh_token is required.'
    }, 400);
  }

  const googleResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      client_id: googleClientId,
      client_secret: googleClientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken
    })
  });

  const googlePayload = await googleResponse.json().catch(() => ({})) as GoogleRefreshResponse;

  if (!googleResponse.ok) {
    return jsonResponse({
      ...googlePayload,
      google_status: googleResponse.status
    }, googleResponse.status);
  }

  return jsonResponse({
    access_token: googlePayload.access_token,
    expires_in: googlePayload.expires_in,
    refresh_token: googlePayload.refresh_token,
    scope: googlePayload.scope,
    token_type: googlePayload.token_type,
    google_status: googleResponse.status
  });
});
