import type { LocalProjectFile } from '../../shared/localHelperProtocol';
import type { Project } from '../types';
import type { LocalHelperClient } from './localHelperClient';
import { projectFolderDescriptor } from './projectFolderWorkflow';

type CachedProjectFiles = {
  files: LocalProjectFile[];
  pending: Promise<LocalProjectFile[]> | null;
};

const cache = new Map<string, CachedProjectFiles>();

const cacheKey = (project: Project, client: LocalHelperClient): string => {
  const descriptor = projectFolderDescriptor(project);
  return `${client.baseUrl}:${JSON.stringify(descriptor)}`;
};

export const getAvailableProjectFiles = async (
  project: Project,
  client: LocalHelperClient,
  forceRefresh = false
): Promise<LocalProjectFile[]> => {
  const key = cacheKey(project, client);
  const existing = cache.get(key);
  if (existing?.pending) return existing.pending;
  if (existing && !forceRefresh) return existing.files;

  const pending = (async () => {
    const resolution = await client.resolveProject(projectFolderDescriptor(project));
    if (resolution.status !== 'matched' && resolution.status !== 'created') return [];
    return (await client.listProjectFiles(resolution.projectKey)).files;
  })();
  cache.set(key, { files: existing?.files ?? [], pending });

  try {
    const files = await pending;
    cache.set(key, { files, pending: null });
    return files;
  } catch (error) {
    cache.delete(key);
    throw error;
  }
};
