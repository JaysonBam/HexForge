import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { Part, PrintRun, Project, QuoteSnapshot } from '../types';
import { supabase } from '../lib/supabaseClient';
import { normalizePartVerification } from '../domain/partVerification';
import {
  filamentSourceToOwnFilament,
  normalizeFilamentSource
} from '../domain/filamentSource.ts';
import { withSyncedFilamentFlags } from './project/filamentSync';
import {
  applyOptimisticPartTransition,
  applyOptimisticProjectTransition
} from './project/optimisticTransitions';
import { getStoragePathFromImageUrl, removeProjectPartThumbnails } from './project/storage';
import type {
  PrintRunRow,
  ProjectContextType,
  QuoteSnapshotRow,
  SupabaseMutationResult
} from './project/types';

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
  const [activeFilter, setActiveFilter] = useState<string>('All');
  const [pendingWrites, setPendingWrites] = useState(0);
  const [syncError, setSyncError] = useState<string | null>(null);
  const queuedProjectUpdatesRef = useRef<Map<string, QueuedProjectUpdate>>(new Map());
  const queuedPartUpdatesRef = useRef<Map<string, QueuedPartUpdate>>(new Map());

  const refreshProjects = useCallback(async () => {
    try {
      setProjectsLoadError(null);

      const { data: dbProjects, error: projectError } = await supabase.from('projects').select('*');
      if (projectError || !dbProjects) {
        console.error('Failed to fetch projects:', projectError);
        setProjectsLoadError(projectError?.message || 'Failed to fetch projects.');
        return;
      }

      const { data: dbParts, error: partError } = await supabase.from('parts').select('*');
      if (partError || !dbParts) {
        console.error('Failed to fetch parts:', partError);
        setProjectsLoadError(partError?.message || 'Failed to fetch project parts.');
        return;
      }

      const { data: dbSnapshots, error: snapshotError } = await supabase
        .from('project_cost_snapshots')
        .select('project_id,snapshot_version,status,currency,total_cost,generated_at,line_summary')
        .order('snapshot_version', { ascending: true });

      if (snapshotError) {
        console.error('Failed to fetch quote snapshots:', snapshotError);
      }

      const { data: dbPrintRuns, error: printRunError } = await supabase
        .from('print_runs')
        .select('id,part_id,project_id,machine_id,machine_name,started_by,ended_by,started_at,finished_at,failed_at,failure_reason,outcome')
        .order('started_at', { ascending: false });

      if (printRunError) {
        console.error('Failed to fetch print runs:', printRunError);
      }

      const snapshotByProject = new Map<string, QuoteSnapshot>();
      const snapshotsByProject = new Map<string, QuoteSnapshot[]>();
      if (dbSnapshots) {
        (dbSnapshots as QuoteSnapshotRow[]).forEach((snapshotRow) => {
          const projectId = (snapshotRow?.project_id || '').toString();
          if (!projectId) return;

          const snapshot = {
            snapshot_version: Number(snapshotRow?.snapshot_version || 0),
            status: snapshotRow?.status || 'ISSUED',
            currency: snapshotRow?.currency || 'ZAR',
            total_cost: Number(snapshotRow?.total_cost || 0),
            generated_at: snapshotRow?.generated_at || '',
            line_summary: Array.isArray(snapshotRow?.line_summary)
              ? snapshotRow.line_summary as QuoteSnapshot['line_summary']
              : []
          } as QuoteSnapshot;

          const projectSnapshots = snapshotsByProject.get(projectId) ?? [];
          projectSnapshots.push(snapshot);
          snapshotsByProject.set(projectId, projectSnapshots);

          if (snapshot.status === 'ISSUED') {
            const existing = snapshotByProject.get(projectId);
            const existingVersion = existing?.snapshot_version ?? -1;

            if (snapshot.snapshot_version >= existingVersion) {
              snapshotByProject.set(projectId, snapshot);
            }
          }
        });
      }

      const printRunsByPart = new Map<string, PrintRun[]>();
      if (dbPrintRuns) {
        (dbPrintRuns as PrintRunRow[]).forEach((run) => {
          const partId = (run?.part_id || '').toString();
          if (!partId) return;

          const runs = printRunsByPart.get(partId) ?? [];
          runs.push({
            id: Number(run.id),
            part_id: run.part_id,
            project_id: run.project_id,
            machine_id: run.machine_id,
            machine_name: run.machine_name,
            started_by: run.started_by,
            ended_by: run.ended_by,
            started_at: run.started_at,
            finished_at: run.finished_at,
            failed_at: run.failed_at,
            failure_reason: run.failure_reason,
            outcome: run.outcome
          });
          printRunsByPart.set(partId, runs);
        });
      }

      const fullProjects = dbProjects.map(p => ({
        ...p,
        email: typeof p.email === 'string' ? p.email : '',
        parts: dbParts
          .filter(part => part.projectId === p.id)
          .sort((a, b) => Number(a.partNumber || 0) - Number(b.partNumber || 0))
          .map(part => normalizePartVerification({
            ...part,
            printRuns: printRunsByPart.get(part.id) ?? []
          })),
        quoteSnapshot: snapshotByProject.get(p.id),
        quoteSnapshots: snapshotsByProject.get(p.id) ?? []
      })) as Project[];

      setProjects(fullProjects);
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

    return trackMutation('Update project', () => supabase.from('projects').update(queued.updates).eq('id', id));
  }, [trackMutation]);

  const flushQueuedPartUpdate = useCallback((partId: string) => {
    const queued = queuedPartUpdatesRef.current.get(partId);
    if (!queued) return Promise.resolve(true);

    window.clearTimeout(queued.timerId);
    queuedPartUpdatesRef.current.delete(partId);

    return trackMutation('Update part', () => supabase.from('parts').update(queued.updates).eq('id', partId));
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
        void supabase.from('projects').update(queued.updates).eq('id', projectId)
          .then(({ error }) => {
            if (error) console.error('Failed to persist a pending project update during teardown:', error);
          });
      });
      queuedPartUpdates.forEach((queued, partId) => {
        window.clearTimeout(queued.timerId);
        void supabase.from('parts').update(queued.updates).eq('id', partId)
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

    const maxPriority = projects.reduce((max, p) => Math.max(max, p.priorityNumber), 0);
    const assignedPriority = data.priorityNumber ?? (maxPriority + 1);

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
    const saved = await trackMutation('Create project', () => supabase.from('projects').insert([projectData]));
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
    return trackMutation('Delete project', () => supabase.from('projects').delete().eq('id', id));
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

    void trackMutation('Add part', () => supabase.from('parts').insert([{ ...newPart, projectId }]));
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

        if (part.imageUrl) {
          const { data: sessionData } = await supabase.auth.getSession();
          const session = sessionData.session;
          if (!session) {
            console.warn('Not authenticated: skipping storage object deletion');
          } else {
            const url = part.imageUrl as string;
            const filePath = getStoragePathFromImageUrl(url);

            if (filePath) {
              const { error } = await supabase.storage.from('Thumbnails').remove([filePath]);
              if (error) console.error('Error deleting storage object for part:', error);
            } else {
              console.warn('Could not determine storage path from imageUrl:', url);
            }
          }
        }
      } catch (e) {
        console.error('Failed to remove part thumbnail:', e);
      }
    })();

    setProjects(prev => prev.map(p => {
      if (p.id !== projectId) return p;
      return { ...p, parts: p.parts.filter(part => part.id !== partId) };
    }));

    void trackMutation('Delete part', () => supabase.from('parts').delete().eq('id', partId));
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
      return trackMutation('Add extracted parts', () => supabase.from('parts').insert(insertedParts));
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
      const { data, error } = await supabase.rpc('transition_project_state', {
          p_project_id: projectId,
          p_action: action,
          p_technician_name: technicianName,
          p_reason: reason ?? null,
          p_override_note: overrideNote ?? null,
          p_print_label: printLabel ?? null
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
      const { data, error } = await supabase.rpc('transition_part_status', {
          p_project_id: projectId,
          p_part_id: partId,
          p_action: action,
          p_technician_name: technicianName,
          p_machine_name: machineName ?? null,
          p_reason: reason ?? null
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
      transitionPartStatus,
      activeFilter,
      setActiveFilter
    }}>
      {children}
    </ProjectContext.Provider>
  );
};
