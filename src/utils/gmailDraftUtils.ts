import { supabase } from '../lib/supabaseClient';
import { buildUnreadPrintEmailQuery } from '../gmail/gmailParsing';

export type GmailAttachment = {
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
};

export type GmailDraftRequest = {
  to: string;
  subject: string;
  body: string;
  htmlBody?: string;
  attachments?: GmailAttachment[];
};

export type GmailReplyRequest = GmailDraftRequest & {
  threadId: string;
  inReplyTo: string;
  references: string;
};

type GmailDraftResponse = {
  id: string;
  message?: {
    id?: string;
  };
};

export type GmailUnreadPrintEmailSummary = {
  count: number;
  checkedAt: string;
  flaggedSubjects: string[];
  flaggedEmails: GmailUnreadPrintEmail[];
};

export type GmailUnreadPrintEmail = {
  id: string;
  threadId: string;
  subject: string;
  receivedAt: string | null;
  dateHeader: string;
  url: string;
};

type GmailMessageListResponse = {
  messages?: Array<{
    id?: string;
    threadId?: string;
  }>;
  nextPageToken?: string;
};

type GmailMessageMetadataResponse = {
  id?: string;
  threadId?: string;
  internalDate?: string;
  payload?: {
    headers?: Array<{
      name?: string;
      value?: string;
    }>;
  };
};

const gmailProviderTokenStorageKey = 'misc.gmail.provider_token';
const gmailProviderRefreshTokenStorageKey = 'misc.gmail.provider_refresh_token';
const gmailProviderRefreshTokenInvalidKey = 'misc.gmail.provider_refresh_token_invalid';
const googleClientIdStorageKey = 'misc.gmail.google_client_id';
const googleGmailScopes = 'email profile https://www.googleapis.com/auth/gmail.compose https://www.googleapis.com/auth/gmail.readonly';
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

const printEmailSearchTerms = [
  '3d',
  '3d print',
  '3d printing',
  'print',
  'printing',
  'printer',
  'stl',
  '3mf',
  'slicer',
  'filament'
];

type SupabaseGoogleSession = {
  provider_token?: string | null;
  provider_refresh_token?: string | null;
  expires_at?: number | null;
};

type GoogleRefreshResponse = {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
};

type RefreshGoogleTokenFunctionResponse = GoogleRefreshResponse & {
  google_status?: number;
  details?: string;
};

export class GmailAuthError extends Error {
  constructor(message = 'Gmail authorization is required.') {
    super(message);
    this.name = 'GmailAuthError';
  }
}

class GmailApiStatusError extends Error {
  status: number;
  googleError: string;

  constructor(status: number, googleError: string) {
    super(`Gmail API returned ${status}: ${googleError}`);
    this.name = 'GmailApiStatusError';
    this.status = status;
    this.googleError = googleError;
  }
}

