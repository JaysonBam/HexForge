import { gmailApiFetch } from '../utils/gmailDraftUtils';
import { stripQuotedReplyContent } from './gmailBody';
import type { GmailThreadAttachment, GmailThreadListItem, GmailThreadMessage, GmailThreadSnapshot } from './types';
import { buildRecentPrintEmailQuery, getGmailMessageDirection, isSupportedGmailAttachment } from './gmailParsing';

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

const decodeBase64Url = (value: string): string => {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  return new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
};

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

const fetchJson = async <T>(path: string): Promise<T> => {
  const response = await gmailApiFetch(path);
  if (!response.ok) throw new Error(`Gmail API returned ${response.status}: ${await response.text()}`);
  return response.json() as Promise<T>;
};

export const getGmailAccountEmail = async (): Promise<string> => {
  const profile = await fetchJson<{ emailAddress?: string }>('/profile');
  return profile.emailAddress?.trim().toLowerCase() || '';
};

export const getGmailThread = async (threadId: string, knownAccountEmail?: string): Promise<GmailThreadSnapshot> => {
  const [payload, accountEmail] = await Promise.all([
    fetchJson<GmailThreadResponse>(`/threads/${encodeURIComponent(threadId)}?format=full`),
    knownAccountEmail ? Promise.resolve(knownAccountEmail) : getGmailAccountEmail()
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
    subject: messages.at(-1)?.subject || messages[0]?.subject || '(no subject)',
    mainContactEmail: externalSender?.senderEmail || externalRecipient || '',
    messages,
    syncedAt: new Date().toISOString()
  };
};

export const listRecent3dPrintThreads = async (): Promise<GmailThreadListItem[]> => {
  const groupedTerms = PRINT_TERMS.map((term) => /\s/.test(term) ? `"${term}"` : term).join(' ');
  const query = `${buildRecentPrintEmailQuery('3d').replace(/\s+3d$/, '')} {${groupedTerms}}`;
  const result = await fetchJson<{ messages?: Array<{ id?: string; threadId?: string }> }>(
    `/messages?maxResults=50&q=${encodeURIComponent(query)}`
  );
  const threadIds = [...new Set((result.messages || []).map((message) => message.threadId).filter((id): id is string => Boolean(id)))].slice(0, 10);
  const accountEmail = await getGmailAccountEmail();
  const snapshots = await Promise.all(threadIds.map((threadId) => getGmailThread(threadId, accountEmail)));
  return snapshots.map((snapshot) => {
    const latest = snapshot.messages.at(-1);
    const representative = [...snapshot.messages].reverse().find((message) => message.direction === 'incoming') || latest;
    return {
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
    };
  }).sort((left, right) => right.messageDate.localeCompare(left.messageDate));
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
  const normalized = payload.data.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};
