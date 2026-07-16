import type { Project } from '../types';
import type { LocalHelperClient } from './localHelperClient';

export type StatusSyncResult = { synced: boolean; warning?: string };

export const syncCollectedProjectFolder = async (
  client: Pick<LocalHelperClient, 'resolveProject' | 'updateProjectStatus'>,
  project: Project
): Promise<StatusSyncResult> => {
  try {
    const resolution = await client.resolveProject({
      projectId: project.id,
      priorityNumber: project.priorityNumber,
      studentName: project.studentName,
      studentNumber: project.studentNumber,
      module: project.course
    });
    if (resolution.status === 'not_found') return { synced: false };
    if (resolution.status === 'ambiguous') {
      return { synced: false, warning: 'The local folder was not renamed because more than one folder matches this project.' };
    }
    await client.updateProjectStatus(resolution.projectKey, 'collected');
    return { synced: true };
  } catch (error) {
    return {
      synced: false,
      warning: error instanceof Error ? error.message : 'The local project folder could not be marked collected.'
    };
  }
};
