export type AuthenticatedUser = {
  id: string;
  email: string;
};

export type EncryptedValue = {
  ciphertext: string;
  iv: string;
  keyVersion: number;
};

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const toBase64 = (bytes: Uint8Array) => {
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
};

const fromBase64 = (value: string) => {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

const getRequiredEnv = (name: string) => {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`${name} is not configured.`);
  return value.replace(/\/$/, '');
};

const getEncryptionKey = async (keyVersion?: number) => {
  const currentVersion = Number(Deno.env.get('GMAIL_TOKEN_ENCRYPTION_KEY_VERSION') || '1');
  const resolvedVersion = keyVersion || currentVersion;
  const keyName = resolvedVersion === currentVersion
    ? 'GMAIL_TOKEN_ENCRYPTION_KEY'
    : `GMAIL_TOKEN_ENCRYPTION_KEY_V${resolvedVersion}`;
  const raw = fromBase64(getRequiredEnv(keyName));
  if (raw.byteLength !== 32) {
    throw new Error('GMAIL_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key.');
  }
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
};

export const encryptSecret = async (
  plaintext: string,
  associatedData: string
): Promise<EncryptedValue> => {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await getEncryptionKey();
  const ciphertext = await crypto.subtle.encrypt({
    name: 'AES-GCM',
    iv,
    additionalData: textEncoder.encode(associatedData)
  }, key, textEncoder.encode(plaintext));

  return {
    ciphertext: toBase64(new Uint8Array(ciphertext)),
    iv: toBase64(iv),
    keyVersion: Number(Deno.env.get('GMAIL_TOKEN_ENCRYPTION_KEY_VERSION') || '1')
  };
};

export const decryptSecret = async (
  encrypted: Pick<EncryptedValue, 'ciphertext' | 'iv'> & { keyVersion?: number },
  associatedData: string
) => {
  const key = await getEncryptionKey(encrypted.keyVersion);
  const plaintext = await crypto.subtle.decrypt({
    name: 'AES-GCM',
    iv: fromBase64(encrypted.iv),
    additionalData: textEncoder.encode(associatedData)
  }, key, fromBase64(encrypted.ciphertext));
  return textDecoder.decode(plaintext);
};

export const randomBase64Url = (bytes = 32) =>
  toBase64(crypto.getRandomValues(new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');

export const sha256Base64Url = async (value: string) => {
  const digest = await crypto.subtle.digest('SHA-256', textEncoder.encode(value));
  return toBase64(new Uint8Array(digest))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
};

export const getBearerToken = (request: Request) => {
  const match = (request.headers.get('authorization') || '').match(/^Bearer\s+(.+)$/i);
  return match?.[1] || null;
};

export const verifyActiveUser = async (request: Request): Promise<AuthenticatedUser | null> => {
  const token = getBearerToken(request);
  if (!token) return null;

  const supabaseUrl = getRequiredEnv('SUPABASE_URL');
  const anonKey = getRequiredEnv('SUPABASE_ANON_KEY');
  const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token}`
    }
  });
  if (!userResponse.ok) return null;

  const user = await userResponse.json().catch(() => ({})) as { id?: string; email?: string };
  if (!user.id || !user.email) return null;

  const profileParams = new URLSearchParams({
    select: 'id,email,status',
    id: `eq.${user.id}`,
    status: 'eq.active',
    limit: '1'
  });
  const profileResponse = await fetch(`${supabaseUrl}/rest/v1/profiles?${profileParams}`, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token}`
    }
  });
  if (!profileResponse.ok) return null;
  const profiles = await profileResponse.json().catch(() => []) as Array<{ email?: string }>;
  if (!profiles.some((profile) => profile.email?.trim().toLowerCase() === user.email?.trim().toLowerCase())) {
    return null;
  }

  return { id: user.id, email: user.email.trim().toLowerCase() };
};

export const serviceRoleRequest = (path: string, init: RequestInit = {}) => {
  const supabaseUrl = getRequiredEnv('SUPABASE_URL');
  const serviceRoleKey = getRequiredEnv('SUPABASE_SERVICE_ROLE_KEY');
  return fetch(`${supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
      ...(init.headers || {})
    }
  });
};

export const invokeServiceRpc = (name: string, body: Record<string, unknown>) =>
  serviceRoleRequest(`rpc/${name}`, {
    method: 'POST',
    body: JSON.stringify(body)
  });

const configuredOrigins = () =>
  (Deno.env.get('HEXFORGE_WEB_ORIGINS') || Deno.env.get('HEXFORGE_WEB_ORIGIN') || '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter(Boolean);

export const isAllowedOrigin = (origin: string | null) =>
  Boolean(origin && configuredOrigins().includes(origin.replace(/\/$/, '')));

export const corsHeaders = (request: Request) => {
  const origin = request.headers.get('origin');
  return {
    ...(isAllowedOrigin(origin) ? { 'Access-Control-Allow-Origin': origin! } : {}),
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin'
  };
};

export const jsonResponse = (
  request: Request,
  body: Record<string, unknown>,
  status = 200
) => new Response(JSON.stringify(body), {
  status,
  headers: {
    ...corsHeaders(request),
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json',
    'X-Content-Type-Options': 'nosniff'
  }
});

export const handleOptions = (request: Request) => {
  if (request.method !== 'OPTIONS') return null;
  const origin = request.headers.get('origin');
  if (!isAllowedOrigin(origin)) return jsonResponse(request, { error: 'origin_not_allowed' }, 403);
  return new Response(null, { status: 204, headers: corsHeaders(request) });
};

export const safeReturnPath = (value: unknown) =>
  typeof value === 'string'
    && value.startsWith('/')
    && !value.startsWith('//')
    && !value.startsWith('/auth-callback')
    ? value.slice(0, 1000)
    : '/';

export const getWebOrigin = () => {
  const origins = configuredOrigins();
  if (origins.length === 0) throw new Error('HEXFORGE_WEB_ORIGINS is not configured.');
  return origins[0];
};
