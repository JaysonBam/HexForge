import type { ProjectResolution } from '../../shared/localHelperProtocol';
import { projectFolderDescriptor } from '../local-files/projectFolderWorkflow';
import type { LocalHelperClient } from '../local-files/localHelperClient';
import type { Project } from '../types';
import { downloadGmailAttachment } from './gmailThreadApi';
import { loadProjectGmailMessages, updateAttachmentDownloadStatus } from './gmailProjectService';
import { assertProjectGmailThreadAccess } from './gmailThreadAccess';
import { isGmailAttachmentDownloadEligible } from './gmailAttachmentAvailability';
import type { GmailThreadAttachment } from './types';

type MatchedResolution = Extract<ProjectResolution, { status: 'matched' | 'created' }>;

export type PreparedGmailAttachmentDownload = {
  resolution: MatchedResolution;
  attachments: GmailThreadAttachment[];
};

export const prepareGmailAttachmentDownload = async (
  project: Project,
  client: LocalHelperClient,
  candidateId?: string,
  selectedAttachments?: GmailThreadAttachment[]
): Promise<PreparedGmailAttachmentDownload | { resolution: Exclude<ProjectResolution, MatchedResolution>; attachments: [] }> => {
  await assertProjectGmailThreadAccess(project);
  const descriptor = projectFolderDescriptor(project);
  let resolution = await client.resolveProject(descriptor, undefined, candidateId);
  if (resolution.status === 'not_found') resolution = await client.createProjectFolder(descriptor);
  if (resolution.status !== 'matched' && resolution.status !== 'created') return {
    resolution: resolution as Exclude<ProjectResolution, MatchedResolution>,
    attachments: []
  };
  const messages = await loadProjectGmailMessages(project.id);
  const attachments = (selectedAttachments || messages.flatMap((message) => message.attachments))
    .filter((attachment) => isGmailAttachmentDownloadEligible(attachment, Boolean(selectedAttachments)));
  return { resolution, attachments };
};

export const downloadPreparedGmailAttachments = async (
  project: Project,
  client: LocalHelperClient,
  prepared: PreparedGmailAttachmentDownload
): Promise<{ saved: number; skipped: number; renamed: number; failed: number; warnings: string[] }> => {
  await assertProjectGmailThreadAccess(project);
  const result = { saved: 0, skipped: 0, renamed: 0, failed: 0, warnings: [] as string[] };
  for (const attachment of prepared.attachments) {
    try {
      const bytes = await downloadGmailAttachment(attachment);
      const saved = await client.saveProjectAttachment(prepared.resolution.projectKey, attachment.filename, bytes);
      result[saved.status] += 1;
      if (saved.status === 'renamed') result.warnings.push(`${attachment.filename} already existed with different content; saved as ${saved.filename}.`);
      await updateAttachmentDownloadStatus({
        projectId: project.id,
        attachment,
        status: saved.status === 'saved' ? 'downloaded' : saved.status,
        savedFilename: saved.filename
      });
    } catch (error) {
      result.failed += 1;
      const message = error instanceof Error ? error.message : `Could not download ${attachment.filename}.`;
      result.warnings.push(`${attachment.filename}: ${message}`);
      await updateAttachmentDownloadStatus({
        projectId: project.id,
        attachment,
        status: 'failed',
        error: message
      }).catch(() => undefined);
    }
  }
  return result;
};
