import type { ProjectDescriptor, WorkflowFolderKey } from '../../shared/localHelperProtocol';
import type { Project } from '../types';

const finishedStatuses = new Set(['PRINTED', 'POST_PROCESSING', 'COLLECTED']);
const begunStatuses = new Set(['PRINTING', 'PRINTED', 'FAILED', 'POST_PROCESSING', 'COLLECTED']);

export const getExpectedWorkflowFolder = (project: Project): WorkflowFolderKey => {
  if (project.archived || project.state === 'CANCELLED') return 'do_not_print';
  if (project.parts.length > 0 && project.parts.every((part) => finishedStatuses.has(part.printStatus))) return 'completed_prints';
  if (project.parts.some((part) => begunStatuses.has(part.printStatus) || Boolean(part.printRuns?.length))) return 'currently_printing';
  return 'to_be_printed';
};

export const projectExpectsTbc = (project: Project): boolean =>
  !project.archived && ['INTAKE', 'REVIEW', 'QUOTE', 'AWAITING_PAYMENT', 'READY_FOR_PRINTING'].includes(project.state);

export const projectFolderDescriptor = (project: Project): ProjectDescriptor => ({
  projectId: project.id,
  priorityNumber: project.priorityNumber,
  studentName: project.studentName,
  studentNumber: project.studentNumber,
  expectedWorkflowFolder: getExpectedWorkflowFolder(project),
  expectTbc: projectExpectsTbc(project)
});
