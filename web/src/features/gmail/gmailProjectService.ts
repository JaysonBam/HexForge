import type { Project } from '@/types';
import { sendGmailThreadReply } from '@/api/google/gmail/client';
import { getGmailThread, invalidateRecentGmailThreads } from '@/api/google/gmail/threads';
import { getAuthSession } from '@/api/supabase/auth';
import { ReadCache } from '@/lib/readCache';
import {
  deleteProjectGmailThreadRecord,
  getProjectGmailMessages,
  saveProjectGmailThreadRecord,
  updateGmailAttachmentRecord
} from '@/api/supabase/gmailRecords';
import { assertProjectGmailThreadAccess } from '@/features/gmail/gmailThreadAccess';
import type { GmailReplyContent, GmailThreadAttachment, GmailThreadMessage, GmailThreadSnapshot } from '@/api/google/gmail/types';

const correspondence = new ReadCache<GmailThreadMessage[]>();

export const cacheProjectGmailThread = async (projectId: string, thread: GmailThreadSnapshot): Promise<void> => {
  try { await saveProjectGmailThreadRecord(projectId, thread); }
  finally { correspondence.clear(); }
};

export const linkProjectGmailThread = cacheProjectGmailThread;

export const unlinkProjectGmailThread = async (projectId: string): Promise<void> => {
  try { await deleteProjectGmailThreadRecord(projectId); }
  finally { correspondence.clear(); }
};

export const loadProjectGmailMessages = async (projectId: string): Promise<GmailThreadMessage[]> => {
  const { data } = await getAuthSession();
  const ownerId = data.session?.user.id;
  return ownerId ? correspondence.read(`${ownerId}:${projectId}`, () => getProjectGmailMessages(projectId)) : getProjectGmailMessages(projectId);
};

export const syncProjectGmailThread = async (project: Project, options: {
  onThread?: (thread: GmailThreadSnapshot) => void;
} = {}): Promise<GmailThreadSnapshot> => {
  if (!project.gmailThreadId) throw new Error('This project does not have a Main Gmail Thread.');
  await assertProjectGmailThreadAccess(project);
  const snapshot = await getGmailThread(project.gmailThreadId, project.gmailAccountEmail || undefined);
  options.onThread?.(snapshot);
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
  invalidateRecentGmailThreads();
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
  try { await updateGmailAttachmentRecord(args); }
  finally { correspondence.clear(); }
};
