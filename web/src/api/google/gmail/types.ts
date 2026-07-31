import type { GmailAttachment } from '../utils/gmailDraftUtils';

export type GmailThreadAttachment = {
  messageId: string;
  attachmentId: string | null;
  partId: string;
  filename: string;
  mimeType: string;
  size: number;
  downloadStatus?: 'pending' | 'downloaded' | 'skipped' | 'renamed' | 'failed';
  savedFilename?: string | null;
  downloadError?: string | null;
};

export type GmailThreadMessage = {
  id: string;
  threadId: string;
  senderName: string;
  senderEmail: string;
  recipientEmails: string[];
  subject: string;
  body: string;
  messageDate: string;
  direction: 'incoming' | 'outgoing';
  hasAttachments: boolean;
  messageIdHeader: string;
  referencesHeader: string;
  attachments: GmailThreadAttachment[];
};

export type GmailThreadSnapshot = {
  id: string;
  accountEmail: string;
  subject: string;
  mainContactEmail: string;
  messages: GmailThreadMessage[];
  syncedAt: string;
};

export type GmailThreadListItem = {
  threadId: string;
  messageId: string;
  senderName: string;
  senderEmail: string;
  subject: string;
  messageDate: string;
  preview: string;
  attachmentFilenames: string[];
  snapshot: GmailThreadSnapshot;
};

export type GmailProjectSuggestions = {
  studentNumber: string;
  studentNumberCandidates: string[];
  studentName: string;
  email: string;
  moduleCode: string;
};

export type ProjectGmailMessageRecord = GmailThreadMessage & {
  projectId: string;
};

export type GmailReplyContent = {
  subject: string;
  body: string;
  htmlBody?: string;
  attachments?: GmailAttachment[];
};