const safeJson = (value: unknown) => {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const getStoredTokenDiagnostics = () => ({
  hasStoredGoogleAccessToken: Boolean(window.localStorage.getItem(gmailProviderTokenStorageKey)),
  hasStoredGoogleRefreshToken: Boolean(window.localStorage.getItem(gmailProviderRefreshTokenStorageKey)),
  refreshTokenMarkedInvalid: hasInvalidGoogleProviderRefreshToken(),
  hasStoredGoogleClientId: Boolean(window.localStorage.getItem(googleClientIdStorageKey))
});

const getGmailAuthDiagnostics = async (context: Record<string, unknown> = {}) => {
  const { data, error } = await supabase.auth.getSession();
  const session = data.session as (typeof data.session & SupabaseGoogleSession) | null;

  return {
    ...getStoredTokenDiagnostics(),
    supabaseSessionPresent: Boolean(session),
    supabaseSessionExpiresAt: session?.expires_at ?? null,
    supabaseUserEmail: session?.user?.email ?? null,
    hasSessionProviderToken: Boolean(session?.provider_token),
    hasSessionProviderRefreshToken: Boolean(session?.provider_refresh_token),
    supabaseSessionError: error?.message ?? null,
    ...context
  };
};

const readGoogleError = async (response: Response) => {
  const errorText = await response.text();
  if (!errorText) return `Google API returned ${response.status}.`;

  try {
    const payload = JSON.parse(errorText) as {
      error?: {
        message?: string;
        status?: string;
        details?: Array<{ reason?: string; metadata?: Record<string, string> }>;
      };
    };
    const message = payload.error?.message || errorText;
    const reason = payload.error?.details?.map((detail) => detail.reason).filter(Boolean).join(', ');
    return reason ? `${message} (${reason})` : message;
  } catch {
    return errorText;
  }
};

const base64FromBytes = (bytes: Uint8Array) => {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
};

const base64FromUtf8 = (value: string) => base64FromBytes(new TextEncoder().encode(value));

const base64UrlFromUtf8 = (value: string) =>
  base64FromUtf8(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');

const wrapBase64 = (value: string) => value.match(/.{1,76}/g)?.join('\r\n') || '';

const sanitizeHeader = (value: string) => value.replace(/[\r\n]+/g, ' ').trim();

const encodeSubject = (subject: string) => {
  const sanitized = sanitizeHeader(subject);
  return Array.from(sanitized).every((character) => character.charCodeAt(0) <= 127)
    ? sanitized
    : `=?UTF-8?B?${base64FromUtf8(sanitized)}?=`;
};

const buildMimeMessage = ({
  to,
  subject,
  body,
  htmlBody,
  attachments = [],
  inReplyTo,
  references
}: GmailDraftRequest & { inReplyTo?: string; references?: string }) => {
  const mixedBoundary = `misc_mixed_${crypto.randomUUID()}`;
  const alternativeBoundary = `misc_alt_${crypto.randomUUID()}`;
  const parts = [
    `To: ${sanitizeHeader(to)}`,
    `Subject: ${encodeSubject(subject)}`,
    ...(inReplyTo ? [`In-Reply-To: ${sanitizeHeader(inReplyTo)}`] : []),
    ...(references ? [`References: ${sanitizeHeader(references)}`] : []),
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`,
    '',
    `--${mixedBoundary}`,
    `Content-Type: multipart/alternative; boundary="${alternativeBoundary}"`,
    '',
    `--${alternativeBoundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    wrapBase64(base64FromUtf8(body)),
    ''
  ];

  if (htmlBody?.trim()) {
    parts.push(
      `--${alternativeBoundary}`,
      'Content-Type: text/html; charset="UTF-8"',
      'Content-Transfer-Encoding: base64',
      '',
      wrapBase64(base64FromUtf8(htmlBody)),
      ''
    );
  }

  parts.push(`--${alternativeBoundary}--`, '');

  attachments.forEach((attachment) => {
    parts.push(
      `--${mixedBoundary}`,
      `Content-Type: ${attachment.mimeType}; name="${sanitizeHeader(attachment.filename)}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${sanitizeHeader(attachment.filename)}"`,
      '',
      wrapBase64(base64FromBytes(attachment.bytes)),
      ''
    );
  });

  parts.push(`--${mixedBoundary}--`, '');
  return parts.join('\r\n');
};

export const persistGoogleProviderToken = (providerToken?: string | null) => {
  if (!providerToken) return;
  window.localStorage.setItem(gmailProviderTokenStorageKey, providerToken);
};

export const persistGoogleProviderRefreshToken = (providerRefreshToken?: string | null) => {
  if (!providerRefreshToken) return;
  window.localStorage.setItem(gmailProviderRefreshTokenStorageKey, providerRefreshToken);
  window.localStorage.removeItem(gmailProviderRefreshTokenInvalidKey);
};

export const persistGoogleProviderTokens = (
  providerToken?: string | null,
  providerRefreshToken?: string | null
) => {
  persistGoogleProviderToken(providerToken);
  persistGoogleProviderRefreshToken(providerRefreshToken);
};

export const clearGoogleProviderTokens = () => {
  window.localStorage.removeItem(gmailProviderTokenStorageKey);
  window.localStorage.removeItem(gmailProviderRefreshTokenStorageKey);
  window.localStorage.removeItem(gmailProviderRefreshTokenInvalidKey);
};

const hasGoogleProviderRefreshToken = () =>
  Boolean(window.localStorage.getItem(gmailProviderRefreshTokenStorageKey));

const hasInvalidGoogleProviderRefreshToken = () =>
  window.localStorage.getItem(gmailProviderRefreshTokenInvalidKey) === 'true';

export const captureGoogleProviderTokenFromUrl = () => {
  const urlParams = new URLSearchParams(window.location.search);
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  persistGoogleProviderTokens(
    urlParams.get('provider_token') || hashParams.get('provider_token'),
    urlParams.get('provider_refresh_token') || hashParams.get('provider_refresh_token')
  );
};

export const syncGoogleProviderTokensFromSession = (session?: SupabaseGoogleSession | null) => {
  persistGoogleProviderTokens(session?.provider_token, session?.provider_refresh_token);
};

const refreshGoogleAccessToken = async () => {
  const refreshToken = window.localStorage.getItem(gmailProviderRefreshTokenStorageKey);
  if (!refreshToken) return null;

  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || !sessionData.session?.access_token) {
    throw new GmailAuthError([
      'Cannot renew Gmail access because there is no active Supabase session for the refresh function.',
      `Supabase session error: ${sessionError?.message || 'none'}`,
      `Local Gmail auth diagnostics: ${safeJson(await getGmailAuthDiagnostics({ stage: 'missing_supabase_session_for_refresh' }))}`
    ].join('\n'));
  }

  const response = await fetch(`${supabaseUrl}/functions/v1/refresh-google-token`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${sessionData.session.access_token}`,
      apikey: supabaseAnonKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      refresh_token: refreshToken
    })
  });

  const payload = await response.json().catch(() => ({})) as RefreshGoogleTokenFunctionResponse;
  if (!response.ok) {
    if (payload.error === 'invalid_grant') {
      window.localStorage.setItem(gmailProviderRefreshTokenInvalidKey, 'true');
      window.localStorage.removeItem(gmailProviderTokenStorageKey);
      window.localStorage.removeItem(gmailProviderRefreshTokenStorageKey);
    }

    throw new GmailAuthError([
      `Could not renew Gmail access: ${payload.error_description || payload.error || `HTTP ${response.status}`}`,
      `Refresh function status: ${response.status} ${response.statusText || ''}`.trim(),
      `Google token endpoint status: ${payload.google_status ?? 'unknown'}`,
      `Google token endpoint error: ${payload.error || 'none'}`,
      `Google token endpoint error_description: ${payload.error_description || 'none'}`,
      `OAuth scope returned by Google: ${payload.scope || 'none'}`,
      `Refresh function details: ${payload.details || 'none'}`,
      `Local Gmail auth diagnostics: ${safeJson(await getGmailAuthDiagnostics({ refreshAttempt: true, stage: 'edge_refresh_failed' }))}`
    ].join('\n'));
  }

  if (!payload.access_token) return null;

  persistGoogleProviderTokens(payload.access_token, payload.refresh_token || refreshToken);
  return payload.access_token;
};

const getCachedGoogleAccessToken = async () => {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new GmailAuthError(error.message);

  const session = data.session as (typeof data.session & { provider_token?: string }) | null;
  syncGoogleProviderTokensFromSession(session);

  return {
    accessToken: session?.provider_token || window.localStorage.getItem(gmailProviderTokenStorageKey),
    session
  };
};

const getGoogleAccessToken = async (refreshPromise?: Promise<string | null> | null) => {
  const { accessToken, session } = await getCachedGoogleAccessToken();
  if (accessToken) return accessToken;

  const refreshedToken = refreshPromise ? await refreshPromise : await refreshGoogleAccessToken();
  if (refreshedToken) return refreshedToken;

  throw new GmailAuthError([
    'No Google Gmail access token is available, and no refresh token could renew it.',
    `Supabase session present: ${Boolean(session)}`,
    `Supabase session expires_at: ${session?.expires_at ?? 'unknown'}`,
    `Local Gmail auth diagnostics: ${safeJson(await getGmailAuthDiagnostics({ stage: 'no_access_token' }))}`
  ].join('\n'));
};

const sendDraftRequest = async (accessToken: string, raw: string) =>
  fetch('https://gmail.googleapis.com/gmail/v1/users/me/drafts', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ message: { raw } })
  });

const listUnreadPrintEmailIds = async (accessToken: string) => {
  const messageIds = new Set<string>();

  for (const term of printEmailSearchTerms) {
    let pageToken: string | undefined;

    do {
      const url = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages');
      url.searchParams.set('q', buildUnreadPrintEmailQuery(term));
      url.searchParams.set('maxResults', '100');
      if (pageToken) {
        url.searchParams.set('pageToken', pageToken);
      }

      const response = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      });

      if (!response.ok) {
        throw new GmailApiStatusError(response.status, await readGoogleError(response));
      }

      const payload = await response.json() as GmailMessageListResponse;
      payload.messages?.forEach((message) => {
        if (message.id) {
          messageIds.add(message.id);
        }
      });
      pageToken = payload.nextPageToken;
    } while (pageToken);
  }

  return messageIds;
};

const getGmailHeaderValue = (message: GmailMessageMetadataResponse, headerName: string) => {
  const header = message.payload?.headers?.find(
    (item) => item.name?.toLowerCase() === headerName.toLowerCase()
  );

  return header?.value?.trim() || '(no subject)';
};

const getGmailMessageUrl = (messageId: string) =>
  `https://mail.google.com/mail/u/0/#inbox/${encodeURIComponent(messageId)}`;

const getGmailMessageReceivedAt = (message: GmailMessageMetadataResponse) => {
  if (message.internalDate && /^\d+$/.test(message.internalDate)) {
    return new Date(Number(message.internalDate)).toISOString();
  }

  const dateHeader = getGmailHeaderValue(message, 'Date');
  const parsedDate = new Date(dateHeader);
  return Number.isNaN(parsedDate.getTime()) ? null : parsedDate.toISOString();
};

const getFlaggedPrintEmail = async (accessToken: string, messageId: string): Promise<GmailUnreadPrintEmail> => {
  const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}`);
  url.searchParams.set('format', 'metadata');
  url.searchParams.append('metadataHeaders', 'Subject');
  url.searchParams.append('metadataHeaders', 'Date');

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    throw new GmailApiStatusError(response.status, await readGoogleError(response));
  }

  const payload = await response.json() as GmailMessageMetadataResponse;
  const id = payload.id || messageId;

  return {
    id,
    threadId: payload.threadId || id,
    subject: getGmailHeaderValue(payload, 'Subject'),
    receivedAt: getGmailMessageReceivedAt(payload),
    dateHeader: getGmailHeaderValue(payload, 'Date'),
    url: getGmailMessageUrl(id)
  };
};

const getFlaggedPrintEmails = async (accessToken: string, messageIds: Set<string>) => {
  const emails = await Promise.all(
    Array.from(messageIds).map((messageId) => getFlaggedPrintEmail(accessToken, messageId))
  );

  const sorted = emails.sort((first, second) => {
    const firstTime = first.receivedAt ? new Date(first.receivedAt).getTime() : 0;
    const secondTime = second.receivedAt ? new Date(second.receivedAt).getTime() : 0;
    return secondTime - firstTime || first.subject.localeCompare(second.subject);
  });

  const seenThreads = new Set<string>();
  return sorted.filter((email) => {
    if (seenThreads.has(email.threadId)) return false;
    seenThreads.add(email.threadId);
    return true;
  }).slice(0, 10);
};

const logFlaggedPrintEmails = (emails: GmailUnreadPrintEmail[]) => {
  console.groupCollapsed(`Unread 3D print email threads (${emails.length})`);
  console.table(emails.map((email) => ({
    subject: email.subject,
    receivedAt: email.receivedAt || email.dateHeader
  })));
  console.groupEnd();
};

const buildUnreadPrintEmailSummary = async (
  accessToken: string
): Promise<GmailUnreadPrintEmailSummary> => {
  const messageIds = await listUnreadPrintEmailIds(accessToken);
  const flaggedEmails = await getFlaggedPrintEmails(accessToken, messageIds);
  const flaggedSubjects = flaggedEmails.map((email) => email.subject);
  logFlaggedPrintEmails(flaggedEmails);

  return {
    count: flaggedEmails.length,
    checkedAt: new Date().toISOString(),
    flaggedSubjects,
    flaggedEmails
  };
};

const getReturnPath = () => {
  const returnPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  const lowerPath = window.location.pathname.toLowerCase();

  if (lowerPath === '/login' || lowerPath === '/auth-callback') {
    return '/';
  }

  return returnPath;
};

const startGoogleOAuth = async ({ forceConsent = false }: { forceConsent?: boolean } = {}) => {
  const redirectTo = `${window.location.origin}/auth-callback?next=${encodeURIComponent(getReturnPath())}`;
  await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo,
      scopes: googleGmailScopes,
      queryParams: {
        access_type: 'offline',
        include_granted_scopes: 'true',
        ...(forceConsent ? { prompt: 'consent' } : {})
      }
    }
  });
};

export const createGmailDraft = async (draftRequest: GmailDraftRequest) => {
  const refreshPromise = hasGoogleProviderRefreshToken() ? refreshGoogleAccessToken() : null;
  refreshPromise?.catch((error: unknown) => {
    console.warn('Background Gmail access refresh failed', error);
  });

  let accessToken = await getGoogleAccessToken(refreshPromise);
  const raw = base64UrlFromUtf8(buildMimeMessage(draftRequest));

  let response = await sendDraftRequest(accessToken, raw);

  if (response.status === 401) {
    const refreshedToken = refreshPromise ? await refreshPromise : await refreshGoogleAccessToken();
    if (refreshedToken) {
      accessToken = refreshedToken;
      response = await sendDraftRequest(accessToken, raw);
    }
  }

  if (response.status === 401) {
    const diagnostics = await getGmailAuthDiagnostics({
      stage: 'gmail_401_after_refresh_attempt',
      hadAccessTokenForRequest: Boolean(accessToken)
    });
    clearGoogleProviderTokens();
    throw new GmailAuthError([
      'Google rejected the Gmail access token after a refresh attempt.',
      `Gmail API response: ${await readGoogleError(response)}`,
      `Local Gmail auth diagnostics: ${safeJson(diagnostics)}`
    ].join('\n'));
  }

  if (response.status === 403) {
    const googleError = await readGoogleError(response);
    if (googleError.toLowerCase().includes('insufficient') || googleError.toLowerCase().includes('scope')) {
      clearGoogleProviderTokens();
      throw new GmailAuthError(`Google says the Gmail token does not have draft permission: ${googleError}`);
    }
    throw new Error(`Gmail API returned 403: ${googleError}`);
  }

  if (!response.ok) {
    throw new Error(await readGoogleError(response));
  }

  const draft = await response.json() as GmailDraftResponse;
  return {
    draftId: draft.id,
    messageId: draft.message?.id,
    url: `https://mail.google.com/mail/u/0/#drafts/${encodeURIComponent(draft.message?.id || draft.id)}`
  };
};

export const gmailApiFetch = async (path: string, init: RequestInit = {}): Promise<Response> => {
  const refreshPromise = hasGoogleProviderRefreshToken() ? refreshGoogleAccessToken() : null;
  refreshPromise?.catch((error: unknown) => {
    console.warn('Background Gmail access refresh failed', error);
  });

  let accessToken = await getGoogleAccessToken(refreshPromise);
  const send = () => fetch(`https://gmail.googleapis.com/gmail/v1/users/me${path}`, {
    ...init,
    headers: {
      ...init.headers,
      Authorization: `Bearer ${accessToken}`
    }
  });
  let response = await send();

  if (response.status === 401) {
    const refreshedToken = refreshPromise ? await refreshPromise : await refreshGoogleAccessToken();
    if (refreshedToken) {
      accessToken = refreshedToken;
      response = await send();
    }
  }

  if (response.status === 401) {
    clearGoogleProviderTokens();
    throw new GmailAuthError(`Google rejected the Gmail access token: ${await readGoogleError(response)}`);
  }

  if (response.status === 403) {
    const googleError = await readGoogleError(response);
    if (googleError.toLowerCase().includes('insufficient') || googleError.toLowerCase().includes('scope')) {
      clearGoogleProviderTokens();
      throw new GmailAuthError(`Google says the Gmail token does not have the required permission: ${googleError}`);
    }
    throw new Error(`Gmail API returned 403: ${googleError}`);
  }

  return response;
};

export const sendGmailThreadReply = async (request: GmailReplyRequest) => {
  const raw = base64UrlFromUtf8(buildMimeMessage(request));
  const response = await gmailApiFetch('/messages/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw, threadId: request.threadId })
  });
  if (!response.ok) throw new Error(await readGoogleError(response));
  return response.json() as Promise<{ id: string; threadId: string; labelIds?: string[] }>;
};

export const getUnread3dPrintEmailSummary = async (): Promise<GmailUnreadPrintEmailSummary> => {
  const refreshPromise = hasGoogleProviderRefreshToken() ? refreshGoogleAccessToken() : null;
  refreshPromise?.catch((error: unknown) => {
    console.warn('Background Gmail access refresh failed', error);
  });

  let accessToken = await getGoogleAccessToken(refreshPromise);

  try {
    return await buildUnreadPrintEmailSummary(accessToken);
  } catch (error) {
    if (error instanceof GmailApiStatusError && error.status === 401) {
      const refreshedToken = refreshPromise ? await refreshPromise : await refreshGoogleAccessToken();
      if (refreshedToken) {
        accessToken = refreshedToken;
        return await buildUnreadPrintEmailSummary(accessToken);
      }

      clearGoogleProviderTokens();
      throw new GmailAuthError([
        'Google rejected the Gmail access token while checking unread print emails.',
        `Gmail API response: ${error.googleError}`,
        `Local Gmail auth diagnostics: ${safeJson(await getGmailAuthDiagnostics({ stage: 'unread_print_email_401' }))}`
      ].join('\n'));
    }

    if (error instanceof GmailApiStatusError && error.status === 403) {
      if (error.googleError.toLowerCase().includes('insufficient') || error.googleError.toLowerCase().includes('scope')) {
        clearGoogleProviderTokens();
        throw new GmailAuthError(`Google says the Gmail token does not have read permission: ${error.googleError}`);
      }
      throw new Error(`Gmail API returned 403: ${error.googleError}`);
    }

    throw error;
  }
};

export const requestGmailDraftAccess = async () => {
  await startGoogleOAuth({ forceConsent: true });
};

export const requestGmailReadAccess = async () => {
  await startGoogleOAuth({ forceConsent: true });
};

export const requestGoogleSignIn = async () => {
  await startGoogleOAuth({ forceConsent: !hasGoogleProviderRefreshToken() || hasInvalidGoogleProviderRefreshToken() });
};
