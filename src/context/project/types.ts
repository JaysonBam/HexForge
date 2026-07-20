import type { Part, PrintRun, Project, QuoteSnapshot } from '../../types';

export type SupabaseMutationResult = {
  error: { message?: string } | null;
};

export type QuoteSnapshotRow = {
  project_id?: string | null;
  snapshot_version?: number | string | null;
  status?: QuoteSnapshot['status'] | null;
  currency?: string | null;
  total_cost?: number | string | null;
  generated_at?: string | null;
  line_summary?: unknown;
};

export type PrintRunRow = {
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

export type TransitionResult = {
  ok: boolean;
  errors: string[];
  warnings?: string[];
};

export type ProjectTransitionAction =
  | 'BEGIN_REVIEW'
  | 'COMPLETE_REVIEW'
  | 'ISSUE_QUOTE'
  | 'MOVE_TO_PRINTING'
  | 'MARK_READY_FOR_COLLECTION'
  | 'CLOSE_PROJECT'
  | 'CANCEL_PROJECT'
  | 'REOPEN_REVIEW';

export type PartTransitionAction =
  | 'VERIFY_PART'
  | 'UNVERIFY_PART'
  | 'MARK_PART_READY'
  | 'START_PRINT'
  | 'FINISH_PRINT'
  | 'FAIL_PRINT'
  | 'SEND_TO_POST_PROCESSING'
  | 'MARK_PRINTED_READY'
  | 'COLLECT_PART'
  | 'REQUEUE_PART';

export interface ProjectContextType {
  projects: Project[];
  projectsLoading: boolean;
  projectsLoadError: string | null;
  syncStatus: { saving: boolean; error: string | null };
  clearSyncError: () => void;
  getProject: (id: string) => Project | undefined;
  refreshProjects: () => Promise<void>;
  addProject: (data: Partial<Project>) => Promise<string | null>;
  updateProject: (id: string, data: Partial<Project>) => void;
  deleteProject: (id: string) => Promise<boolean>;
  addPart: (projectId: string) => void;
  updatePart: (projectId: string, partId: string, data: Partial<Part>) => void;
  deletePart: (projectId: string, partId: string) => void;
  addExtractedParts: (projectId: string, parts: Partial<Part>[]) => Promise<boolean>;
  transitionProjectState: (args: {
    projectId: string;
    action: ProjectTransitionAction;
    technicianName: string;
    reason?: string;
    overrideNote?: string;
    printLabel?: string;
  }) => Promise<TransitionResult>;
  transitionPartStatus: (args: {
    projectId: string;
    partId: string;
    action: PartTransitionAction;
    technicianName: string;
    machineName?: string;
    reason?: string;
  }) => Promise<TransitionResult>;
  activeFilter: string;
  setActiveFilter: (filter: string) => void;
}
