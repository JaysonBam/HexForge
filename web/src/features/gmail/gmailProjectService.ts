import { supabase } from '../lib/supabaseClient';
import type { Project } from '../types';
import { sendGmailThreadReply } from '../utils/gmailDraftUtils';
import { getGmailThread } from './gmailThreadApi';
import { assertProjectGmailThreadAccess } from './gmailThreadAccess';
import { stripQuotedReplyContent } from './gmailBody';
import type { GmailReplyContent, GmailThreadAttachment, GmailThreadMessage, GmailThreadSnapshot } from './types';

const messageRow = (projectId: string, message: GmailThreadMessage) => ({
  project_id: projectId,
  gmail_message_id: message.id,
  gmail_thread_id: message.threadId,
  sender_name: message.senderName,
  sender_email: message.senderEmail,
  recipient_emails: message.recipientEmails,
  subject: message.subject,
  // Keep the cache clean even if a caller supplied a snapshot not created by gmailThreadApi.
  body_text: stripQuotedReplyContent(message.body),
  message_date: message.messageDate,
  direction: message.direction,
  has_attachments: message.hasAttachments,
  message_id_header: message.messageIdHeader,
  references_header: message.referencesHeader
});

const attachmentRow = (projectId: string, attachment: GmailThreadAttachment) => ({
  project_id: projectId,
  gmail_message_id: attachment.messageId,
  gmail_attachment_id: attachment.attachmentId,
  mime_part_id: attachment.partId,
  filename: attachment.filename,
  mime_type: attachment.mimeType,
  size_bytes: attachment.size,
  download_status: 'pending'
});

export const cacheProjectGmailThread = async (projectId: string, thread: GmailThreadSnapshot): Promise<void> => {
  const { error: projectError } = await supabase.from('projects').update({
    gmailThreadId: thread.id,
    gmailAccountEmail: thread.accountEmail,
    gmailThreadSubject: thread.subject,
    gmailMainContactEmail: thread.mainContactEmail,
    gmailLastSyncedAt: thread.syncedAt
  }).eq('id', projectId);
  if (projectError) throw new Error(projectError.message || 'The Main Gmail Thread could not be saved.');

  if (thread.messages.length) {
    const { error: messageError } = await supabase.from('project_gmail_messages')
      .upsert(thread.messages.map((message) => messageRow(projectId, message)), {
        onConflict: 'project_id,gmail_message_id'
      });
    if (messageError) throw new Error(messageError.message || 'Gmail messages could not be cached.');
  }

  const attachments = thread.messages.flatMap((message) => message.attachments);
  if (attachments.length) {
    const { error: attachmentError } = await supabase.from('project_gmail_attachments')
      .upsert(attachments.map((attachment) => attachmentRow(projectId, attachment)), {
        onConflict: 'project_id,gmail_message_id,mime_part_id',
        ignoreDuplicates: true
      });
    if (attachmentError) throw new Error(attachmentError.message || 'Gmail attachment details could not be cached.');
  }
};

export const linkProjectGmailThread = cacheProjectGmailThread;

export const unlinkProjectGmailThread = async (projectId: string): Promise<void> => {
  const { error: attachmentError } = await supabase.from('project_gmail_attachments').delete().eq('project_id', projectId);
  if (attachmentError) throw new Error(attachmentError.message);
  const { error: messageError } = await supabase.from('project_gmail_messages').delete().eq('project_id', projectId);
  if (messageError) throw new Error(messageError.message);
  const { error: projectError } = await supabase.from('projects').update({
    gmailThreadId: null,
    gmailAccountEmail: null,
    gmailThreadSubject: null,
    gmailMainContactEmail: null,
    gmailLastSyncedAt: null
  }).eq('id', projectId);
  if (projectError) throw new Error(projectError.message);
};

