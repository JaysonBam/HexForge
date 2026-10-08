import type { ProjectResolution } from '@hexforge/windows-helper/contracts';
import { projectFolderDescriptor } from '@/features/local-files/projectFolderWorkflow';
import type { LocalHelperClient } from '@/api/windows-helper/client';
import type { Project } from '@/types';
import { downloadGmailAttachment } from '@/api/google/gmail/threads';
import { loadProjectGmailMessages, updateAttachmentDownloadStatus } from '@/features/gmail/gmailProjectService';
import { assertProjectGmailThreadAccess } from '@/features/gmail/gmailThreadAccess';
import { isGmailAttachmentDownloadEligible } from '@/features/gmail/gmailAttachmentAvailability';
import type { GmailThreadAttachment } from '@/api/google/gmail/types';

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
  const candidates = selectedAttachments ?? (await loadProjectGmailMessages(project.id)).flatMap(message => message.attachments);
  const attachments = candidates
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
  // Fetch ahead with a small bounded window. Local writes remain in original
  // order so duplicate filenames retain the helper's collision behaviour.
  const reads = new Map<number, Promise<{ bytes: Uint8Array } | { error: unknown }>>();
  const startRead = (index: number) => {
    const attachment = prepared.attachments[index];
    if (attachment && !reads.has(index)) reads.set(index, downloadGmailAttachment(attachment)
      .then(bytes => ({ bytes }), error => ({ error })));
  };
  for (let index = 0; index < Math.min(3, prepared.attachments.length); index++) startRead(index);
  const statuses: Promise<void>[] = [];
  const recordFailure = async (attachment: GmailThreadAttachment, error: unknown) => {
    result.failed += 1;
    const message = error instanceof Error ? error.message : `Could not download ${attachment.filename}.`;
    result.warnings.push(`${attachment.filename}: ${message}`);
    await updateAttachmentDownloadStatus({ projectId: project.id, attachment, status: 'failed', error: message }).catch(() => undefined);
  };
  for (let index = 0; index < prepared.attachments.length; index++) {
    const attachment = prepared.attachments[index];
    try {
      const read = await reads.get(index)!;
      reads.delete(index);
      startRead(index + 3);
      if ('error' in read) throw read.error;
      const saved = await client.saveProjectAttachment(prepared.resolution.projectKey, attachment.filename, read.bytes);
      result[saved.status] += 1;
      if (saved.status === 'renamed') result.warnings.push(`${attachment.filename} already existed with different content; saved as ${saved.filename}.`);
      statuses.push(updateAttachmentDownloadStatus({
        projectId: project.id,
        attachment,
        status: saved.status === 'saved' ? 'downloaded' : saved.status,
        savedFilename: saved.filename
      }).catch(error => recordFailure(attachment, error)));
    } catch (error) {
      statuses.push(recordFailure(attachment, error));
    }
  }
  await Promise.all(statuses);
  return result;
};
