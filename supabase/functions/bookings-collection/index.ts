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
  priorityNumber: number;
  studentName: string;
  studentNumber: string;
  email: string | null;
  course: string | null;
  lecturer: string | null;
  state: string;
  printLabel: string | null;
  receiptNumber: string | null;
  needsPayment: boolean;
  moduleOrLecturerPays: boolean;
  paymentOverrideNote: string | null;
  createdAt: string;
};

type PartRow = {
  id: string;
  projectId: string;
  partNumber: number;
  partName: string;
  printStatus: string;
  imageUrl: string | null;
  primaryEstimatedWeight: number | null;
  secondaryEstimatedWeight: number | null;
  collectedBy: string | null;
  collectedByStudentNumber: string | null;
  collectedAt: string | null;
  specialInstruction: string | null;
};

type CollectionBoardItem = {
  project_code: string;
  student_name: string;
  student_number: string;
  state: string;
  group: 'help_desk' | 'partially_ready' | null;
  print_label: string | null;
  total_parts: number;
  completed_parts: number;
  collected_parts: number;
  remaining_parts: number;
  all_parts_completed: boolean;
  thumbnail_url: string | null;
  thumbnail_part_name: string | null;
  thumbnail_weight: number;
  payment_outstanding: boolean;
  last_activity_at: string | null;
};

type TransitionResult = {
  ok?: boolean;
  errors?: string[];
  warnings?: string[];
};

type StoredEmailTemplate = {
  subject?: unknown;
  htmlBody?: unknown;
  includeSignature?: unknown;
};

const completedStatuses = new Set(['PRINTED', 'POST_PROCESSING', 'COLLECTED']);

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

  if (!bookingsAnonKey) throw new Error('BOOKINGS_SUPABASE_ANON_KEY is not configured.');

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
  if (!serviceRoleKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured.');

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
  '"priorityNumber"',
  '"studentName"',
  '"studentNumber"',
  'email',
  'course',
  'lecturer',
  'state',
  '"printLabel"',
  '"receiptNumber"',
  '"needsPayment"',
  '"moduleOrLecturerPays"',
  '"paymentOverrideNote"',
  '"createdAt"'
].join(',');

const partSelect = [
  'id',
  '"projectId"',
  '"partNumber"',
  '"partName"',
  '"printStatus"',
  '"imageUrl"',
  '"primaryEstimatedWeight"',
  '"secondaryEstimatedWeight"',
  '"collectedBy"',
  '"collectedByStudentNumber"',
  '"collectedAt"',
  '"specialInstruction"'
].join(',');

