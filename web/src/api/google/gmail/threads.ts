import { gmailApiFetch, GmailApiStatusError } from '@/api/google/gmail/client';
import { readSnapshot, writeSnapshot, removeReadSnapshots } from '@/lib/persistentReads';
import { getAuthSession } from '@/api/supabase/auth';
import { decodeBase64UrlBytes, stripQuotedReplyContent } from './decoding';
import type { GmailThreadAttachment, GmailThreadListItem, GmailThreadMessage, GmailThreadSnapshot } from './types';
import { buildCurrentYearPrintEmailQuery, gmailCalendarYear, getGmailMessageDirection, isSupportedGmailAttachment } from './search';

type GmailHeader = { name?: string; value?: string };
type GmailPart = {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { attachmentId?: string; size?: number; data?: string };
  parts?: GmailPart[];
};
type GmailMessage = {
  id?: string;
  threadId?: string;
  labelIds?: string[];
  internalDate?: string;
  snippet?: string;
  payload?: GmailPart;
};
type GmailThreadResponse = { id?: string; messages?: GmailMessage[] };

const PRINT_TERMS = ['3d', '3d print', '3d printing', 'print', 'printing', 'printer', 'stl', '3mf', 'slicer', 'filament'];

const headerValue = (message: GmailMessage, name: string) => message.payload?.headers
  ?.find((header) => header.name?.toLowerCase() === name.toLowerCase())?.value?.trim() || '';

const decodeBase64Url = (value: string): string => new TextDecoder().decode(decodeBase64UrlBytes(value));

