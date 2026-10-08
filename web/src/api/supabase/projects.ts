import { notifyGmailInboxChange } from '@/lib/gmailInboxEvents';
import { normalizePartVerification } from '@/domain/partVerification';
import type { Part, PrintRun, Project, QuoteSnapshot } from '@/types';
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

const loadProjects = async (projectId?: string): Promise<ProjectsLoadResult> => {
  const projectQuery = supabase.from('projects').select('*');
  const partQuery = supabase.from('parts').select('*');
  const snapshotQuery = supabase.from('project_cost_snapshots')
    .select('project_id,snapshot_version,status,currency,total_cost,generated_at,line_summary')
    .order('snapshot_version', { ascending: true });
  const runQuery = supabase.from('print_runs')
    .select('id,part_id,project_id,machine_id,machine_name,started_by,ended_by,started_at,finished_at,failed_at,failure_reason,outcome')
    .order('started_at', { ascending: false });
  if (projectId) {
    projectQuery.eq('id', projectId);
    partQuery.eq('projectId', projectId);
    snapshotQuery.eq('project_id', projectId);
    runQuery.eq('project_id', projectId);
  }
  const [
    { data: dbProjects, error: projectError },
    { data: dbParts, error: partError },
    { data: dbSnapshots, error: snapshotError },
    { data: dbPrintRuns, error: printRunError }
  ] = await Promise.all([projectQuery, partQuery, snapshotQuery, runQuery]);
  if (projectError || !dbProjects) {
    throw new Error(projectError?.message || 'Failed to fetch projects.');
  }

  if (partError || !dbParts) {
    throw new Error(partError?.message || 'Failed to fetch project parts.');
  }

  return {
    projects: mapProjectRows(dbProjects, dbParts, dbSnapshots, dbPrintRuns),
    quoteSnapshotError: snapshotError?.message || null,
    printRunError: printRunError?.message || null
  };
};

type ProjectRow = Omit<Project, 'parts'>;
type PartRow = Part & { projectId: string };
const mapProjectRows = (
  projectRows: ProjectRow[], partRows: PartRow[],
  snapshotRows: QuoteSnapshotRow[] | null, printRunRows: PrintRunRow[] | null
): Project[] => {
  const snapshotByProject = new Map<string, QuoteSnapshot>();
  const snapshotsByProject = new Map<string, QuoteSnapshot[]>();
  snapshotRows?.forEach((snapshotRow) => {
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
  printRunRows?.forEach((run) => {
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

  const partsByProject = new Map<string, PartRow[]>();
  partRows.forEach(part => {
    const projectParts = partsByProject.get(part.projectId) ?? [];
    projectParts.push(part);
    partsByProject.set(part.projectId, projectParts);
  });
  return projectRows.map((project) => ({
    ...project,
    email: typeof project.email === 'string' ? project.email : '',
    parts: (partsByProject.get(project.id) ?? [])
      .sort((left, right) => Number(left.partNumber || 0) - Number(right.partNumber || 0))
      .map((part) => normalizePartVerification({
        ...part,
        printRuns: printRunsByPart.get(part.id) ?? []
      })),
    quoteSnapshot: snapshotByProject.get(project.id),
    quoteSnapshots: snapshotsByProject.get(project.id) ?? []
  })) as Project[];

};

export const getProjects = (): Promise<ProjectsLoadResult> => loadProjects();
export const getProjectById = (projectId: string): Promise<ProjectsLoadResult> => loadProjects(projectId);

export type ActiveProjectSnapshot = { version: string; project: Project };
type ActiveProjectCacheRow = {
  project_id: string;
  version: string;
  project_data: {
    project: ProjectRow;
    parts: PartRow[];
    snapshots: QuoteSnapshotRow[];
    print_runs: PrintRunRow[];
  } | null;
};

export async function getActiveProjectCache(
  saved: Record<string, ActiveProjectSnapshot> = {}
): Promise<Record<string, ActiveProjectSnapshot>> {
  const valid = Object.fromEntries(Object.entries(saved).filter(([id, entry]) =>
    typeof entry?.version === 'string' && entry.project?.id === id && Array.isArray(entry.project.parts)));
  const { data, error } = await supabase.rpc('read_active_project_cache', {
    known_versions: Object.fromEntries(Object.entries(valid).map(([id, entry]) => [id, entry.version]))
  });
  if (error || !data) throw new Error(error?.message || 'Active projects could not be checked.');
  return Object.fromEntries((data as ActiveProjectCacheRow[]).map(row => {
    const source = row.project_data;
    const project = source ? mapProjectRows([source.project], source.parts, source.snapshots, source.print_runs)[0]
      : valid[row.project_id]?.project;
    if (!project) throw new Error('The active project snapshot is incomplete.');
    return [row.project_id, { version: row.version, project }];
  }));
}

// Read-only cards need identity and statuses, not costs, thumbnails or histories.
export type ProjectSummary = Pick<Project,
  'id' | 'state' | 'priorityNumber' | 'studentName' | 'studentNumber' | 'email' | 'course' | 'lecturer' | 'createdAt' | 'printLabel'
> & { parts: Pick<Part, 'printStatus'>[] };

export const getProjectSummaries = async (dashboardOnly = true): Promise<ProjectSummary[]> => {
  const columns = 'id,state,priorityNumber,studentName,studentNumber,email,course,lecturer,createdAt,printLabel';
  const query = supabase.from('projects').select(dashboardOnly
    ? `${columns},parts!parts_projectId_fkey(printStatus)`
    : columns);
  if (dashboardOnly) query.not('state', 'in', '(CLOSED,CANCELLED,READY_FOR_COLLECTION,PARTIALLY_COLLECTED)');
  const { data, error } = await query;
  if (error || !data) throw new Error(error?.message || 'Failed to fetch project summaries.');
  return (data as unknown as ProjectSummary[]).map(project => ({ ...project, parts: project.parts ?? [] }));
};

export const createProjectRecord = async (project: Omit<Project, 'parts'> & { parts?: never }) => {
  const result = await supabase.from('projects').insert([project]);
  if (!result.error && project.gmailThreadId) notifyGmailInboxChange({ type: 'project', projectId: project.id,
    threadId: project.gmailThreadId, accountEmail: project.gmailAccountEmail, priorityNumber: project.priorityNumber });
  return result;
};

export const updateProjectRecord = async (projectId: string, updates: Partial<Project>) => {
  const result = await supabase.from('projects').update(updates).eq('id', projectId);
  if (!result.error && ('gmailThreadId' in updates || 'gmailAccountEmail' in updates || 'priorityNumber' in updates)) notifyGmailInboxChange({ type: 'project', projectId,
    threadId: updates.gmailThreadId, accountEmail: updates.gmailAccountEmail, priorityNumber: updates.priorityNumber });
  return result;
};

export const deleteProjectRecord = async (projectId: string) => {
  const result = await supabase.from('projects').delete().eq('id', projectId);
  if (!result.error) notifyGmailInboxChange({ type: 'project', projectId, deleted: true });
  return result;
};

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
