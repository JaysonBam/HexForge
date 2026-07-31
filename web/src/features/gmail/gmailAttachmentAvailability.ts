import type { LocalProjectFile } from '@hexforge/windows-helper/contracts';
import { findLinkedLocalFile } from '@/features/local-files/sourceFileLink';
import { isSupportedGmailAttachment } from '@/features/gmail/gmailParsing';
import type { GmailThreadAttachment } from '@/api/google/gmail/types';

const savedStatuses = new Set<NonNullable<GmailThreadAttachment['downloadStatus']>>(['downloaded', 'skipped', 'renamed']);

export const isGmailAttachmentSavedLocally = (
  attachment: GmailThreadAttachment,
  files: LocalProjectFile[] | null
): boolean => Boolean(
  files
  && attachment.downloadStatus
  && savedStatuses.has(attachment.downloadStatus)
  && findLinkedLocalFile(attachment.savedFilename || attachment.filename, files)
);

export const isGmailAttachmentDownloadEligible = (
  attachment: GmailThreadAttachment,
  allowPreviouslySaved = false
): boolean => isSupportedGmailAttachment(attachment.filename)
  && (allowPreviouslySaved || !attachment.downloadStatus || !savedStatuses.has(attachment.downloadStatus));
