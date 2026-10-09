import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useLocation, matchPath } from 'react-router-dom';
import type { Part, Project } from '@/types';
import {
  createProjectRecord,
  deleteProjectRecord,
  getProjects,
  getProjectById,
  getProjectSummaries,
  getActiveProjectCache,
  type ActiveProjectSnapshot,
  type ProjectSummary,
  transitionProjectRecord,
  updateProjectRecord
} from '@/api/supabase/projects';
import {
  createPartRecord,
  createPartRecords,
  deletePartRecord,
  transitionPartRecord,
  updatePartRecord
} from '@/api/supabase/parts';
import { removePartThumbnail, removeProjectPartThumbnails } from '@/api/supabase/storage';
import type { SupabaseMutationResult } from '@/api/supabase/types';
import { normalizePartVerification } from '@/domain/partVerification';
import {
  filamentSourceToOwnFilament,
  normalizeFilamentSource
} from '@/domain/filamentSource.ts';
import { withSyncedFilamentFlags } from '@/features/projects/context/filamentSync';
import {
  applyOptimisticPartTransition,
  applyOptimisticProjectTransition
} from '@/features/projects/context/optimisticTransitions';
import type { ProjectContextType } from '@/features/projects/context/types';
import { getNextProjectPriority } from '@/domain/projectPriority';
import { getAuthSession } from '@/api/supabase/auth';
import { readSnapshot, writeSnapshot } from '@/lib/persistentReads';
import { onGmailInboxChange } from '@/lib/gmailInboxEvents';

const ProjectContext = createContext<ProjectContextType | undefined>(undefined);
const EDIT_SAVE_DEBOUNCE_MS = 600;

type QueuedProjectUpdate = {
  updates: Partial<Project>;
  timerId: number;
};

type QueuedPartUpdate = {
  projectId: string;
  updates: Partial<Part>;
  timerId: number;
};

// eslint-disable-next-line react-refresh/only-export-components
export const useProjects = () => {
  const context = useContext(ProjectContext);
  if (!context) {
    throw new Error('useProjects must be used within a ProjectProvider');
  }
  return context;
};

