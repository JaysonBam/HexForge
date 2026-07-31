import {
  decryptSecret,
  getWebOrigin,
  serviceRoleRequest,
  sha256Base64Url
} from '../_shared/security.ts';
import {
  googleTokenResponse,
  recordSecurityEvent,
  storeCredential
} from '../_shared/gmail.ts';

type OAuthStateRow = {
  state_hash: string;
  user_id: string;
  user_email: string;
  verifier_ciphertext: string;
  verifier_iv: string;
  verifier_key_version: number;
  return_path: string;
  expires_at: string;
};

const requiredEnv = (name: string) => {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
};

const redirect = (path: string, result: string) => {
  const url = new URL(path, getWebOrigin());
  url.searchParams.set('gmail', result);
  return Response.redirect(url.toString(), 303);
};

Deno.serve(async (request) => {
  if (request.method !== 'GET') return new Response('Method not allowed.', { status: 405 });

  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state || url.searchParams.has('error')) {
    return redirect('/', 'connection_failed');
  }

  let stateRow: OAuthStateRow | null = null;
  try {
    const stateHash = await sha256Base64Url(state);
    const stateResponse = await serviceRoleRequest(`gmail_oauth_states?state_hash=eq.${stateHash}`, {
      method: 'DELETE',
      headers: { Prefer: 'return=representation' }
    });
    if (!stateResponse.ok) throw new Error('Could not read OAuth state.');
    stateRow = (await stateResponse.json() as OAuthStateRow[])[0] || null;

    if (!stateRow || new Date(stateRow.expires_at).getTime() <= Date.now()) {
      return redirect('/', 'connection_expired');
    }

    const profileParams = new URLSearchParams({
      select: 'id,email',
      id: `eq.${stateRow.user_id}`,
      status: 'eq.active',
      limit: '1'
    });
    const profileResponse = await serviceRoleRequest(`profiles?${profileParams}`);
    const activeProfiles = profileResponse.ok
      ? await profileResponse.json().catch(() => []) as Array<{ id?: string; email?: string }>
      : [];
    if (!activeProfiles.some((profile) =>
      profile.email?.trim().toLowerCase() === stateRow?.user_email.trim().toLowerCase()
    )) {
      throw new Error('HexForge access was removed during authorization.');
    }

    const verifier = await decryptSecret({
      ciphertext: stateRow.verifier_ciphertext,
      iv: stateRow.verifier_iv,
      keyVersion: stateRow.verifier_key_version
    }, `${stateRow.user_id}:oauth-state`);
    const { response, payload } = await googleTokenResponse(new URLSearchParams({
      client_id: requiredEnv('GOOGLE_OAUTH_CLIENT_ID'),
      client_secret: requiredEnv('GOOGLE_OAUTH_CLIENT_SECRET'),
      code,
      code_verifier: verifier,
      grant_type: 'authorization_code',
      redirect_uri: requiredEnv('GMAIL_OAUTH_REDIRECT_URI')
    }));
    if (!response.ok || !payload.access_token || !payload.refresh_token) {
      throw new Error(payload.refresh_token ? 'OAuth exchange failed.' : 'Google did not return a refresh token.');
    }

    const gmailProfileResponse = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
      headers: { Authorization: `Bearer ${payload.access_token}` }
    });
    const profile = await gmailProfileResponse.json().catch(() => ({})) as { emailAddress?: string };
    const accountEmail = profile.emailAddress?.trim().toLowerCase();
    if (!gmailProfileResponse.ok || !accountEmail || accountEmail !== stateRow.user_email.trim().toLowerCase()) {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(payload.refresh_token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      }).catch(() => undefined);
      throw new Error('The connected Gmail account does not match the signed-in HexForge account.');
    }

    await storeCredential({
      userId: stateRow.user_id,
      accountEmail,
      refreshToken: payload.refresh_token,
      accessToken: payload.access_token,
      expiresIn: payload.expires_in,
      scopes: payload.scope
    });
    await recordSecurityEvent(stateRow.user_id, 'gmail_connection_completed', {
      account_domain: accountEmail.split('@')[1] || ''
    });
    return redirect(stateRow.return_path, 'connected');
  } catch (error) {
    console.error('gmail-oauth-callback failed', error instanceof Error ? error.message : 'unknown_error');
    await recordSecurityEvent(stateRow?.user_id || null, 'gmail_connection_failed');
    return redirect(stateRow?.return_path || '/', 'connection_failed');
  }
});
