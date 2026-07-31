import type { Project } from '@/types';
import { sendGmailThreadReply } from '@/api/google/gmail/client';
import { getGmailThread } from '@/api/google/gmail/threads';
import {
  deleteProjectGmailThreadRecord,
  getProjectGmailMessages,
  saveProjectGmailThreadRecord,
  updateGmailAttachmentRecord
} from '@/api/supabase/gmailRecords';
import { assertProjectGmailThreadAccess } from '@/features/gmail/gmailThreadAccess';
import type { GmailReplyContent, GmailThreadAttachment, GmailThreadMessage, GmailThreadSnapshot } from '@/api/google/gmail/types';

export const cacheProjectGmailThread = async (projectId: string, thread: GmailThreadSnapshot): Promise<void> => {
  await saveProjectGmailThreadRecord(projectId, thread);
};

export const linkProjectGmailThread = cacheProjectGmailThread;

export const unlinkProjectGmailThread = async (projectId: string): Promise<void> => {
  await deleteProjectGmailThreadRecord(projectId);
};

export const loadProjectGmailMessages = async (projectId: string): Promise<GmailThreadMessage[]> => {
  return getProjectGmailMessages(projectId);
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
  await updateGmailAttachmentRecord(args);
};
