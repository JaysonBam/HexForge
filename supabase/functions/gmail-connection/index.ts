import {
  corsHeaders,
  decryptSecret,
  encryptSecret,
  handleOptions,
  jsonResponse,
  randomBase64Url,
  safeReturnPath,
  serviceRoleRequest,
  sha256Base64Url,
  verifyActiveUser
} from '../_shared/security.ts';
import { getCredential, recordSecurityEvent } from '../_shared/gmail.ts';

const gmailScopes = [
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/gmail.readonly'
];

const requiredEnv = (name: string) => {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
};

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;

  const user = await verifyActiveUser(request);
  if (!user) return jsonResponse(request, { error: 'unauthorized' }, 401);

  try {
    if (request.method === 'GET') {
      const credential = await getCredential(user.id);
      return jsonResponse(request, {
        connected: Boolean(credential),
        account_email: credential?.account_email || null,
        scopes: credential?.granted_scopes || []
      });
    }

    if (request.method === 'POST') {
      const body = await request.json().catch(() => ({})) as { return_path?: unknown };
      const state = randomBase64Url(32);
      const verifier = randomBase64Url(64);
      const [stateHash, challenge, encryptedVerifier] = await Promise.all([
        sha256Base64Url(state),
        sha256Base64Url(verifier),
        encryptSecret(verifier, `${user.id}:oauth-state`)
      ]);
      const stateResponse = await serviceRoleRequest('gmail_oauth_states', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          state_hash: stateHash,
          user_id: user.id,
          user_email: user.email,
          verifier_ciphertext: encryptedVerifier.ciphertext,
          verifier_iv: encryptedVerifier.iv,
          verifier_key_version: encryptedVerifier.keyVersion,
          return_path: safeReturnPath(body.return_path),
          expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString()
        })
      });
      if (!stateResponse.ok) throw new Error('Could not create the Gmail authorization state.');

      const authorizationUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      authorizationUrl.searchParams.set('client_id', requiredEnv('GOOGLE_OAUTH_CLIENT_ID'));
      authorizationUrl.searchParams.set('redirect_uri', requiredEnv('GMAIL_OAUTH_REDIRECT_URI'));
      authorizationUrl.searchParams.set('response_type', 'code');
      authorizationUrl.searchParams.set('scope', gmailScopes.join(' '));
      authorizationUrl.searchParams.set('access_type', 'offline');
      authorizationUrl.searchParams.set('prompt', 'consent select_account');
      authorizationUrl.searchParams.set('include_granted_scopes', 'true');
      authorizationUrl.searchParams.set('code_challenge', challenge);
      authorizationUrl.searchParams.set('code_challenge_method', 'S256');
      authorizationUrl.searchParams.set('state', state);

      await recordSecurityEvent(user.id, 'gmail_connection_started');
      return jsonResponse(request, { authorization_url: authorizationUrl.toString() });
    }

    if (request.method === 'DELETE') {
      const credential = await getCredential(user.id);
      if (credential) {
        const refreshToken = await decryptSecret({
          ciphertext: credential.refresh_token_ciphertext,
          iv: credential.refresh_token_iv,
          keyVersion: credential.refresh_token_key_version
        }, `${user.id}:google-refresh-token`);
        await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refreshToken)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        }).catch(() => undefined);
      }

      await serviceRoleRequest(`gmail_oauth_credentials?user_id=eq.${user.id}`, {
        method: 'DELETE',
        headers: { Prefer: 'return=minimal' }
      });
      await recordSecurityEvent(user.id, 'gmail_connection_disconnected');
      return new Response(null, {
        status: 204,
        headers: {
          ...corsHeaders(request),
          'Cache-Control': 'no-store'
        }
      });
    }

    return jsonResponse(request, { error: 'method_not_allowed' }, 405);
  } catch (error) {
    console.error('gmail-connection failed', error instanceof Error ? error.message : 'unknown_error');
    await recordSecurityEvent(user.id, 'gmail_connection_failed');
    return jsonResponse(request, {
      error: 'gmail_connection_failed',
      error_description: 'The Gmail connection could not be updated.'
    }, 500);
  }
});
