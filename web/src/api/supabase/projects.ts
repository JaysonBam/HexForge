import { normalizePartVerification } from '@/domain/partVerification';
import type { PrintRun, Project, QuoteSnapshot } from '@/types';
import { supabase } from './client';

type QuoteSnapshotRow = {
  project_id?: string | null;
  snapshot_version?: number | string | null;
  status?: QuoteSnapshot['status'] | null;
  currency?: string | null;
  total_cost?: number | string | null;
  generated_at?: string | null;
  line_summary?: unknown;
};

type PrintRunRow = {
  id: number | string;
  part_id: string;
  project_id: string;
  machine_id?: string | null;
  machine_name?: string | null;
  started_by: string;
  ended_by?: string | null;
  started_at: string;
  finished_at?: string | null;
  failed_at?: string | null;
  failure_reason?: string | null;
  outcome?: PrintRun['outcome'];
};

export type ProjectsLoadResult = {
  projects: Project[];
  quoteSnapshotError: string | null;
  printRunError: string | null;
};

export const getProjects = async (): Promise<ProjectsLoadResult> => {
  const { data: dbProjects, error: projectError } = await supabase
    .from('projects')
    .select('*');
  if (projectError || !dbProjects) {
    throw new Error(projectError?.message || 'Failed to fetch projects.');
  }

  const { data: dbParts, error: partError } = await supabase
    .from('parts')
    .select('*');
  if (partError || !dbParts) {
    throw new Error(partError?.message || 'Failed to fetch project parts.');
  }

  const { data: dbSnapshots, error: snapshotError } = await supabase
    .from('project_cost_snapshots')
    .select('project_id,snapshot_version,status,currency,total_cost,generated_at,line_summary')
    .order('snapshot_version', { ascending: true });

  const { data: dbPrintRuns, error: printRunError } = await supabase
    .from('print_runs')
    .select('id,part_id,project_id,machine_id,machine_name,started_by,ended_by,started_at,finished_at,failed_at,failure_reason,outcome')
    .order('started_at', { ascending: false });

  const snapshotByProject = new Map<string, QuoteSnapshot>();
  const snapshotsByProject = new Map<string, QuoteSnapshot[]>();
  (dbSnapshots as QuoteSnapshotRow[] | null)?.forEach((snapshotRow) => {
    const projectId = (snapshotRow.project_id || '').toString();
    if (!projectId) return;

    const snapshot = {
      snapshot_version: Number(snapshotRow.snapshot_version || 0),
      status: snapshotRow.status || 'ISSUED',
      currency: snapshotRow.currency || 'ZAR',
      total_cost: Number(snapshotRow.total_cost || 0),
      generated_at: snapshotRow.generated_at || '',
      line_summary: Array.isArray(snapshotRow.line_summary)
        ? snapshotRow.line_summary as QuoteSnapshot['line_summary']
        : []
    } as QuoteSnapshot;

    const projectSnapshots = snapshotsByProject.get(projectId) ?? [];
    projectSnapshots.push(snapshot);
    snapshotsByProject.set(projectId, projectSnapshots);

    if (snapshot.status === 'ISSUED') {
      const existingVersion = snapshotByProject.get(projectId)?.snapshot_version ?? -1;
      if (snapshot.snapshot_version >= existingVersion) {
        snapshotByProject.set(projectId, snapshot);
      }
    }
  });

  const printRunsByPart = new Map<string, PrintRun[]>();
  (dbPrintRuns as PrintRunRow[] | null)?.forEach((run) => {
    const partId = (run.part_id || '').toString();
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

  const projects = dbProjects.map((project) => ({
    ...project,
    email: typeof project.email === 'string' ? project.email : '',
    parts: dbParts
      .filter((part) => part.projectId === project.id)
      .sort((left, right) => Number(left.partNumber || 0) - Number(right.partNumber || 0))
      .map((part) => normalizePartVerification({
        ...part,
        printRuns: printRunsByPart.get(part.id) ?? []
      })),
    quoteSnapshot: snapshotByProject.get(project.id),
    quoteSnapshots: snapshotsByProject.get(project.id) ?? []
  })) as Project[];

  return {
    projects,
    quoteSnapshotError: snapshotError?.message || null,
    printRunError: printRunError?.message || null
  };
};

export const createProjectRecord = (project: Omit<Project, 'parts'> & { parts?: never }) => supabase
  .from('projects')
  .insert([project]);

export const updateProjectRecord = (projectId: string, updates: Partial<Project>) => supabase
  .from('projects')
  .update(updates)
  .eq('id', projectId);

export const deleteProjectRecord = (projectId: string) => supabase
  .from('projects')
  .delete()
  .eq('id', projectId);

export const transitionProjectRecord = (args: {
  projectId: string;
  action: string;
  technicianName: string;
  reason?: string;
  overrideNote?: string;
  printLabel?: string;
}) => supabase.rpc('transition_project_state', {
  p_project_id: args.projectId,
  p_action: args.action,
  p_technician_name: args.technicianName,
  p_reason: args.reason ?? null,
  p_override_note: args.overrideNote ?? null,
  p_print_label: args.printLabel ?? null
});
