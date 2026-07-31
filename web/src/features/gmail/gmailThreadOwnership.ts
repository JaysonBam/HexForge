import type { Project } from '../types';

export const GMAIL_THREAD_ACCOUNT_MISMATCH = 'This thread is not linked to your Gmail account.';

const normalizeEmail = (email?: string | null) => email?.trim().toLowerCase() || '';

export const canUseProjectGmailThread = (
  project: Pick<Project, 'gmailThreadId' | 'gmailAccountEmail'>,
  accountEmail?: string | null
) => !project.gmailThreadId || (
  Boolean(normalizeEmail(project.gmailAccountEmail))
  && normalizeEmail(project.gmailAccountEmail) === normalizeEmail(accountEmail)
);