const fetchProjectRow = async (projectCode: string) => {
  const params = new URLSearchParams({ select: projectSelect, id: `eq.${projectCode}`, limit: '1' });
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

const fetchPartRowsForProjects = async (projectIds: string[]) => {
  if (projectIds.length === 0) return [] as PartRow[];
  const params = new URLSearchParams({
    select: partSelect,
    projectId: `in.(${projectIds.join(',')})`,
    order: 'partNumber.asc'
  });
  const response = await hexForgeRest(`parts?${params}`);
  if (!response.ok) {
    const payload = await readErrorPayload(response);
    throw new Error(payload.message || 'Could not load collection board parts.');
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

const getBoardGroup = (project: ProjectRow, completedParts: number): CollectionBoardItem['group'] => {
  if (project.state === 'READY_FOR_COLLECTION' || project.state === 'PARTIALLY_COLLECTED') return 'help_desk';
  if (project.state === 'IN_PRODUCTION' && completedParts > 0) return 'partially_ready';
  return null;
};

const toBoardItem = (project: ProjectRow, parts: PartRow[]): CollectionBoardItem => {
  const completedParts = parts.filter((part) => completedStatuses.has(part.printStatus)).length;
  const collectedParts = parts.filter((part) => part.printStatus === 'COLLECTED').length;
  const leadPart = [...parts].sort((a, b) => {
    const aWeight = Number(a.primaryEstimatedWeight || 0) + Number(a.secondaryEstimatedWeight || 0);
    const bWeight = Number(b.primaryEstimatedWeight || 0) + Number(b.secondaryEstimatedWeight || 0);
    return bWeight - aWeight || a.partNumber - b.partNumber;
  })[0];
  const leadWeight = leadPart
    ? Number(leadPart.primaryEstimatedWeight || 0) + Number(leadPart.secondaryEstimatedWeight || 0)
    : 0;
  const latestCollectedAt = parts.reduce<string | null>((latest, part) => {
    if (!part.collectedAt) return latest;
    return !latest || part.collectedAt > latest ? part.collectedAt : latest;
  }, null);
  const receiptSaved = Boolean(project.receiptNumber?.trim());
  const overrideSaved = Boolean(project.paymentOverrideNote?.trim());

  return {
    project_code: project.id,
    student_name: project.studentName,
    student_number: project.studentNumber,
    state: project.state,
    group: getBoardGroup(project, completedParts),
    print_label: project.printLabel || null,
    total_parts: parts.length,
    completed_parts: completedParts,
    collected_parts: collectedParts,
    remaining_parts: Math.max(parts.length - collectedParts, 0),
    all_parts_completed: parts.length > 0 && completedParts === parts.length,
    thumbnail_url: leadPart?.imageUrl || null,
    thumbnail_part_name: leadPart?.partName || null,
    thumbnail_weight: leadWeight,
    payment_outstanding: Boolean(project.needsPayment && !project.moduleOrLecturerPays && !receiptSaved && !overrideSaved),
    last_activity_at: latestCollectedAt || project.createdAt || null
  };
};

const buildBoardItems = async (projects: ProjectRow[]) => {
  const parts = await fetchPartRowsForProjects(projects.map((project) => project.id));
  const partsByProject = new Map<string, PartRow[]>();
  parts.forEach((part) => {
    const current = partsByProject.get(part.projectId) || [];
    current.push(part);
    partsByProject.set(part.projectId, current);
  });
  return projects.map((project) => toBoardItem(project, partsByProject.get(project.id) || []));
};

const listBoard = async () => {
  const params = new URLSearchParams({
    select: projectSelect,
    archived: 'eq.false',
    state: 'in.(IN_PRODUCTION,READY_FOR_COLLECTION,PARTIALLY_COLLECTED)',
    order: 'createdAt.desc'
  });
  const response = await hexForgeRest(`projects?${params}`);
  if (!response.ok) {
    const payload = await readErrorPayload(response);
    return jsonResponse({
      error: 'hexforge_collection_board_failed',
      error_description: payload.message || 'Could not load the collection board.'
    }, response.status);
  }
  const rows = await response.json().catch(() => []) as ProjectRow[];
  const data = (await buildBoardItems(rows))
    .filter((item) => item.group !== null)
    .sort((a, b) => (b.last_activity_at || '').localeCompare(a.last_activity_at || ''));
  return jsonResponse({ data });
};

const searchBoard = async (request: Request) => {
  const query = new URL(request.url).searchParams.get('q')?.trim() || '';
  if (!query) {
    return jsonResponse({ error: 'missing_query', error_description: 'Enter a project, student, or collection label.' }, 400);
  }
  const safeQuery = query.replace(/[,*()"']/g, ' ').trim();
  if (!safeQuery) {
    return jsonResponse({ error: 'invalid_query', error_description: 'Enter a searchable project, student, or collection label.' }, 400);
  }
  const params = new URLSearchParams({
    select: projectSelect,
    archived: 'eq.false',
    state: 'not.in.(CLOSED,CANCELLED)',
    or: `(id.ilike.*${safeQuery}*,studentName.ilike.*${safeQuery}*,studentNumber.ilike.*${safeQuery}*,printLabel.ilike.*${safeQuery}*)`,
    order: 'createdAt.desc',
    limit: '25'
  });
  const response = await hexForgeRest(`projects?${params}`);
  if (!response.ok) {
    const payload = await readErrorPayload(response);
    return jsonResponse({ error: 'hexforge_collection_search_failed', error_description: payload.message || 'Could not search HexForge.' }, response.status);
  }
  const rows = await response.json().catch(() => []) as ProjectRow[];
  return jsonResponse({ data: await buildBoardItems(rows) });
};

const getProject = async (request: Request) => {
  const projectCode = normalizeProjectCode(new URL(request.url).searchParams.get('code'));
  if (!projectCode) {
    return jsonResponse({ error: 'invalid_project_code', error_description: 'A valid five-character project code is required.' }, 400);
  }
  const project = await getProjectContext(projectCode);
  if (!project) {
    return jsonResponse({ error: 'project_not_found', error_description: 'No project was found for that code.' }, 404);
  }
  return jsonResponse({ data: project });
};

const saveReceipt = async (request: Request) => {
  const body = await request.json().catch(() => ({})) as { projectCode?: unknown; receiptNumber?: unknown };
  const projectCode = normalizeProjectCode(body.projectCode);
  const receiptNumber = typeof body.receiptNumber === 'string' ? body.receiptNumber.trim() : '';
  if (!projectCode) return jsonResponse({ error: 'invalid_project_code', error_description: 'A valid five-character project code is required.' }, 400);
  if (!receiptNumber) return jsonResponse({ error: 'missing_receipt_number', error_description: 'Enter a receipt number before saving.' }, 400);

  const response = await hexForgeRest(`projects?id=eq.${encodeURIComponent(projectCode)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ receiptNumber })
  });
  if (!response.ok) {
    const payload = await readErrorPayload(response);
    return jsonResponse({ error: 'receipt_save_failed', error_description: payload.message || 'Could not save the receipt number.' }, response.status);
  }
  return jsonResponse({ data: await getProjectContext(projectCode) });
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
  if (!projectCode) return jsonResponse({ error: 'invalid_project_code', error_description: 'A valid five-character project code is required.' }, 400);
  if (!collectorName) return jsonResponse({ error: 'missing_collector_name', error_description: 'The assisting staff member name is required.' }, 400);
  if (!collectedByStudentNumber) return jsonResponse({ error: 'invalid_collected_by_student_number', error_description: 'Enter the eight-digit student number of the person collecting.' }, 400);
  if (partIds.length === 0) return jsonResponse({ error: 'missing_parts', error_description: 'Select at least one part to collect.' }, 400);

  const result = await rpc<TransitionResult>('collect_project_parts', {
    p_project_id: projectCode,
    p_part_ids: partIds,
    p_technician_name: collectorName,
    p_collected_by_student_number: collectedByStudentNumber
  });
  if (!result?.ok) {
    return jsonResponse({
      error: 'collection_failed',
      error_description: Array.isArray(result?.errors) && result.errors.length ? result.errors.join(' ') : 'HexForge rejected the collection action.',
      data: { project: await getProjectContext(projectCode) }
    }, 409);
  }
  return jsonResponse({ data: { project: await getProjectContext(projectCode) } });
};

const releaseProject = async (request: Request, profile: BookingsProfile) => {
  const body = await request.json().catch(() => ({})) as { projectCode?: unknown; printLabel?: unknown };
  const projectCode = normalizeProjectCode(body.projectCode);
  const printLabel = typeof body.printLabel === 'string' ? body.printLabel.trim() : '';
  const technicianName = profile.full_name?.trim();
  if (!projectCode) return jsonResponse({ error: 'invalid_project_code', error_description: 'A valid five-character project code is required.' }, 400);
  if (!technicianName) return jsonResponse({ error: 'missing_profile_name', error_description: 'Your bookings profile needs a full name before releasing projects.' }, 409);

  const result = await rpc<TransitionResult>('release_project_to_collection_from_bookings', {
    p_project_id: projectCode,
    p_technician_name: technicianName,
    p_print_label: printLabel || null
  });
  if (!result?.ok) {
    return jsonResponse({
      error: 'release_failed',
      error_description: Array.isArray(result?.errors) && result.errors.length ? result.errors.join(' ') : 'HexForge rejected the release action.'
    }, 409);
  }
  return jsonResponse({ data: { project: await getProjectContext(projectCode), warnings: result.warnings || [] } });
};

const decodeHtml = (value: string) => value
  .replace(/&nbsp;/gi, ' ')
  .replace(/&lt;/gi, '<')
  .replace(/&gt;/gi, '>')
  .replace(/&quot;/gi, '"')
  .replace(/&#39;|&apos;/gi, "'")
  .replace(/&amp;/gi, '&');

const stripTags = (html: string) => decodeHtml(html
  .replace(/<a\b([^>]*)href=["']([^"']+)["']([^>]*)>(.*?)<\/a>/gi, (_match, _before, href, _after, label) => {
    const cleanLabel = String(label).replace(/<[^>]+>/g, '').trim();
    return cleanLabel && cleanLabel !== href ? `${cleanLabel}: ${href}` : href;
  })
  .replace(/<br\s*\/?>/gi, '\n')
  .replace(/<\/p>/gi, '\n\n')
  .replace(/<\/li>/gi, '\n')
  .replace(/<[^>]+>/g, ''))
  .replace(/\u00a0/g, ' ')
  .replace(/[ \t]+\n/g, '\n')
  .replace(/\n{3,}/g, '\n\n')
  .trim();

const renderEmailText = (value: string, project: ProjectRow, projectLink: string) => {
  const tokenValue = (token: string, attrs = '', content = '') => {
    if (token === 'student_name') return project.studentName;
    if (token === 'project_number') return String(project.priorityNumber);
    const label = attrs.match(/data-label=["']([^"']+)["']/i)?.[1] || stripTags(content) || 'View your print';
    return projectLink ? `${label}: ${projectLink}` : label;
  };
  const rendered = value
    .replace(/\{\{\s*student_name\s*\}\}/gi, project.studentName)
    .replace(/\{\{\s*project_number\s*\}\}/gi, String(project.priorityNumber))
    .replace(/\{\{\s*project_link\s*\}\}/gi, projectLink)
    .replace(
      /<span\b([^>]*)data-email-token=["'](student_name|project_number|project_link)["']([^>]*)>(.*?)<\/span>|<span\b([^>]*)data-email-token=["'](student_name|project_number|project_link)["']([^>]*)\/?>/gi,
      (_match, before = '', tokenA, after = '', content = '', beforeSelf = '', tokenB, afterSelf = '') =>
        tokenValue(tokenA || tokenB, `${before}${after}${beforeSelf}${afterSelf}`, content)
    );
  return stripTags(rendered);
};

const prepareEmail = async (request: Request) => {
  const body = await request.json().catch(() => ({})) as { projectCode?: unknown };
  const projectCode = normalizeProjectCode(body.projectCode);
  if (!projectCode) return jsonResponse({ error: 'invalid_project_code', error_description: 'A valid five-character project code is required.' }, 400);
  const project = await fetchProjectRow(projectCode);
  if (!project) return jsonResponse({ error: 'project_not_found', error_description: 'No project was found for that code.' }, 404);
  if (!['READY_FOR_COLLECTION', 'PARTIALLY_COLLECTED'].includes(project.state)) {
    return jsonResponse({ error: 'project_not_at_help_desk', error_description: 'Collection emails are available only for projects at the help desk.' }, 409);
  }

  const settingsParams = new URLSearchParams({
    select: 'key,value',
    key: 'in.(settings_email_templates,settings_email_signature)'
  });
  const settingsResponse = await hexForgeRest(`config?${settingsParams}`);
  if (!settingsResponse.ok) {
    const payload = await readErrorPayload(settingsResponse);
    return jsonResponse({ error: 'email_settings_failed', error_description: payload.message || 'Could not load HexForge email settings.' }, settingsResponse.status);
  }
  const settingsRows = await settingsResponse.json().catch(() => []) as Array<{ key: string; value: unknown }>;
  const settings = new Map(settingsRows.map((row) => [row.key, row.value]));
  const templates = settings.get('settings_email_templates') as Record<string, StoredEmailTemplate> | undefined;
  const signature = settings.get('settings_email_signature') as { html?: unknown } | undefined;
  const paymentOutstanding = Boolean(project.needsPayment && !project.moduleOrLecturerPays && !project.receiptNumber?.trim() && !project.paymentOverrideNote?.trim());
  const templateKey = paymentOutstanding ? 'collection_payment_reminder' : 'collection_ready';
  const storedTemplate = templates?.[templateKey];
  const fallback = paymentOutstanding
    ? {
        subject: 'MISC 3D Printing Collection - Project #{{project_number}}',
        htmlBody: '<p>Good day <span data-email-token="student_name"></span>,</p><p>Your print is ready for collection.</p><p>Please remember to bring a copy of your payment slip or receipt to collect your print.</p><p>View your print overview and status: <span data-email-token="project_link" data-label="View your print"></span></p>',
        includeSignature: true
      }
    : {
        subject: 'MISC 3D Printing Collection - Project #{{project_number}}',
        htmlBody: '<p>Good day <span data-email-token="student_name"></span>,</p><p>Your print is ready for collection.</p><p>View your print overview and status: <span data-email-token="project_link" data-label="View your print"></span></p>',
        includeSignature: true
      };
  const subjectTemplate = typeof storedTemplate?.subject === 'string' && storedTemplate.subject.trim() ? storedTemplate.subject : fallback.subject;
  const bodyTemplate = typeof storedTemplate?.htmlBody === 'string' && storedTemplate.htmlBody.trim() ? storedTemplate.htmlBody : fallback.htmlBody;
  const includeSignature = typeof storedTemplate?.includeSignature === 'boolean' ? storedTemplate.includeSignature : fallback.includeSignature;
  const signatureHtml = includeSignature && typeof signature?.html === 'string' ? signature.html : '';
  const studentViewUrl = (Deno.env.get('STUDENT_VIEW_URL') || Deno.env.get('VITE_STUDENT_VIEW_URL') || '').trim().replace(/\/+$/, '');
  const projectLink = studentViewUrl ? `${studentViewUrl}/${encodeURIComponent(project.id)}` : '';
  const to = normalizeEmail(project.email) || (normalizeStudentNumber(project.studentNumber) ? `u${project.studentNumber}@tuks.co.za` : null);
  if (!to) return jsonResponse({ error: 'missing_student_email', error_description: 'No valid student email address is available for this project.' }, 409);

  return jsonResponse({
    data: {
      to,
      subject: renderEmailText(subjectTemplate, project, projectLink).replace(/\s+/g, ' ').trim(),
      body: [renderEmailText(bodyTemplate, project, projectLink), renderEmailText(signatureHtml, project, projectLink)].filter(Boolean).join('\n\n')
    }
  });
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const bookingsToken = getBearerToken(request);
    if (!bookingsToken) return jsonResponse({ error: 'missing_authorization', error_description: 'A bookings authorization token is required.' }, 401);
    const profile = await verifyBookingsProfile(bookingsToken);
    if (!profile) return jsonResponse({ error: 'forbidden', error_description: 'Bookings user does not have active access.' }, 403);

    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname.endsWith('/board')) return await listBoard();
    if (request.method === 'GET' && url.pathname.endsWith('/search')) return await searchBoard(request);
    if (request.method === 'PATCH' && url.pathname.endsWith('/receipt')) return await saveReceipt(request);
    if (request.method === 'POST' && url.pathname.endsWith('/collect')) return await collectParts(request);
    if (request.method === 'POST' && url.pathname.endsWith('/release')) return await releaseProject(request, profile);
    if (request.method === 'POST' && url.pathname.endsWith('/email')) return await prepareEmail(request);
    if (request.method === 'GET') return await getProject(request);
    return jsonResponse({ error: 'method_not_allowed' }, 405);
  } catch (error) {
    console.error('bookings-collection error', error);
    return jsonResponse({ error: 'server_error', error_description: error instanceof Error ? error.message : 'Unexpected server error.' }, 500);
  }
});
