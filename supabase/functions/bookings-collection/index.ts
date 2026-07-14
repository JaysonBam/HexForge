type SupabaseError = {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
};

type BookingsProfile = {
  email: string;
  full_name: string | null;
  status: 'active' | 'pending';
};

type ProjectRow = {
  id: string;
  studentName: string;
  studentNumber: string;
  state: string;
  printLabel: string | null;
  receiptNumber: string | null;
  needsPayment: boolean;
  moduleOrLecturerPays: boolean;
  createdAt: string;
};

type CollectionIndexItem = {
  project_code: string;
  student_name: string;
  student_number: string;
  state: string;
  print_label: string | null;
  last_part_updated_at: string | null;
};

type PartRow = {
  id: string;
  projectId: string;
  partNumber: number;
  printStatus: string;
  collectedBy: string | null;
  collectedByStudentNumber: string | null;
  collectedAt: string | null;
  specialInstruction: string | null;
};

type PrintRunRow = {
  project_id: string;
  started_at: string | null;
  finished_at: string | null;
  failed_at: string | null;
};

type TransitionResult = {
  ok?: boolean;
  errors?: string[];
  warnings?: string[];
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, PATCH, POST, OPTIONS'
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
  if (!value) throw new Error(`${name} is not configured.`);
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

const normalizeProjectCode = (value: unknown) => {
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase();
  return /^[A-Z0-9]{5}$/.test(code) ? code : null;
};

const normalizeStudentNumber = (value: unknown) => {
  if (typeof value !== 'string') return null;
  const studentNumber = value.trim();
  return /^\d{8}$/.test(studentNumber) ? studentNumber : null;
};

const readErrorPayload = async (response: Response) =>
  response.json().catch(() => ({})) as Promise<SupabaseError>;

const verifyBookingsProfile = async (bookingsToken: string) => {
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

  if (!userResponse.ok) return null;

  const user = await userResponse.json().catch(() => ({})) as { email?: string };
  const email = normalizeEmail(user.email);
  if (!email) return null;

  const params = new URLSearchParams({
    select: 'email,full_name,status',
    email: `eq.${email}`,
    limit: '1'
  });

  const profileResponse = await fetch(`${bookingsUrl}/rest/v1/profiles?${params}`, {
    headers: {
      apikey: bookingsAnonKey,
      Authorization: `Bearer ${bookingsToken}`
    }
  });

  if (!profileResponse.ok) return null;

  const profiles = await profileResponse.json().catch(() => []) as BookingsProfile[];
  const profile = profiles[0];
  return profile?.status === 'active' ? profile : null;
};

const hexForgeRest = async (path: string, init: RequestInit = {}) => {
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

const rpc = async <T>(name: string, payload: Record<string, unknown>) => {
  const response = await hexForgeRest(`rpc/${name}`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorPayload = await readErrorPayload(response);
    throw new Error(errorPayload.message || `${name} failed (${response.status}).`);
  }

  return response.json().catch(() => null) as Promise<T>;
};

const projectSelect = [
  'id',
  '"studentName"',
  '"studentNumber"',
  'state',
  '"printLabel"',
  '"receiptNumber"',
  '"needsPayment"',
  '"moduleOrLecturerPays"',
  '"createdAt"'
].join(',');

const partSelect = [
  'id',
  '"projectId"',
  '"partNumber"',
  '"printStatus"',
  '"collectedBy"',
  '"collectedByStudentNumber"',
  '"collectedAt"',
  '"specialInstruction"'
].join(',');

const printRunSelect = [
  'project_id',
  'started_at',
  'finished_at',
  'failed_at'
].join(',');

const maxIso = (current: string | null, next: string | null | undefined) => {
  if (!next) return current;
  if (!current) return next;
  return new Date(next).getTime() > new Date(current).getTime() ? next : current;
};

const fetchProjectRow = async (projectCode: string) => {
  const params = new URLSearchParams({
    select: projectSelect,
    id: `eq.${projectCode}`,
    limit: '1'
  });
  const response = await hexForgeRest(`projects?${params}`);

  if (!response.ok) {
    const payload = await readErrorPayload(response);
    throw new Error(payload.message || 'Could not load private project collection data.');
  }

  const rows = await response.json().catch(() => []) as ProjectRow[];
  return rows[0] || null;
};

const fetchPartRows = async (projectCode: string) => {
  const params = new URLSearchParams({
    select: partSelect,
    projectId: `eq.${projectCode}`,
    order: 'partNumber.asc'
  });
  const response = await hexForgeRest(`parts?${params}`);

  if (!response.ok) {
    const payload = await readErrorPayload(response);
    throw new Error(payload.message || 'Could not load private part collection data.');
  }

  return response.json().catch(() => []) as Promise<PartRow[]>;
};

const getProjectContext = async (projectCode: string) => {
  const [publicProject, privateProject, privateParts] = await Promise.all([
    rpc<Record<string, unknown> | null>('get_public_project_status', { project_code: projectCode }),
    fetchProjectRow(projectCode),
    fetchPartRows(projectCode)
  ]);

  if (!publicProject || !privateProject) return null;

  const partMetaById = new Map(privateParts.map((part) => [part.id, part]));
  const publicParts = Array.isArray(publicProject.parts) ? publicProject.parts : [];
  const parts = publicParts.map((part) => {
    const partRecord = part as Record<string, unknown>;
    const meta = partMetaById.get(String(partRecord.part_id || ''));
    return {
      ...partRecord,
      collection: {
        collected_by: meta?.collectedBy || null,
        collected_by_student_number: meta?.collectedByStudentNumber || null,
        collected_at: meta?.collectedAt || null,
        special_instruction: meta?.specialInstruction || null
      }
    };
  });

  return {
    ...publicProject,
    parts,
    collection: {
      student_name: privateProject.studentName,
      student_number: privateProject.studentNumber,
      print_label: privateProject.printLabel || null,
      receipt_number: privateProject.receiptNumber || null,
      needs_payment: privateProject.needsPayment,
      module_or_lecturer_pays: privateProject.moduleOrLecturerPays,
      created_at: privateProject.createdAt
    }
  };
};

const listIndex = async () => {
  const params = new URLSearchParams({
    select: projectSelect,
    archived: 'eq.false',
    state: 'not.in.(CLOSED,CANCELLED)',
    order: 'createdAt.desc'
  });
  const response = await hexForgeRest(`projects?${params}`);

  if (!response.ok) {
    const payload = await readErrorPayload(response);
    return jsonResponse({
      error: 'hexforge_collection_index_failed',
      error_description: payload.message || 'Could not load collection lookup data.'
    }, response.status);
  }

  const rows = await response.json().catch(() => []) as ProjectRow[];
  const latestByProject = new Map<string, string | null>();

  rows.forEach((row) => latestByProject.set(row.id, row.createdAt || null));

  const projectIds = rows.map((row) => row.id);
  if (projectIds.length > 0) {
    const projectIdFilter = `in.(${projectIds.join(',')})`;

    const [partsResponse, printRunsResponse] = await Promise.all([
      hexForgeRest(`parts?${new URLSearchParams({
        select: '"projectId","collectedAt"',
        projectId: projectIdFilter
      })}`),
      hexForgeRest(`print_runs?${new URLSearchParams({
        select: printRunSelect,
        project_id: projectIdFilter
      })}`)
    ]);

    if (partsResponse.ok) {
      const parts = await partsResponse.json().catch(() => []) as Array<{ projectId: string; collectedAt: string | null }>;
      parts.forEach((part) => {
        latestByProject.set(part.projectId, maxIso(latestByProject.get(part.projectId) || null, part.collectedAt));
      });
    }

    if (printRunsResponse.ok) {
      const printRuns = await printRunsResponse.json().catch(() => []) as PrintRunRow[];
      printRuns.forEach((run) => {
        const latestRunTimestamp = [run.started_at, run.finished_at, run.failed_at]
          .reduce<string | null>((latest, value) => maxIso(latest, value), null);
        latestByProject.set(run.project_id, maxIso(latestByProject.get(run.project_id) || null, latestRunTimestamp));
      });
    }
  }

  const data = rows
    .map<CollectionIndexItem>((row) => ({
      project_code: row.id,
      student_name: row.studentName,
      student_number: row.studentNumber,
      state: row.state,
      print_label: row.printLabel || null,
      last_part_updated_at: latestByProject.get(row.id) || row.createdAt || null
    }))
    .sort((a, b) => (b.last_part_updated_at || '').localeCompare(a.last_part_updated_at || ''));

  return jsonResponse({
    data
  });
};

const getProject = async (request: Request) => {
  const url = new URL(request.url);
  const projectCode = normalizeProjectCode(url.searchParams.get('code'));

  if (!projectCode) {
    return jsonResponse({
      error: 'invalid_project_code',
      error_description: 'A valid five-character project code is required.'
    }, 400);
  }

  const project = await getProjectContext(projectCode);
  if (!project) {
    return jsonResponse({
      error: 'project_not_found',
      error_description: 'No project was found for that code.'
    }, 404);
  }

  return jsonResponse({ data: project });
};

const saveReceipt = async (request: Request) => {
  const body = await request.json().catch(() => ({})) as {
    projectCode?: unknown;
    receiptNumber?: unknown;
  };
  const projectCode = normalizeProjectCode(body.projectCode);
  const receiptNumber = typeof body.receiptNumber === 'string' ? body.receiptNumber.trim() : '';

  if (!projectCode) {
    return jsonResponse({
      error: 'invalid_project_code',
      error_description: 'A valid five-character project code is required.'
    }, 400);
  }

  if (!receiptNumber) {
    return jsonResponse({
      error: 'missing_receipt_number',
      error_description: 'Enter a receipt number before saving.'
    }, 400);
  }

  const response = await hexForgeRest(`projects?id=eq.${encodeURIComponent(projectCode)}`, {
    method: 'PATCH',
    headers: {
      Prefer: 'return=minimal'
    },
    body: JSON.stringify({ receiptNumber })
  });

  if (!response.ok) {
    const payload = await readErrorPayload(response);
    return jsonResponse({
      error: 'receipt_save_failed',
      error_description: payload.message || 'Could not save the receipt number.'
    }, response.status);
  }

  const project = await getProjectContext(projectCode);
  return jsonResponse({ data: project });
};

const collectParts = async (request: Request) => {
  const body = await request.json().catch(() => ({})) as {
    projectCode?: unknown;
    partIds?: unknown;
    collectorName?: unknown;
    collectedByStudentNumber?: unknown;
  };
  const projectCode = normalizeProjectCode(body.projectCode);
  const collectorName = typeof body.collectorName === 'string' ? body.collectorName.trim() : '';
  const collectedByStudentNumber = normalizeStudentNumber(body.collectedByStudentNumber);
  const partIds = Array.isArray(body.partIds)
    ? body.partIds.filter((partId): partId is string => typeof partId === 'string' && partId.trim().length > 0)
    : [];

  if (!projectCode) {
    return jsonResponse({
      error: 'invalid_project_code',
      error_description: 'A valid five-character project code is required.'
    }, 400);
  }

  if (!collectorName) {
    return jsonResponse({
      error: 'missing_collector_name',
      error_description: 'The assisting staff member name is required.'
    }, 400);
  }

  if (!collectedByStudentNumber) {
    return jsonResponse({
      error: 'invalid_collected_by_student_number',
      error_description: 'Enter the eight-digit student number of the person collecting.'
    }, 400);
  }

  if (partIds.length === 0) {
    return jsonResponse({
      error: 'missing_parts',
      error_description: 'Select at least one part to collect.'
    }, 400);
  }

  const result = await rpc<TransitionResult>('collect_project_parts', {
    p_project_id: projectCode,
    p_part_ids: partIds,
    p_technician_name: collectorName,
    p_collected_by_student_number: collectedByStudentNumber
  });

  if (!result?.ok) {
    return jsonResponse({
      error: 'collection_failed',
      error_description: Array.isArray(result?.errors) && result.errors.length
        ? result.errors.join(' ')
        : 'HexForge rejected the collection action.',
      data: {
        project: await getProjectContext(projectCode)
      }
    }, 409);
  }

  return jsonResponse({
    data: {
      project: await getProjectContext(projectCode)
    }
  });
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

    const profile = await verifyBookingsProfile(bookingsToken);

    if (!profile) {
      return jsonResponse({
        error: 'forbidden',
        error_description: 'Bookings user does not have active access.'
      }, 403);
    }

    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname.endsWith('/index')) {
      return await listIndex();
    }

    if (request.method === 'GET') {
      return await getProject(request);
    }

    if (request.method === 'PATCH' && url.pathname.endsWith('/receipt')) {
      return await saveReceipt(request);
    }

    if (request.method === 'POST' && url.pathname.endsWith('/collect')) {
      return await collectParts(request);
    }

    return jsonResponse({ error: 'method_not_allowed' }, 405);
  } catch (error) {
    console.error('bookings-collection error', error);
    return jsonResponse({
      error: 'server_error',
      error_description: error instanceof Error ? error.message : 'Unexpected server error.'
    }, 500);
  }
});