export const ProjectProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { pathname } = useLocation();
  const routeId = matchPath('/project/:id', pathname)?.params.id;
  const projectId = routeId && routeId !== 'new' ? routeId : undefined;
  const loadKey = projectId ? `project:${projectId}` : pathname;
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectSummaries, setProjectSummaries] = useState<ProjectSummary[]>([]);
  const dashboardSummariesRef = useRef<ProjectSummary[] | null>(null);
  const loadedProjectsRef = useRef(projects);
  const [loadedKey, setLoadedKey] = useState('');
  const loadGenerationRef = useRef(0);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [projectsLoadError, setProjectsLoadError] = useState<string | null>(null);
  const [pendingWrites, setPendingWrites] = useState(0);
  const [syncError, setSyncError] = useState<string | null>(null);
  const queuedProjectUpdatesRef = useRef<Map<string, QueuedProjectUpdate>>(new Map());
  const queuedPartUpdatesRef = useRef<Map<string, QueuedPartUpdate>>(new Map());
  const activeSnapshotsRef = useRef<Record<string, ActiveProjectSnapshot> | null>(null);
  const activeCheckAtRef = useRef(0);
  const activeCheckRef = useRef<Promise<void> | null>(null);
  const activeChecksEnabledRef = useRef(false);
  const writeGenerationRef = useRef(0);
  const writesInFlightRef = useRef(0);
  const currentPathRef = useRef(pathname);
  const mountedRef = useRef(true);
  useEffect(() => { currentPathRef.current = pathname; }, [pathname]);
  useEffect(() => { loadedProjectsRef.current = projects; }, [projects]);
  useEffect(() => onGmailInboxChange(change => {
    if (change.type !== 'project' || change.threadId === undefined) return;
    // Gmail can be linked outside the project form. Recheck before reopening its cached data.
    writeGenerationRef.current++;
    activeCheckAtRef.current = 0;
    if (activeSnapshotsRef.current) delete activeSnapshotsRef.current[change.projectId];
  }), []);

  const preloadActiveProjects = useCallback((force = false): Promise<void> => {
    if (activeCheckRef.current) return activeCheckRef.current;
    if (!force && Date.now() - activeCheckAtRef.current < 5 * 60 * 1000) return Promise.resolve();
    const generation = writeGenerationRef.current;
    const check = (async () => {
      const { data } = await getAuthSession();
      const ownerId = data.session?.user.id;
      if (!ownerId) return;
      const key = `active-projects-v1:${ownerId}`;
      const saved = activeSnapshotsRef.current ?? await readSnapshot<Record<string, ActiveProjectSnapshot>>(key) ?? {};
      const verified = await getActiveProjectCache(saved);
      const openId = matchPath('/project/:id', currentPathRef.current)?.params.id;
      const removedOpenProject = openId && saved[openId] && !verified[openId]
        ? await getProjectById(openId) : null;
      if (!mountedRef.current || generation !== writeGenerationRef.current
        || writesInFlightRef.current || queuedProjectUpdatesRef.current.size || queuedPartUpdatesRef.current.size) return;
      activeSnapshotsRef.current = verified;
      activeCheckAtRef.current = Date.now();
      const active = Object.values(verified).map(entry => entry.project);
      setProjects(current => [
        ...current.filter(project => !(project.id in verified) && (!removedOpenProject || project.id !== openId)),
        ...active, ...(removedOpenProject?.projects ?? [])
      ]);
      const summaries = active.map(project => ({ ...project, parts: project.parts.map(part => ({ printStatus: part.printStatus })) }));
      dashboardSummariesRef.current = summaries;
      if (currentPathRef.current === '/') setProjectSummaries(summaries);
      await writeSnapshot(key, verified);
    })().catch(error => {
      // A failed background check leaves on-demand project reads available.
      console.warn('Active projects could not be preloaded:', error);
    });
    activeCheckRef.current = check;
    void check.finally(() => { if (activeCheckRef.current === check) activeCheckRef.current = null; });
    return check;
  }, []);

  const refreshProjects = useCallback(async (force = true) => {
    const generation = ++loadGenerationRef.current;
    const cachedDashboard = pathname === '/' ? dashboardSummariesRef.current : null;
    const cachedProject = projectId && loadedProjectsRef.current.some(project => project.id === projectId);
    setProjectsLoading(!cachedDashboard && !cachedProject);
    if (cachedProject) setLoadedKey(loadKey);
    if (cachedDashboard) {
      setProjectSummaries(cachedDashboard.map(summary =>
        loadedProjectsRef.current.find(project => project.id === summary.id) ?? summary));
      setLoadedKey(loadKey);
    }
    try {
      setProjectsLoadError(null);
      if (projectId && cachedProject && !force && activeSnapshotsRef.current?.[projectId]
        && Date.now() - activeCheckAtRef.current < 5 * 60 * 1000) return;
      if (projectId || pathname === '/projects') {
        const result = await (projectId ? getProjectById(projectId) : getProjects());
        if (generation !== loadGenerationRef.current) return;
        if (result.quoteSnapshotError) console.error('Failed to fetch quote snapshots:', result.quoteSnapshotError);
        if (result.printRunError) console.error('Failed to fetch print runs:', result.printRunError);
        setProjects(current => projectId
          ? [...current.filter(project => project.id !== projectId), ...result.projects]
          : result.projects);
        if (projectId) { activeChecksEnabledRef.current = true; void preloadActiveProjects(); }
      } else if (pathname === '/' || pathname === '/project/new') {
        const summaries = await getProjectSummaries(pathname === '/');
        if (generation !== loadGenerationRef.current) return;
        if (pathname === '/') dashboardSummariesRef.current = summaries;
        setProjectSummaries(summaries);
        if (pathname === '/') {
          activeChecksEnabledRef.current = true;
          void preloadActiveProjects();
          void import('@/pages/ProjectTimeline');
        }
      }
    } catch (error) {
      if (generation !== loadGenerationRef.current) return;
      const message = error instanceof Error ? error.message : 'Unexpected project load failure.';
      console.error('Failed to refresh projects:', error);
      setProjectsLoadError(message);
    } finally {
      if (generation === loadGenerationRef.current) {
        setLoadedKey(loadKey);
        setProjectsLoading(false);
      }
    }
  }, [projectId, pathname, loadKey, preloadActiveProjects]);
  const refreshProjectsRef = useRef(refreshProjects);
  useEffect(() => { refreshProjectsRef.current = refreshProjects; }, [refreshProjects]);

  const refreshProject = async (projectId: string) => {
    setProjectsLoadError(null);
    try {
      const result = await getProjectById(projectId);
      if (result.quoteSnapshotError) console.error('Failed to fetch quote snapshots:', result.quoteSnapshotError);
      if (result.printRunError) console.error('Failed to fetch print runs:', result.printRunError);
      const loaded = result.projects[0];
      setProjects(current => loaded
        ? [...current.filter(project => project.id !== projectId), loaded]
        : current.filter(project => project.id !== projectId));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected project load failure.';
      setProjectsLoadError(message);
    }
  };

  const trackMutation = useCallback(async (
    label: string,
    mutation: () => PromiseLike<SupabaseMutationResult>
  ) => {
    writeGenerationRef.current++;
    writesInFlightRef.current++;
    setPendingWrites((count) => count + 1);
    setSyncError(null);

    try {
      const { error } = await mutation();
      if (error) {
        setSyncError(`${label}: ${error.message || 'Supabase rejected the change.'}`);
        await refreshProjectsRef.current();
        return false;
      }
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected write failure.';
      setSyncError(`${label}: ${message}`);
      await refreshProjectsRef.current();
      return false;
    } finally {
      writesInFlightRef.current--;
      setPendingWrites((count) => Math.max(0, count - 1));
    }
  }, []);

  const flushQueuedProjectUpdate = useCallback((id: string) => {
    const queued = queuedProjectUpdatesRef.current.get(id);
    if (!queued) return Promise.resolve(true);

    window.clearTimeout(queued.timerId);
    queuedProjectUpdatesRef.current.delete(id);

    return trackMutation('Update project', () => updateProjectRecord(id, queued.updates));
  }, [trackMutation]);

  const flushQueuedPartUpdate = useCallback((partId: string) => {
    const queued = queuedPartUpdatesRef.current.get(partId);
    if (!queued) return Promise.resolve(true);

    window.clearTimeout(queued.timerId);
    queuedPartUpdatesRef.current.delete(partId);

    return trackMutation('Update part', () => updatePartRecord(partId, queued.updates));
  }, [trackMutation]);

  const queueProjectUpdate = useCallback((id: string, updates: Partial<Project>) => {
    writeGenerationRef.current++;
    const existing = queuedProjectUpdatesRef.current.get(id);
    if (existing) window.clearTimeout(existing.timerId);

    const queued: QueuedProjectUpdate = {
      updates: { ...(existing?.updates ?? {}), ...updates },
      timerId: window.setTimeout(() => {
        void flushQueuedProjectUpdate(id);
      }, EDIT_SAVE_DEBOUNCE_MS)
    };

    queuedProjectUpdatesRef.current.set(id, queued);
  }, [flushQueuedProjectUpdate]);

  const queuePartUpdate = useCallback((projectId: string, partId: string, updates: Partial<Part>) => {
    writeGenerationRef.current++;
    const existing = queuedPartUpdatesRef.current.get(partId);
    if (existing) window.clearTimeout(existing.timerId);

    const queued: QueuedPartUpdate = {
      projectId,
      updates: { ...(existing?.updates ?? {}), ...updates },
      timerId: window.setTimeout(() => {
        void flushQueuedPartUpdate(partId);
      }, EDIT_SAVE_DEBOUNCE_MS)
    };

    queuedPartUpdatesRef.current.set(partId, queued);
  }, [flushQueuedPartUpdate]);

  const flushQueuedUpdatesForProject = useCallback(async (projectId: string) => {
    const partFlushes = Array.from(queuedPartUpdatesRef.current.entries())
      .filter(([, queued]) => queued.projectId === projectId)
      .map(([partId]) => flushQueuedPartUpdate(partId));

    const results = await Promise.all([
      flushQueuedProjectUpdate(projectId),
      ...partFlushes
    ]);

    return results.every(Boolean);
  }, [flushQueuedPartUpdate, flushQueuedProjectUpdate]);

  const discardQueuedUpdatesForProject = useCallback((projectId: string) => {
    const queuedProject = queuedProjectUpdatesRef.current.get(projectId);
    if (queuedProject) {
      window.clearTimeout(queuedProject.timerId);
      queuedProjectUpdatesRef.current.delete(projectId);
    }

    Array.from(queuedPartUpdatesRef.current.entries()).forEach(([partId, queued]) => {
      if (queued.projectId !== projectId) return;
      window.clearTimeout(queued.timerId);
      queuedPartUpdatesRef.current.delete(partId);
    });
  }, []);

  const discardQueuedPartUpdate = useCallback((partId: string) => {
    const queuedPart = queuedPartUpdatesRef.current.get(partId);
    if (!queuedPart) return;
    window.clearTimeout(queuedPart.timerId);
    queuedPartUpdatesRef.current.delete(partId);
  }, []);

  useEffect(() => {
    void refreshProjects(false);
    return () => { loadGenerationRef.current += 1; };
  }, [refreshProjects]);

  useEffect(() => {
    mountedRef.current = true;
    const checkIfDue = () => {
      if (activeChecksEnabledRef.current && document.visibilityState !== 'hidden'
        && Date.now() - activeCheckAtRef.current >= 5 * 60 * 1000) void preloadActiveProjects();
    };
    const timer = window.setInterval(() => {
      if (activeChecksEnabledRef.current && document.visibilityState !== 'hidden') void preloadActiveProjects(true);
    }, 5 * 60 * 1000);
    window.addEventListener('focus', checkIfDue);
    document.addEventListener('visibilitychange', checkIfDue);
    return () => {
      mountedRef.current = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', checkIfDue);
      document.removeEventListener('visibilitychange', checkIfDue);
    };
  }, [preloadActiveProjects]);

  useEffect(() => {
    const queuedProjectUpdates = queuedProjectUpdatesRef.current;
    const queuedPartUpdates = queuedPartUpdatesRef.current;

    return () => {
      queuedProjectUpdates.forEach((queued, projectId) => {
        window.clearTimeout(queued.timerId);
        void updateProjectRecord(projectId, queued.updates)
          .then(({ error }) => {
            if (error) console.error('Failed to persist a pending project update during teardown:', error);
          });
      });
      queuedPartUpdates.forEach((queued, partId) => {
        window.clearTimeout(queued.timerId);
        void updatePartRecord(partId, queued.updates)
          .then(({ error }) => {
            if (error) console.error('Failed to persist a pending part update during teardown:', error);
          });
      });
      queuedProjectUpdates.clear();
      queuedPartUpdates.clear();
    };
  }, []);

  // A verified working project is already usable on the first route render.
  // Waiting for the route-loading effect would mount a skeleton and then the editor.
  const readyWorkingProject = Boolean(projectId && activeSnapshotsRef.current?.[projectId]
    && Date.now() - activeCheckAtRef.current < 5 * 60 * 1000
    && projects.some(project => project.id === projectId));
  const getProject = (id: string) => loadedKey === loadKey || (readyWorkingProject && id === projectId)
    ? projects.find(project => project.id === id) : undefined;

  const generateProjectId = () => {
    let newId = '';
    do {
      newId = Math.random().toString(36).substring(2, 7).toUpperCase();
    } while (projects.some(p => p.id === newId));
    return newId;
  };

  const addProject = async (data: Partial<Project>) => {
    const newId = generateProjectId();

    const assignedPriority = data.priorityNumber ?? getNextProjectPriority(projectSummaries);

    const newProject: Project = {
      id: newId,
      studentName: data.studentName || '',
      studentNumber: data.studentNumber || '',
      email: data.email || '',
      course: data.course || '',
      lecturer: data.lecturer || '',
      needsPayment: data.needsPayment ?? true,
      moduleOrLecturerPays: data.moduleOrLecturerPays ?? false,
      defaultFilamentSource: normalizeFilamentSource(data.defaultFilamentSource),
      receiptNumber: data.receiptNumber,
      paymentNote: data.paymentNote,
      paymentOverrideNote: data.paymentOverrideNote,
      printLabel: data.printLabel,
      state: data.state || 'INTAKE',
      parts: [],
      createdAt: new Date().toISOString(),
      archived: false,
      ...data,
      priorityNumber: assignedPriority
    };

    setProjects(prev => [...prev, newProject]);

    const { parts: _parts, quoteSnapshot: _quoteSnapshot, ...projectData } = newProject;
    void _parts;
    void _quoteSnapshot;
    const saved = await trackMutation('Create project', () => createProjectRecord(projectData));
    if (!saved) {
      setProjects(prev => prev.filter(project => project.id !== newId));
      return null;
    }
    return newId;
  };

  const updateProject = (id: string, data: Partial<Project>) => {
    const updateData = { ...data };

    if ('state' in updateData) {
      delete updateData.state;
      console.warn('Direct project.state updates are blocked. Use transitionProjectState().');
    }

    if (updateData.moduleOrLecturerPays) {
      updateData.needsPayment = false;
    }

    if ('defaultFilamentSource' in updateData) {
      updateData.defaultFilamentSource = normalizeFilamentSource(updateData.defaultFilamentSource);
    }

    setProjects(prev => prev.map(p => p.id === id ? { ...p, ...updateData } : p));
    queueProjectUpdate(id, updateData);
  };

  const deleteProject = async (id: string) => {
    const project = getProject(id);
    if (!project) {
      return false;
    }

    discardQueuedUpdatesForProject(id);

    try {
      await removeProjectPartThumbnails(project.parts);
    } catch (error) {
      console.error('Failed to remove project thumbnails:', error);
    }

    setProjects(prev => prev.filter(p => p.id !== id));
    if (dashboardSummariesRef.current) dashboardSummariesRef.current = dashboardSummariesRef.current.filter(project => project.id !== id);
    return trackMutation('Delete project', () => deleteProjectRecord(id));
  };

  const addPart = (projectId: string) => {
    const partId = crypto.randomUUID();
    const project = getProject(projectId);
    if (!project) return;
    const defaultFilamentSource = normalizeFilamentSource(project.defaultFilamentSource);

    const newPart: Part = {
      id: partId,
      partNumber: project.parts.length + 1,
      partName: `Part ${project.parts.length + 1}`,
      primaryMaterial: '',
      primaryBrand: '',
      expanded: true,
      specialInstruction: '',
      primaryFilamentSource: defaultFilamentSource,
      primaryOwnFilament: filamentSourceToOwnFilament(defaultFilamentSource),
      primaryEstimatedWeight: 0,
      primaryMaterialCost: 0,
      primaryServiceCost: 0,
      printStatus: 'DRAFT'
    };

    setProjects(prev => prev.map(p => {
      if (p.id !== projectId) return p;
      return { ...p, parts: [...p.parts, newPart] };
    }));

    void trackMutation('Add part', () => createPartRecord(projectId, newPart));
  };

  const updatePart = (projectId: string, partId: string, data: Partial<Part>) => {
    const updateData = withSyncedFilamentFlags(data);

    if ('printStatus' in updateData) {
      delete updateData.printStatus;
      console.warn('Direct part.printStatus updates are blocked. Use transitionPartStatus().');
    }

    setProjects(prev => prev.map(p => {
      if (p.id !== projectId) return p;
      return {
        ...p,
        parts: p.parts.map(part => part.id === partId ? { ...part, ...updateData } : part)
      };
    }));

    queuePartUpdate(projectId, partId, updateData);
  };

  const deletePart = (projectId: string, partId: string) => {
    discardQueuedPartUpdate(partId);

    (async () => {
      try {
        const project = getProject(projectId);
        if (!project) return;
        const part = project.parts.find(p => p.id === partId);
        if (!part) return;

        if (part.imageUrl) await removePartThumbnail(part.imageUrl);
      } catch (e) {
        console.error('Failed to remove part thumbnail:', e);
      }
    })();

    setProjects(prev => prev.map(p => {
      if (p.id !== projectId) return p;
      return { ...p, parts: p.parts.filter(part => part.id !== partId) };
    }));

    void trackMutation('Delete part', () => deletePartRecord(partId));
  };

  const addExtractedParts = async (projectId: string, extractedParts: Partial<Part>[]) => {
    const project = getProject(projectId);
    if (!project) return false;

    const newParts: Part[] = extractedParts.map((ep, index) => normalizePartVerification({
      ...withSyncedFilamentFlags({
        primaryFilamentSource: ep.primaryFilamentSource ?? project.defaultFilamentSource,
        primaryOwnFilament: ep.primaryOwnFilament,
        secondaryFilamentSource: ep.secondaryFilamentSource ?? (ep.secondaryMaterial ? project.defaultFilamentSource : undefined),
        secondaryOwnFilament: ep.secondaryOwnFilament
      }),
      id: crypto.randomUUID(),
      partNumber: project.parts.length + index + 1,
      partName: ep.partName || `Part ${project.parts.length + index + 1}`,
      primaryMaterial: ep.primaryMaterial || '',
      primaryBrand: ep.primaryBrand || '',
      expanded: true,
      specialInstruction: ep.specialInstruction || '',

      secondaryMaterial: ep.secondaryMaterial,
      secondaryBrand: ep.secondaryBrand,
      secondaryEstimatedWeight: ep.secondaryEstimatedWeight,
      secondaryWeight: ep.secondaryWeight,
      secondaryMaterialCost: ep.secondaryMaterialCost,
      secondaryServiceCost: ep.secondaryServiceCost,
      secondaryLength: ep.secondaryLength,
      imageUrl: ep.imageUrl,
      primaryEstimatedWeight: ep.primaryEstimatedWeight || 0,
      primaryWeight: ep.primaryWeight,
      primaryLength: ep.primaryLength,
      printingTime: ep.printingTime,
      sourceFilePath: ep.sourceFilePath,
      primaryMaterialCost: ep.primaryMaterialCost || 0,
      primaryServiceCost: ep.primaryServiceCost || 0,
      printStatus: ep.printStatus || 'DRAFT',
      checkedBy: ep.checkedBy
    } as Part));

    setProjects(prev => prev.map(p => {
      if (p.id !== projectId) return p;
      return { ...p, parts: [...p.parts, ...newParts] };
    }));

    if (newParts.length) {
      const insertedParts = newParts.map(np => ({ ...np, projectId }));
      return trackMutation('Add extracted parts', () => createPartRecords(insertedParts));
    }
    return true;
  };

  const transitionProjectState: ProjectContextType['transitionProjectState'] = async ({
    projectId,
    action,
    technicianName,
    reason,
    overrideNote,
    printLabel
  }) => {
    const queuedSavesOk = await flushQueuedUpdatesForProject(projectId);
    if (!queuedSavesOk) {
      return { ok: false, errors: ['Pending project edits could not be saved. Please try again.'] };
    }

    const previousProjects = projects;
    writeGenerationRef.current++;
    writesInFlightRef.current++;
    const optimisticProjects = applyOptimisticProjectTransition(previousProjects, { projectId, action, printLabel });
    if (optimisticProjects !== previousProjects) {
      setProjects(optimisticProjects);
    }

    setPendingWrites((count) => count + 1);
    setSyncError(null);

    try {
      const { data, error } = await transitionProjectRecord({
        projectId,
        action,
        technicianName,
        reason,
        overrideNote,
        printLabel
      });

      if (error) {
        console.error('Project transition RPC failed:', error);
        setSyncError(`Project transition: ${error.message}`);
        setProjects(previousProjects);
        return { ok: false, errors: [error.message] };
      }

      const payload = Array.isArray(data) ? data[0] : data;
      if (!payload?.ok) {
        setProjects(previousProjects);
        return {
          ok: false,
          errors: Array.isArray(payload?.errors) ? payload.errors : ['Transition rejected.'],
          warnings: Array.isArray(payload?.warnings) ? payload.warnings : []
        };
      }

      await refreshProject(projectId);
      return {
        ok: true,
        errors: [],
        warnings: Array.isArray(payload?.warnings) ? payload.warnings : []
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected transition failure.';
      setSyncError(`Project transition: ${message}`);
      setProjects(previousProjects);
      return { ok: false, errors: [message] };
    } finally {
      writesInFlightRef.current--;
      setPendingWrites((count) => Math.max(0, count - 1));
    }
  };

  const transitionPartStatus: ProjectContextType['transitionPartStatus'] = async ({
    projectId,
    partId,
    action,
    technicianName,
    machineName,
    reason
  }) => {
    const queuedProjectSavesOk = await flushQueuedProjectUpdate(projectId);
    const queuedPartSaveOk = await flushQueuedPartUpdate(partId);
    if (!queuedProjectSavesOk || !queuedPartSaveOk) {
      return { ok: false, errors: ['Pending part edits could not be saved. Please try again.'] };
    }

    const previousProjects = projects;
    writeGenerationRef.current++;
    writesInFlightRef.current++;
    const optimisticProjects = applyOptimisticPartTransition(previousProjects, {
      projectId,
      partId,
      action,
      technicianName,
      machineName,
      reason
    });
    if (optimisticProjects !== previousProjects) {
      setProjects(optimisticProjects);
    }

    setPendingWrites((count) => count + 1);
    setSyncError(null);

    try {
      const { data, error } = await transitionPartRecord({
        projectId,
        partId,
        action,
        technicianName,
        machineName,
        reason
      });

      if (error) {
        console.error('Part transition RPC failed:', error);
        setSyncError(`Part transition: ${error.message}`);
        setProjects(previousProjects);
        return { ok: false, errors: [error.message] };
      }

      const payload = Array.isArray(data) ? data[0] : data;
      if (!payload?.ok) {
        setProjects(previousProjects);
        return {
          ok: false,
          errors: Array.isArray(payload?.errors) ? payload.errors : ['Transition rejected.'],
          warnings: Array.isArray(payload?.warnings) ? payload.warnings : []
        };
      }

      await refreshProject(projectId);
      return {
        ok: true,
        errors: [],
        warnings: Array.isArray(payload?.warnings) ? payload.warnings : []
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected transition failure.';
      setSyncError(`Part transition: ${message}`);
      setProjects(previousProjects);
      return { ok: false, errors: [message] };
    } finally {
      writesInFlightRef.current--;
      setPendingWrites((count) => Math.max(0, count - 1));
    }
  };

  return (
    <ProjectContext.Provider value={{
      projects,
      projectSummaries,
      projectsLoading: !readyWorkingProject && (projectsLoading || loadedKey !== loadKey),
      projectsLoadError,
      syncStatus: { saving: pendingWrites > 0, error: syncError },
      clearSyncError: () => setSyncError(null),
      getProject,
      refreshProjects,
      addProject,
      updateProject,
      deleteProject,
      addPart,
      updatePart,
      deletePart,
      addExtractedParts,
      transitionProjectState,
      transitionPartStatus
    }}>
      {children}
    </ProjectContext.Provider>
  );
};