const htmlToPlainText = (html: string): string => {
  if (typeof DOMParser === 'undefined') return stripQuotedReplyContent(html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
  const document = new DOMParser().parseFromString(html, 'text/html');
  document.querySelectorAll('script,style,iframe,object,embed,.gmail_quote,blockquote').forEach((element) => element.remove());
  return stripQuotedReplyContent(document.body.textContent || '');
};

const collectParts = (part?: GmailPart): GmailPart[] => part
  ? [part, ...(part.parts?.flatMap((child) => collectParts(child)) || [])]
  : [];

const messageBody = (message: GmailMessage): string => {
  const parts = collectParts(message.payload);
  const plain = parts.find((part) => part.mimeType?.toLowerCase() === 'text/plain' && part.body?.data);
  if (plain?.body?.data) return stripQuotedReplyContent(decodeBase64Url(plain.body.data));
  const html = parts.find((part) => part.mimeType?.toLowerCase() === 'text/html' && part.body?.data);
  if (html?.body?.data) return htmlToPlainText(decodeBase64Url(html.body.data));
  if (message.payload?.body?.data) return stripQuotedReplyContent(decodeBase64Url(message.payload.body.data));
  return stripQuotedReplyContent(message.snippet || '');
};

const parseAddress = (value: string): { name: string; email: string } => {
  const angle = value.match(/^\s*"?([^"<]*)"?\s*<([^>]+)>/);
  if (angle) return { name: angle[1].trim(), email: angle[2].trim().toLowerCase() };
  const email = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]?.toLowerCase() || '';
  return { name: email ? value.replace(email, '').replace(/[<>"']/g, '').trim() : '', email };
};

const parseAddressList = (value: string): string[] => value
  .split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)
  .map((item) => parseAddress(item).email)
  .filter(Boolean);

const attachmentsFor = (messageId: string, message: GmailMessage): GmailThreadAttachment[] => collectParts(message.payload)
  .filter((part) => Boolean(part.filename?.trim()))
  .map((part, index) => ({
    messageId,
    attachmentId: part.body?.attachmentId || null,
    partId: part.partId || `part-${index}`,
    filename: part.filename?.trim() || `attachment-${index}`,
    mimeType: part.mimeType || 'application/octet-stream',
    size: Number(part.body?.size || 0)
  }));

const messageDate = (message: GmailMessage): string => {
  if (message.internalDate && /^\d+$/.test(message.internalDate)) return new Date(Number(message.internalDate)).toISOString();
  const parsed = new Date(headerValue(message, 'Date'));
  return Number.isNaN(parsed.getTime()) ? new Date(0).toISOString() : parsed.toISOString();
};

const fetchJson = async <T>(path: string, signal?: AbortSignal): Promise<T> => {
  let response = await gmailApiFetch(path, { signal });
  for (let attempt = 0; response.status === 429 && attempt < 3; attempt++) {
    const retryAfter = response.headers.get('Retry-After');
    const seconds = retryAfter === null ? NaN : Number(retryAfter);
    const delay = Number.isFinite(seconds) ? Math.max(0, seconds * 1000)
      : retryAfter && Number.isFinite(Date.parse(retryAfter)) ? Math.max(0, Date.parse(retryAfter) - Date.now())
      : 1000 * 2 ** attempt;
    await new Promise(resolve => setTimeout(resolve, delay));
    signal?.throwIfAborted();
    response = await gmailApiFetch(path, { signal });
  }
  if (!response.ok) throw new GmailApiStatusError(response.status, await response.text());
  return response.json() as Promise<T>;
};

export const getGmailAccountEmail = async (signal?: AbortSignal): Promise<string> => {
  const profile = await fetchJson<{ emailAddress?: string }>('/profile', signal);
  return profile.emailAddress?.trim().toLowerCase() || '';
};

export const getGmailThread = async (threadId: string, knownAccountEmail?: string, signal?: AbortSignal): Promise<GmailThreadSnapshot> => {
  const [payload, accountEmail] = await Promise.all([
    fetchJson<GmailThreadResponse>(`/threads/${encodeURIComponent(threadId)}?format=full`, signal),
    knownAccountEmail ? Promise.resolve(knownAccountEmail) : getGmailAccountEmail(signal)
  ]);
  const rawMessages = payload.messages || [];
  const messages: GmailThreadMessage[] = rawMessages.map((message): GmailThreadMessage => {
    const id = message.id || '';
    const sender = parseAddress(headerValue(message, 'From'));
    const recipientEmails = [
      ...parseAddressList(headerValue(message, 'To')),
      ...parseAddressList(headerValue(message, 'Cc'))
    ];
    const attachments = attachmentsFor(id, message);
    return {
      id,
      threadId: message.threadId || payload.id || threadId,
      senderName: sender.name,
      senderEmail: sender.email,
      recipientEmails,
      subject: headerValue(message, 'Subject') || '(no subject)',
      body: messageBody(message),
      messageDate: messageDate(message),
      direction: getGmailMessageDirection(sender.email, accountEmail, message.labelIds?.includes('SENT')),
      hasAttachments: attachments.length > 0,
      messageIdHeader: headerValue(message, 'Message-ID'),
      referencesHeader: headerValue(message, 'References'),
      attachments
    };
  }).filter((message) => message.id).sort((left, right) => left.messageDate.localeCompare(right.messageDate));
  const externalSender = messages.find((message) => message.senderEmail && message.senderEmail !== accountEmail.toLowerCase());
  const externalRecipient = messages.flatMap((message) => message.recipientEmails)
    .find((email) => email !== accountEmail.toLowerCase());

  return {
    id: payload.id || threadId,
    accountEmail,
    hasUnread: rawMessages.some(message => message.labelIds?.includes('UNREAD')),
    hasSpam: rawMessages.some(message => message.labelIds?.includes('SPAM')),
    subject: messages.at(-1)?.subject || messages[0]?.subject || '(no subject)',
    mainContactEmail: externalSender?.senderEmail || externalRecipient || '',
    messages,
    syncedAt: new Date().toISOString()
  };
};

type RecentThreads = {
  accountEmail: string;
  year: number;
  historyId: string;
  fullSyncedAt: number;
  items: GmailThreadListItem[];
};
type GmailHistory = {
  historyId?: string;
  nextPageToken?: string;
  history?: Array<{
    messages?: Array<{ threadId?: string }>;
    messagesAdded?: Array<{ message?: { threadId?: string } }>;
    messagesDeleted?: Array<{ message?: { threadId?: string } }>;
    labelsAdded?: Array<{ message?: { threadId?: string } }>;
    labelsRemoved?: Array<{ message?: { threadId?: string } }>;
  }>;
};
const fullSyncIntervalMs = 3 * 60 * 60 * 1000;
const pendingLists = new Map<string, Promise<GmailThreadListItem[]>>();
let cacheGeneration = 0;
// Every open checks Gmail. Replies make any already-running result ineligible for persistence.
export const invalidateRecentGmailThreads = () => { cacheGeneration++; pendingLists.clear(); };

const listMatchingThreadIds = async (query: string, signal?: AbortSignal): Promise<string[]> => {
  const ids = new Set<string>();
  const pages = new Set<string>();
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({ maxResults: String(50 - ids.size), q: query, includeSpamTrash: 'true' });
    if (pageToken) params.set('pageToken', pageToken);
    const result = await fetchJson<{ threads?: Array<{ id?: string }>; nextPageToken?: string }>(
      `/threads?${params}`, signal
    );
    for (const thread of result.threads || []) {
      if (thread.id) ids.add(thread.id);
      if (ids.size === 50) break;
    }
    pageToken = result.nextPageToken;
    if (pageToken && pages.has(pageToken)) throw new Error('Gmail returned a repeated page token. Please refresh.');
    if (pageToken) pages.add(pageToken);
  } while (ids.size < 50 && pageToken);
  return [...ids];
};

