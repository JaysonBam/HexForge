import type { LocalProjectFile } from '../../shared/localHelperProtocol';
import { findLinkedLocalFile } from '../local-files/sourceFileLink';
import { isSupportedGmailAttachment } from './gmailParsing';
import type { GmailThreadAttachment } from './types';

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
