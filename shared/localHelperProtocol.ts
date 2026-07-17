export const LOCAL_HELPER_VERSION = '1.1.0';
export const LOCAL_HELPER_API_VERSION = 'v1';
export const LOCAL_HELPER_DEFAULT_PORT = 47821;
export const LOCAL_HELPER_CLIENT_HEADER = 'X-Printing-Manager-Client';
export const LOCAL_HELPER_CLIENT_VALUE = 'HexForge/1';
export const LOCAL_HELPER_IDEMPOTENCY_HEADER = 'X-Idempotency-Key';

export type HelperConnectionState =
  | 'unavailable'
  | 'not_configured'
  | 'root_unavailable'
  | 'connected';

export type ProjectDescriptor = {
  projectId: string;
  priorityNumber: number;
  studentName: string;
  studentNumber: string;
  expectedWorkflowFolder?: WorkflowFolderKey;
  expectTbc?: boolean;
};

export const WORKFLOW_FOLDER_KEYS = ['to_be_printed', 'currently_printing', 'completed_prints', 'do_not_print'] as const;
export type WorkflowFolderKey = typeof WORKFLOW_FOLDER_KEYS[number];

export const WORKFLOW_FOLDER_LABELS: Record<WorkflowFolderKey, string> = {
  to_be_printed: 'To Be Printed',
  currently_printing: 'Currently Printing',
  completed_prints: 'Completed Prints',
  do_not_print: 'Do Not Print'
};

export type FolderSyncState = {
  isInSync: boolean;
  expectedWorkflowFolder: WorkflowFolderKey;
  expectedFolderName: string;
  locationMismatch: boolean;
  nameMismatch: boolean;
  suggestedActionLabel: string;
};

export type HelperHealth = {
  apiVersion: typeof LOCAL_HELPER_API_VERSION;
  helperVersion: string;
  state: Exclude<HelperConnectionState, 'unavailable'>;
  configured: boolean;
  rootAvailable: boolean;
  installationId: string;
  port: number;
  defaultApplications?: Partial<Record<SupportedFileKind, DefaultApplication>>;
};

export type FolderCandidate = {
  candidateId: string;
  folderName: string;
  relativePath: string;
  workflowFolder: WorkflowFolderKey;
};

export type ProjectResolution =
  | { status: 'not_found' }
  | { status: 'ambiguous'; candidates: FolderCandidate[] }
  | {
      status: 'matched' | 'created';
      projectKey: string;
      folderName: string;
      relativePath: string;
      workflowFolder: WorkflowFolderKey;
      sync: FolderSyncState;
    };

export type SupportedFileKind =
  | 'stl'
  | '3mf'
  | 'step'
  | 'stp'
  | 'obj'
  | 'gcode'
  | 'gcode.3mf'
  | 'ufp';

export type LocalFileGroup = 'model' | 'print_ready';

export type LocalProjectFile = {
  fileId: string;
  filename: string;
  relativePath: string;
  relativeDirectory: string;
  size: number;
  modifiedAt: string;
  kind: SupportedFileKind;
  group: LocalFileGroup;
  importEligible: boolean;
};

export type ProjectFilesResponse = {
  folderName: string;
  relativePath: string;
  totalFiles: number;
  counts: Record<LocalFileGroup, number>;
  truncated: boolean;
  files: LocalProjectFile[];
};

export type CopyOperationStatus =
  | 'awaiting_destination'
  | 'copying'
  | 'completed'
  | 'cancelled'
  | 'failed';

export type CopyOperation = {
  operationId: string;
  status: CopyOperationStatus;
  bytesCopied: number;
  totalBytes: number;
  destinationName?: string;
  error?: string;
};

export type SlicerHint = 'auto' | 'bambu' | 'cura' | 'system';
export type DefaultApplication = Exclude<SlicerHint, 'auto'>;

export type HelperErrorPayload = {
  error: {
    code: string;
    message: string;
  };
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export const isHelperHealth = (value: unknown): value is HelperHealth => {
  if (!isObject(value)) return false;
  const applicationsValid = value.defaultApplications === undefined
    || (isObject(value.defaultApplications)
      && Object.values(value.defaultApplications).every((application) => ['bambu', 'cura', 'system'].includes(String(application))));
  return value.apiVersion === LOCAL_HELPER_API_VERSION
    && value.helperVersion === LOCAL_HELPER_VERSION
    && ['not_configured', 'root_unavailable', 'connected'].includes(String(value.state))
    && typeof value.configured === 'boolean'
    && typeof value.rootAvailable === 'boolean'
    && typeof value.installationId === 'string'
    && Number.isInteger(value.port)
    && applicationsValid;
};

export const isProjectResolution = (value: unknown): value is ProjectResolution => {
  if (!isObject(value) || typeof value.status !== 'string') return false;
  if (value.status === 'not_found') return true;
  if (value.status === 'ambiguous') {
    return Array.isArray(value.candidates) && value.candidates.every((candidate) =>
      isObject(candidate)
      && typeof candidate.candidateId === 'string'
      && typeof candidate.folderName === 'string'
      && typeof candidate.relativePath === 'string'
      && Object.hasOwn(WORKFLOW_FOLDER_LABELS, String(candidate.workflowFolder)));
  }
  return (value.status === 'matched' || value.status === 'created')
    && typeof value.projectKey === 'string'
    && typeof value.folderName === 'string'
    && typeof value.relativePath === 'string'
    && Object.hasOwn(WORKFLOW_FOLDER_LABELS, String(value.workflowFolder))
    && isObject(value.sync)
    && typeof value.sync.isInSync === 'boolean'
    && Object.hasOwn(WORKFLOW_FOLDER_LABELS, String(value.sync.expectedWorkflowFolder))
    && typeof value.sync.expectedFolderName === 'string'
    && typeof value.sync.locationMismatch === 'boolean'
    && typeof value.sync.nameMismatch === 'boolean'
    && typeof value.sync.suggestedActionLabel === 'string';
};

export const isProjectFilesResponse = (value: unknown): value is ProjectFilesResponse => {
  if (!isObject(value) || !Array.isArray(value.files) || !isObject(value.counts)) return false;
  return typeof value.folderName === 'string'
    && typeof value.relativePath === 'string'
    && typeof value.totalFiles === 'number'
    && typeof value.truncated === 'boolean'
    && typeof value.counts.model === 'number'
    && typeof value.counts.print_ready === 'number'
    && value.files.every((file) => isObject(file)
      && typeof file.fileId === 'string'
      && typeof file.filename === 'string'
      && typeof file.relativePath === 'string'
      && typeof file.relativeDirectory === 'string'
      && typeof file.size === 'number'
      && typeof file.modifiedAt === 'string'
      && typeof file.kind === 'string'
      && (file.group === 'model' || file.group === 'print_ready')
      && typeof file.importEligible === 'boolean');
};

export const isCopyOperation = (value: unknown): value is CopyOperation =>
  isObject(value)
  && typeof value.operationId === 'string'
  && ['awaiting_destination', 'copying', 'completed', 'cancelled', 'failed'].includes(String(value.status))
  && typeof value.bytesCopied === 'number'
  && typeof value.totalBytes === 'number';

export const isHelperErrorPayload = (value: unknown): value is HelperErrorPayload =>
  isObject(value)
  && isObject(value.error)
  && typeof value.error.code === 'string'
  && typeof value.error.message === 'string';
