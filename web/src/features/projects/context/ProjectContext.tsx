import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { Part, Project } from '@/types';
import {
  createProjectRecord,
  deleteProjectRecord,
  getProjects,
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
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [projectsLoadError, setProjectsLoadError] = useState<string | null>(null);
  const [pendingWrites, setPendingWrites] = useState(0);
  const [syncError, setSyncError] = useState<string | null>(null);
  const queuedProjectUpdatesRef = useRef<Map<string, QueuedProjectUpdate>>(new Map());
  const queuedPartUpdatesRef = useRef<Map<string, QueuedPartUpdate>>(new Map());

  const refreshProjects = useCallback(async () => {
    try {
      setProjectsLoadError(null);

      const result = await getProjects();
      if (result.quoteSnapshotError) {
        console.error('Failed to fetch quote snapshots:', result.quoteSnapshotError);
      }
      if (result.printRunError) {
        console.error('Failed to fetch print runs:', result.printRunError);
      }
      setProjects(result.projects);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected project load failure.';
      console.error('Failed to refresh projects:', error);
      setProjectsLoadError(message);
    } finally {
      setProjectsLoading(false);
    }
  }, []);

  const trackMutation = useCallback(async (
    label: string,
    mutation: () => PromiseLike<SupabaseMutationResult>
  ) => {
    setPendingWrites((count) => count + 1);
    setSyncError(null);

    try {
      const { error } = await mutation();
      if (error) {
        setSyncError(`${label}: ${error.message || 'Supabase rejected the change.'}`);
        await refreshProjects();
        return false;
      }
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected write failure.';
      setSyncError(`${label}: ${message}`);
      await refreshProjects();
      return false;
    } finally {
      setPendingWrites((count) => Math.max(0, count - 1));
    }
  }, [refreshProjects]);

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
    refreshProjects();
  }, [refreshProjects]);

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

  const getProject = (id: string) => projects.find(p => p.id === id);

  const generateProjectId = () => {
    let newId = '';
    do {
      newId = Math.random().toString(36).substring(2, 7).toUpperCase();
    } while (projects.some(p => p.id === newId));
    return newId;
  };

  const addProject = async (data: Partial<Project>) => {
    const newId = generateProjectId();

    const assignedPriority = data.priorityNumber ?? getNextProjectPriority(projects);

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

      await refreshProjects();
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

      await refreshProjects();
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
      setPendingWrites((count) => Math.max(0, count - 1));
    }
  };

  return (
    <ProjectContext.Provider value={{
      projects,
      projectsLoading,
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
