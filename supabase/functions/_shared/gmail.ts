import {
  decryptSecret,
  encryptSecret,
  invokeServiceRpc,
  serviceRoleRequest,
  type AuthenticatedUser
} from './security.ts';

type GmailCredentialRow = {
  user_id: string;
  account_email: string;
  refresh_token_ciphertext: string;
  refresh_token_iv: string;
  refresh_token_key_version: number;
  access_token_ciphertext: string | null;
  access_token_iv: string | null;
  access_token_key_version: number | null;
  access_token_expires_at: string | null;
  granted_scopes: string[];
  revoked_at: string | null;
};

type GoogleTokenResponse = {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
};

const requiredEnv = (name: string) => {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
};

const credentialQuery = (userId: string) => {
  const params = new URLSearchParams({
    select: '*',
    user_id: `eq.${userId}`,
    revoked_at: 'is.null',
    limit: '1'
  });
  return `gmail_oauth_credentials?${params}`;
};

export const getCredential = async (userId: string) => {
  const response = await serviceRoleRequest(credentialQuery(userId));
  if (!response.ok) throw new Error('Could not load the Gmail connection.');
  const rows = await response.json() as GmailCredentialRow[];
  return rows[0] || null;
};

const refreshAccessToken = async (credential: GmailCredentialRow) => {
  const refreshToken = await decryptSecret({
    ciphertext: credential.refresh_token_ciphertext,
    iv: credential.refresh_token_iv,
    keyVersion: credential.refresh_token_key_version
  }, `${credential.user_id}:google-refresh-token`);

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: requiredEnv('GOOGLE_OAUTH_CLIENT_ID'),
      client_secret: requiredEnv('GOOGLE_OAUTH_CLIENT_SECRET'),
      grant_type: 'refresh_token',
      refresh_token: refreshToken
    })
  });
  const payload = await response.json().catch(() => ({})) as GoogleTokenResponse;
  if (!response.ok || !payload.access_token) {
    if (payload.error === 'invalid_grant') {
      await serviceRoleRequest(`gmail_oauth_credentials?user_id=eq.${credential.user_id}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          revoked_at: new Date().toISOString(),
          access_token_ciphertext: null,
          access_token_iv: null,
          access_token_key_version: null
        })
      });
    }
    throw new Error(payload.error === 'invalid_grant' ? 'gmail_reconnect_required' : 'gmail_token_refresh_failed');
  }

  const access = await encryptSecret(payload.access_token, `${credential.user_id}:google-access-token`);
  const expiresAt = new Date(Date.now() + Math.max(0, (payload.expires_in || 3600) - 60) * 1000).toISOString();
  const updates: Record<string, unknown> = {
    access_token_ciphertext: access.ciphertext,
    access_token_iv: access.iv,
    access_token_expires_at: expiresAt,
    access_token_key_version: access.keyVersion,
    granted_scopes: payload.scope?.split(/\s+/).filter(Boolean) || credential.granted_scopes,
    updated_at: new Date().toISOString()
  };

  if (payload.refresh_token) {
    const rotated = await encryptSecret(payload.refresh_token, `${credential.user_id}:google-refresh-token`);
    updates.refresh_token_ciphertext = rotated.ciphertext;
    updates.refresh_token_iv = rotated.iv;
    updates.refresh_token_key_version = rotated.keyVersion;
  }

  const updateResponse = await serviceRoleRequest(`gmail_oauth_credentials?user_id=eq.${credential.user_id}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify(updates)
  });
  if (!updateResponse.ok) throw new Error('Could not persist the renewed Gmail credential.');
  return payload.access_token;
};

export const getAccessToken = async (userId: string, forceRefresh = false) => {
  const credential = await getCredential(userId);
  if (!credential) throw new Error('gmail_connection_required');

  const expiry = credential.access_token_expires_at
    ? new Date(credential.access_token_expires_at).getTime()
    : 0;
  if (
    !forceRefresh
    && credential.access_token_ciphertext
    && credential.access_token_iv
    && expiry > Date.now() + 30_000
  ) {
    return decryptSecret({
      ciphertext: credential.access_token_ciphertext,
      iv: credential.access_token_iv,
      keyVersion: credential.access_token_key_version || undefined
    }, `${credential.user_id}:google-access-token`);
  }

  return refreshAccessToken(credential);
};

export const recordSecurityEvent = async (
  userId: string | null,
  eventType: string,
  details: Record<string, unknown> = {}
) => {
  await serviceRoleRequest('gmail_security_events', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      user_id: userId,
      event_type: eventType,
      details
    })
  }).catch(() => undefined);
};

export const consumeOperationLimit = async (
  user: AuthenticatedUser,
  operation: string,
  limit: number
) => {
  const response = await invokeServiceRpc('consume_gmail_operation', {
    p_user_id: user.id,
    p_operation: operation,
    p_limit: limit
  });
  if (!response.ok) throw new Error('gmail_rate_limit_check_failed');
  return await response.json() as boolean;
};

export const googleTokenResponse = async (
  body: URLSearchParams
): Promise<{ response: Response; payload: GoogleTokenResponse }> => {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  const payload = await response.json().catch(() => ({})) as GoogleTokenResponse;
  return { response, payload };
};

export const storeCredential = async (args: {
  userId: string;
  accountEmail: string;
  refreshToken: string;
  accessToken: string;
  expiresIn?: number;
  scopes?: string;
}) => {
  const [refresh, access] = await Promise.all([
    encryptSecret(args.refreshToken, `${args.userId}:google-refresh-token`),
    encryptSecret(args.accessToken, `${args.userId}:google-access-token`)
  ]);
  const expiresAt = new Date(Date.now() + Math.max(0, (args.expiresIn || 3600) - 60) * 1000).toISOString();
  const response = await serviceRoleRequest('gmail_oauth_credentials?on_conflict=user_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      user_id: args.userId,
      account_email: args.accountEmail.trim().toLowerCase(),
      refresh_token_ciphertext: refresh.ciphertext,
      refresh_token_iv: refresh.iv,
      refresh_token_key_version: refresh.keyVersion,
      access_token_ciphertext: access.ciphertext,
      access_token_iv: access.iv,
      access_token_key_version: access.keyVersion,
      access_token_expires_at: expiresAt,
      granted_scopes: args.scopes?.split(/\s+/).filter(Boolean) || [],
      revoked_at: null,
      updated_at: new Date().toISOString()
    })
  });
  if (!response.ok) throw new Error('Could not persist the Gmail connection.');
};