export const listRecent3dPrintThreads = async (options: {
  onProgress?: (items: GmailThreadListItem[]) => void;
  onMembership?: (threadIds: string[], accountEmail: string) => void;
  signal?: AbortSignal;
  forceRefresh?: boolean;
} = {}): Promise<GmailThreadListItem[]> => {
  options.signal?.throwIfAborted();
  const { data } = await getAuthSession();
  const ownerId = data.session?.user.id;
  if (!ownerId) return loadRecent3dPrintThreads(undefined, options);
  let pending = pendingLists.get(ownerId);
  if (!pending) {
    pending = loadRecent3dPrintThreads(ownerId, {
      onMembership: options.onMembership,
      onProgress: next => { if (!options.signal?.aborted) options.onProgress?.(next); }
    });
    pendingLists.set(ownerId, pending);
    void pending.finally(() => { if (pendingLists.get(ownerId) === pending) pendingLists.delete(ownerId); }).catch(() => {});
  }
  const items = await pending;
  options.signal?.throwIfAborted();
  options.onProgress?.(items);
  return items;
};

const loadRecent3dPrintThreads = async (ownerId: string | undefined, options: {
  onProgress?: (items: GmailThreadListItem[]) => void;
  onMembership?: (threadIds: string[], accountEmail: string) => void;
  signal?: AbortSignal;
}): Promise<GmailThreadListItem[]> => {
  const groupedTerms = PRINT_TERMS.map((term) => /\s/.test(term) ? `"${term}"` : term).join(' ');
  const year = gmailCalendarYear();
  const query = `${buildCurrentYearPrintEmailQuery('3d', year).replace(/\s+3d$/, '')} {${groupedTerms}}`;
  const generation = cacheGeneration;
  const key = `gmail-threads:${ownerId}`;
  await removeReadSnapshots(['unread-gmail-v1:', 'recent-gmail-v2:']);
  const [threadIds, profile, saved] = await Promise.all([
    listMatchingThreadIds(query, options.signal),
    fetchJson<{ emailAddress?: string; historyId?: string }>('/profile', options.signal),
    ownerId ? readSnapshot<RecentThreads>(key) : Promise.resolve(undefined)
  ]);
  const accountEmail = profile.emailAddress?.trim().toLowerCase() || '';
  options.onMembership?.(threadIds, accountEmail);
  let reusable = saved?.year === year && saved?.accountEmail === accountEmail && Array.isArray(saved.items)
    && Boolean(saved.historyId && profile.historyId)
    && Date.now() - saved.fullSyncedAt < fullSyncIntervalMs;
  const changed = new Set<string>();
  let historyId = profile.historyId || '';
  if (reusable && saved && saved.historyId !== historyId) {
    try {
      let pageToken: string | undefined;
      do {
        const params = new URLSearchParams({ startHistoryId: saved.historyId, maxResults: '500' });
        if (pageToken) params.set('pageToken', pageToken);
        const history = await fetchJson<GmailHistory>(`/history?${params}`, options.signal);
        history.history?.forEach(record => [
          ...(record.messages || []),
          ...[...(record.messagesAdded || []), ...(record.messagesDeleted || []),
            ...(record.labelsAdded || []), ...(record.labelsRemoved || [])]
            .flatMap(change => change.message ? [change.message] : [])
        ].forEach(message => {
          if (message.threadId) changed.add(message.threadId);
        }));
        historyId = history.historyId || historyId;
        pageToken = history.nextPageToken;
      } while (pageToken);
    } catch (error) {
      if (!(error instanceof GmailApiStatusError) || error.status !== 404) throw error;
      reusable = false; // Expired Gmail change cursor: verify all current threads again.
    }
  }
  const previous = new Map((reusable ? saved!.items : []).map(item => [item.threadId, item]));
  const loaded: GmailThreadListItem[] = [];
  let newestReady = false;
  let failed = false;
  const sorted = () => [...loaded].sort((left, right) => right.messageDate.localeCompare(left.messageDate));
  let nextIndex = 0;
  const loadThread = async (threadId: string) => {
    options.signal?.throwIfAborted();
    const cached = previous.get(threadId);
    if (cached && typeof cached.snapshot.hasUnread === 'boolean' && typeof cached.snapshot.hasSpam === 'boolean'
      && !changed.has(threadId)) { loaded.push(cached); return; }
    const snapshot = await getGmailThread(threadId, accountEmail, options.signal);
    const latest = snapshot.messages.at(-1);
    const representative = [...snapshot.messages].reverse().find((message) => message.direction === 'incoming') || latest;
    const item = {
      threadId: snapshot.id,
      messageId: representative?.id || '',
      senderName: representative?.senderName || '',
      senderEmail: representative?.senderEmail || '',
      subject: snapshot.subject,
      messageDate: latest?.messageDate || snapshot.syncedAt,
      preview: (representative?.body || '').replace(/\s+/g, ' ').trim().slice(0, 180),
      attachmentFilenames: [...new Set(snapshot.messages.flatMap((message) => message.attachments)
        .filter((attachment) => isSupportedGmailAttachment(attachment.filename))
        .map((attachment) => attachment.filename))],
      snapshot
    } satisfies GmailThreadListItem;
    loaded.push(item);
    if (threadId === threadIds[0]) newestReady = true;
    // With a reusable saved list, wait for changed/new rows so old mail never flashes first.
    // Gmail lists matching messages newest first; don't let a faster older request win.
    if (!failed && !reusable && newestReady) options.onProgress?.(sorted());
  };
  await Promise.all(Array.from({ length: Math.min(6, threadIds.length) }, async () => {
    try {
      while (!failed && nextIndex < threadIds.length) await loadThread(threadIds[nextIndex++]);
    } catch (error) { failed = true; throw error; }
  }));
  const items = sorted();
  if (ownerId && generation === cacheGeneration
    && (!reusable || historyId !== saved!.historyId || items.length !== saved!.items.length
      || items.some(item => previous.get(item.threadId) !== item))) {
    await writeSnapshot<RecentThreads>(key, {
      accountEmail, year, historyId, items,
      fullSyncedAt: reusable ? saved!.fullSyncedAt : Date.now()
    });
  }
  return items;
};

export const downloadGmailAttachment = async (attachment: GmailThreadAttachment): Promise<Uint8Array> => {
  let payload: { data?: string; size?: number };
  if (attachment.attachmentId) {
    payload = await fetchJson<{ data?: string; size?: number }>(
      `/messages/${encodeURIComponent(attachment.messageId)}/attachments/${encodeURIComponent(attachment.attachmentId)}`
    );
  } else {
    const message = await fetchJson<GmailMessage>(`/messages/${encodeURIComponent(attachment.messageId)}?format=full`);
    const part = collectParts(message.payload).find((candidate) => candidate.partId === attachment.partId);
    payload = part?.body || {};
  }
  if (!payload.data) throw new Error(`Gmail returned no data for ${attachment.filename}.`);
  return decodeBase64UrlBytes(payload.data);
};