export const loadProjectGmailMessages = async (projectId: string): Promise<GmailThreadMessage[]> => {
  const [{ data: messageRows, error: messageError }, { data: attachmentRows, error: attachmentError }] = await Promise.all([
    supabase.from('project_gmail_messages').select('*').eq('project_id', projectId).order('message_date', { ascending: true }),
    supabase.from('project_gmail_attachments').select('*').eq('project_id', projectId)
  ]);
  if (messageError) throw new Error(messageError.message || 'Cached Gmail messages could not be loaded.');
  if (attachmentError) throw new Error(attachmentError.message || 'Gmail attachment details could not be loaded.');
  const attachmentsByMessage = new Map<string, GmailThreadAttachment[]>();
  (attachmentRows || []).forEach((row) => {
    const messageId = String(row.gmail_message_id || '');
    const attachments = attachmentsByMessage.get(messageId) || [];
    attachments.push({
      messageId,
      attachmentId: row.gmail_attachment_id || null,
      partId: row.mime_part_id || '',
      filename: row.filename || '',
      mimeType: row.mime_type || 'application/octet-stream',
      size: Number(row.size_bytes || 0),
      downloadStatus: row.download_status || 'pending',
      savedFilename: row.saved_filename || null,
      downloadError: row.download_error || null
    });
    attachmentsByMessage.set(messageId, attachments);
  });
  return (messageRows || []).map((row) => ({
    id: row.gmail_message_id,
    threadId: row.gmail_thread_id,
    senderName: row.sender_name || '',
    senderEmail: row.sender_email || '',
    recipientEmails: Array.isArray(row.recipient_emails) ? row.recipient_emails : [],
    subject: row.subject || '(no subject)',
    body: row.body_text || '',
    messageDate: row.message_date,
    direction: row.direction === 'outgoing' ? 'outgoing' : 'incoming',
    hasAttachments: Boolean(row.has_attachments),
    messageIdHeader: row.message_id_header || '',
    referencesHeader: row.references_header || '',
    attachments: attachmentsByMessage.get(row.gmail_message_id) || []
  }));
};

export const syncProjectGmailThread = async (project: Project): Promise<GmailThreadSnapshot> => {
  if (!project.gmailThreadId) throw new Error('This project does not have a Main Gmail Thread.');
  await assertProjectGmailThreadAccess(project);
  const snapshot = await getGmailThread(project.gmailThreadId, project.gmailAccountEmail || undefined);
  await cacheProjectGmailThread(project.id, snapshot);
  return snapshot;
};

export const sendProjectGmailReply = async (
  project: Project,
  content: GmailReplyContent
): Promise<GmailThreadSnapshot> => {
  const latestThread = await syncProjectGmailThread(project);
  const latestMessage = latestThread.messages.at(-1);
  if (!latestMessage?.messageIdHeader) throw new Error('The latest Gmail message has no Message-ID header, so a safe threaded reply cannot be sent.');
  const recipient = latestThread.mainContactEmail || project.gmailMainContactEmail || project.email;
  if (!recipient?.trim()) throw new Error('The Main Gmail Thread has no external contact email address.');
  const referenceParts = `${latestMessage.referencesHeader} ${latestMessage.messageIdHeader}`
    .split(/\s+/)
    .map((value) => value.trim())
    .filter(Boolean);
  const references = [...new Set(referenceParts)].join(' ');
  await sendGmailThreadReply({
    threadId: latestThread.id,
    to: recipient,
    subject: project.gmailThreadSubject || latestThread.subject,
    body: content.body,
    htmlBody: content.htmlBody,
    attachments: content.attachments,
    inReplyTo: latestMessage.messageIdHeader,
    references
  });
  const refreshed = await getGmailThread(latestThread.id, latestThread.accountEmail);
  await cacheProjectGmailThread(project.id, refreshed);
  window.dispatchEvent(new CustomEvent('hexforge:gmail-synced', { detail: { projectId: project.id } }));
  return refreshed;
};

export const updateAttachmentDownloadStatus = async (args: {
  projectId: string;
  attachment: GmailThreadAttachment;
  status: NonNullable<GmailThreadAttachment['downloadStatus']>;
  savedFilename?: string | null;
  error?: string | null;
}): Promise<void> => {
  const { error } = await supabase.from('project_gmail_attachments').update({
    download_status: args.status,
    saved_filename: args.savedFilename ?? null,
    download_error: args.error ?? null,
    downloaded_at: ['downloaded', 'skipped', 'renamed'].includes(args.status) ? new Date().toISOString() : null
  }).eq('project_id', args.projectId)
    .eq('gmail_message_id', args.attachment.messageId)
    .eq('mime_part_id', args.attachment.partId);
  if (error) throw new Error(error.message);
};
