type HexForgeProfile = {
  email: string;
  full_name: string | null;
  profile_url: string | null;
  status: 'active' | 'pending';
};

type SupabaseError = {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS'
};

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json'
    }
  });

const getRequiredEnv = (name: string) => {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`${name} is not configured.`);
  }
  return value.replace(/\/$/, '');
};

const getBearerToken = (request: Request) => {
  const header = request.headers.get('authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || null;
};

const normalizeEmail = (email: unknown) =>
  typeof email === 'string' && email.trim().includes('@')
    ? email.trim().toLowerCase()
    : null;

const readErrorPayload = async (response: Response) =>
  response.json().catch(() => ({})) as Promise<SupabaseError>;

const verifyBookingsAuthorisation = async (bookingsToken: string) => {
  const bookingsUrl = getRequiredEnv('BOOKINGS_SUPABASE_URL');
  const bookingsAnonKey = Deno.env.get('BOOKINGS_SUPABASE_ANON_KEY');

  if (!bookingsAnonKey) {
    throw new Error('BOOKINGS_SUPABASE_ANON_KEY is not configured.');
  }

  const userResponse = await fetch(`${bookingsUrl}/auth/v1/user`, {
    headers: {
      apikey: bookingsAnonKey,
      Authorization: `Bearer ${bookingsToken}`
    }
  });

  if (!userResponse.ok) {
    return false;
  }

  const user = await userResponse.json().catch(() => ({})) as { email?: string };
  const email = normalizeEmail(user.email);

  if (!email) {
    return false;
  }

  const params = new URLSearchParams({
    select: 'authorisation',
    email: `eq.${email}`
  });

  const profileResponse = await fetch(`${bookingsUrl}/rest/v1/profiles?${params}`, {
    headers: {
      apikey: bookingsAnonKey,
      Authorization: `Bearer ${bookingsToken}`
    }
  });

  if (!profileResponse.ok) {
    return false;
  }

  const profiles = await profileResponse.json().catch(() => []) as Array<{ authorisation?: boolean }>;
  return profiles.some((profile) => profile.authorisation === true);
};

const hexForgeRequest = async (path: string, init: RequestInit = {}) => {
  const hexForgeUrl = getRequiredEnv('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!serviceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured.');
  }

  return fetch(`${hexForgeUrl}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
      ...(init.headers || {})
    }
  });
};

const listProfiles = async () => {
  const params = new URLSearchParams({
    select: 'email,full_name,profile_url,status',
    order: 'email.asc'
  });
  const response = await hexForgeRequest(`profiles?${params}`);

  if (!response.ok) {
    const payload = await readErrorPayload(response);
    return jsonResponse({
      error: 'hexforge_profiles_read_failed',
      error_description: payload.message || 'Could not load HexForge profiles.'
    }, response.status);
  }

  const profiles = await response.json() as HexForgeProfile[];
  return jsonResponse({ data: profiles });
};

const addProfile = async (request: Request) => {
  const body = await request.json().catch(() => ({})) as { email?: unknown };
  const email = normalizeEmail(body.email);

  if (!email) {
    return jsonResponse({
      error: 'invalid_email',
      error_description: 'A valid email address is required.'
    }, 400);
  }

  const response = await hexForgeRequest('profiles', {
    method: 'POST',
    headers: {
      Prefer: 'return=representation'
    },
    body: JSON.stringify({ email, status: 'pending' })
  });

  if (!response.ok) {
    const payload = await readErrorPayload(response);
    const isDuplicate = payload.code === '23505';
    return jsonResponse({
      error: isDuplicate ? 'user_already_exists' : 'hexforge_profile_insert_failed',
      error_description: isDuplicate ? 'User already exists' : payload.message || 'Could not add HexForge profile.'
    }, isDuplicate ? 409 : response.status);
  }

  const profiles = await response.json() as HexForgeProfile[];
  return jsonResponse({ data: profiles[0] });
};

const deleteProfile = async (request: Request) => {
  const url = new URL(request.url);
  const email = normalizeEmail(url.searchParams.get('email'));

  if (!email) {
    return jsonResponse({
      error: 'invalid_email',
      error_description: 'A valid email address is required.'
    }, 400);
  }

  const params = new URLSearchParams({
    email: `eq.${email}`
  });

  const response = await hexForgeRequest(`profiles?${params}`, {
    method: 'DELETE'
  });

  if (!response.ok) {
    const payload = await readErrorPayload(response);
    return jsonResponse({
      error: 'hexforge_profile_delete_failed',
      error_description: payload.message || 'Could not remove HexForge profile.'
    }, response.status);
  }

  return jsonResponse({ data: null });
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const bookingsToken = getBearerToken(request);

    if (!bookingsToken) {
      return jsonResponse({
        error: 'missing_authorization',
        error_description: 'A bookings authorization token is required.'
      }, 401);
    }

    const isAuthorised = await verifyBookingsAuthorisation(bookingsToken);

    if (!isAuthorised) {
      return jsonResponse({
        error: 'forbidden',
        error_description: 'Bookings user does not have access-management permission.'
      }, 403);
    }

    if (request.method === 'GET') {
      return await listProfiles();
    }

    if (request.method === 'POST') {
      return await addProfile(request);
    }

    if (request.method === 'DELETE') {
      return await deleteProfile(request);
    }

    return jsonResponse({ error: 'method_not_allowed' }, 405);
  } catch (error) {
    console.error('bookings-profile-access error', error);
    return jsonResponse({
      error: 'server_error',
      error_description: error instanceof Error ? error.message : 'Unexpected server error.'
    }, 500);
  }
});
