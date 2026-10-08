import { signInWithGoogleOAuth } from '@/api/supabase/auth';
import { beginGmailConnection, invokeGmailProxy } from '@/api/supabase/edgeFunctions';

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

const gmailProviderTokenStorageKey = 'misc.gmail.provider_token';
const gmailProviderRefreshTokenStorageKey = 'misc.gmail.provider_refresh_token';
const gmailProviderRefreshTokenInvalidKey = 'misc.gmail.provider_refresh_token_invalid';
const googleIdentityScopes = 'email profile';

export class GmailAuthError extends Error {
  constructor(message = 'Gmail authorization is required.') {
    super(message);
    this.name = 'GmailAuthError';
  }
}

export class GmailApiStatusError extends Error {
  status: number;
  googleError: string;

  constructor(status: number, googleError: string) {
    super(`Gmail API returned ${status}: ${googleError}`);
    this.name = 'GmailApiStatusError';
    this.status = status;
    this.googleError = googleError;
  }
}

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

export const clearGoogleProviderTokens = () => {
  window.localStorage.removeItem(gmailProviderTokenStorageKey);
  window.localStorage.removeItem(gmailProviderRefreshTokenStorageKey);
  window.localStorage.removeItem(gmailProviderRefreshTokenInvalidKey);
};

const sendDraftRequest = async (raw: string) =>
  gmailApiFetch('/drafts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: { raw } })
  });

const getReturnPath = () => {
  const returnPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  const lowerPath = window.location.pathname.toLowerCase();

  if (lowerPath === '/login' || lowerPath === '/auth-callback') {
    return '/';
  }

  return returnPath;
};

const startGoogleSignIn = async () => {
  const redirectTo = `${window.location.origin}/auth-callback?next=${encodeURIComponent(getReturnPath())}`;
  await signInWithGoogleOAuth({
    redirectTo,
    scopes: googleIdentityScopes,
    queryParams: { prompt: 'select_account' }
  });
};

const startGmailConnection = async () => {
  clearGoogleProviderTokens();
  const { response, payload } = await beginGmailConnection(getReturnPath());
  if (!response.ok || !payload.authorization_url) {
    throw new GmailAuthError(payload.error_description || 'Gmail authorization could not be started.');
  }
  window.location.assign(payload.authorization_url);
};

export const createGmailDraft = async (draftRequest: GmailDraftRequest) => {
  const raw = base64UrlFromUtf8(buildMimeMessage(draftRequest));
  const response = await sendDraftRequest(raw);

  if (response.status === 401) {
    throw new GmailAuthError('Connect Gmail again to create drafts.');
  }

  if (response.status === 403) {
    const googleError = await readGoogleError(response);
    if (googleError.toLowerCase().includes('insufficient') || googleError.toLowerCase().includes('scope')) {
      throw new GmailAuthError('Gmail did not grant draft permission.');
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
  const response = await invokeGmailProxy(path, init);
  if (response.status === 401) {
    throw new GmailAuthError('Connect Gmail to continue.');
  }

  if (response.status === 403) {
    const googleError = await readGoogleError(response);
    if (googleError.toLowerCase().includes('insufficient') || googleError.toLowerCase().includes('scope')) {
      throw new GmailAuthError('Gmail did not grant the required permission.');
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

export const requestGmailDraftAccess = async () => {
  await startGmailConnection();
};

export const requestGmailReadAccess = async () => {
  await startGmailConnection();
};

export const requestGoogleSignIn = async () => {
  clearGoogleProviderTokens();
  await startGoogleSignIn();
};
