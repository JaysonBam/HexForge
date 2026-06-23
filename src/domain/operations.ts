import type { Part, PrintStatus, Project, ProjectState } from '../types';
import { isPartVerifiedForReview } from './partVerification.ts';

export type WorkspaceTab = 'overview' | 'parts' | 'quote' | 'production' | 'collection' | 'audit';

export const isValidStudentNumber = (studentNumber: string) => /^\d{8}$/.test(studentNumber);

export const getStudentEmail = (studentNumber: string) =>
  isValidStudentNumber(studentNumber) ? `u${studentNumber}@tuks.co.za` : '';

export const isValidEmail = (email: string) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

export type DashboardLaneKey =
  | 'toBeConfirmed'
  | 'readyToPrint'
  | 'printing';

export const projectStateMeta: Record<ProjectState, { label: string; tone: string }> = {
  INTAKE: { label: 'Intake', tone: 'forge-badge-slate' },
  REVIEW: { label: 'Needs Review', tone: 'forge-badge-blue' },
  QUOTE: { label: 'Quote', tone: 'forge-badge-gold' },
  AWAITING_PAYMENT: { label: 'Awaiting Payment', tone: 'forge-badge-pink' },
  READY_FOR_PRINTING: { label: 'Ready to Print', tone: 'forge-badge-teal' },
  IN_PRODUCTION: { label: 'Printing', tone: 'forge-badge-indigo' },
  READY_FOR_COLLECTION: { label: 'Ready for Collection', tone: 'forge-badge-green' },
  PARTIALLY_COLLECTED: { label: 'Partially Collected', tone: 'forge-badge-teal' },
  CLOSED: { label: 'Closed', tone: 'forge-badge-zinc' },
  CANCELLED: { label: 'Cancelled', tone: 'forge-badge-zinc line-through' }
};

export const printStatusMeta: Record<PrintStatus, { label: string; tone: string }> = {
  DRAFT: { label: 'Draft', tone: 'forge-badge-slate' },
  VERIFIED: { label: 'Verified', tone: 'forge-badge-blue' },
  READY: { label: 'Ready', tone: 'forge-badge-teal' },
  PRINTING: { label: 'Printing', tone: 'forge-badge-indigo' },
  PRINTED: { label: 'Printed', tone: 'forge-badge-green' },
  FAILED: { label: 'Failed', tone: 'forge-badge-rose' },
  POST_PROCESSING: { label: 'Post-processing', tone: 'forge-badge-gold' },
  COLLECTED: { label: 'Collected', tone: 'forge-badge-zinc' }
};

export const dashboardLaneMeta: Record<DashboardLaneKey, {
  title: string;
  shortTitle: string;
  tone: string;
}> = {
  toBeConfirmed: {
    title: 'To Be Confirmed',
    shortTitle: 'Confirm',
    tone: 'forge-lane forge-lane-blue'
  },
  readyToPrint: {
    title: 'Ready for Printing',
    shortTitle: 'Ready',
    tone: 'forge-lane forge-lane-teal'
  },
  printing: {
    title: 'Printing',
    shortTitle: 'Printing',
    tone: 'forge-lane forge-lane-indigo'
  }
};

const activeStates = new Set<ProjectState>([
  'INTAKE',
  'REVIEW',
  'QUOTE',
  'AWAITING_PAYMENT',
  'READY_FOR_PRINTING',
  'IN_PRODUCTION',
  'READY_FOR_COLLECTION',
  'PARTIALLY_COLLECTED'
]);

export const isActiveProject = (project: Project) => activeStates.has(project.state);

export const isPaymentBlocked = (project: Project) =>
  project.needsPayment &&
  !project.moduleOrLecturerPays &&
  !(project.receiptNumber && project.receiptNumber.trim()) &&
  !(project.paymentOverrideNote && project.paymentOverrideNote.trim());

export const isCollectionBlocked = (project: Project) =>
  project.needsPayment &&
  !(project.receiptNumber && project.receiptNumber.trim());

export const getPartCounts = (project: Project) => {
  const total = project.parts.length;
  const verified = project.parts.filter(isPartVerifiedForReview).length;
  const ready = project.parts.filter((part) => part.printStatus === 'READY' || part.printStatus === 'VERIFIED').length;
  const printing = project.parts.filter((part) => part.printStatus === 'PRINTING').length;
  const printed = project.parts.filter((part) => ['PRINTED', 'POST_PROCESSING', 'COLLECTED'].includes(part.printStatus)).length;
  const collected = project.parts.filter((part) => part.printStatus === 'COLLECTED').length;
  const failed = project.parts.filter((part) => part.printStatus === 'FAILED').length;
  const postProcessing = project.parts.filter((part) => part.printStatus === 'POST_PROCESSING').length;

  return { total, verified, ready, printing, printed, collected, failed, postProcessing };
};

export const getProjectBlockers = (project: Project) => {
  const blockers: string[] = [];
  const counts = getPartCounts(project);

  if (!project.studentName.trim()) blockers.push('Student name missing');
  if (!project.studentNumber.trim()) blockers.push('Student number missing');
  else if (!isValidStudentNumber(project.studentNumber)) blockers.push('Student number must be 8 digits');
  if (counts.total === 0) blockers.push('No parts added');

  const unverified = project.parts.filter((part) => !isPartVerifiedForReview(part)).length;
  if (project.state === 'REVIEW' && unverified > 0) blockers.push(`${unverified} part${unverified === 1 ? '' : 's'} not verified`);

  if (isPaymentBlocked(project) && ['AWAITING_PAYMENT', 'READY_FOR_PRINTING', 'READY_FOR_COLLECTION', 'PARTIALLY_COLLECTED'].includes(project.state)) {
    blockers.push('Payment gate not cleared');
  }

  if (counts.failed > 0) blockers.push(`${counts.failed} failed print${counts.failed === 1 ? '' : 's'}`);
  if (counts.postProcessing > 0) blockers.push(`${counts.postProcessing} part${counts.postProcessing === 1 ? '' : 's'} in post-processing`);

  return blockers;
};

export const getProjectLane = (project: Project): DashboardLaneKey | null => {
  const counts = getPartCounts(project);

  if (project.state === 'CLOSED' || project.state === 'CANCELLED') return null;
  if (project.state === 'READY_FOR_COLLECTION' || project.state === 'PARTIALLY_COLLECTED') return null;
  if (counts.printing > 0 || counts.printed > 0) return 'printing';
  if (project.state === 'READY_FOR_PRINTING' || project.state === 'IN_PRODUCTION') return 'readyToPrint';
  return 'toBeConfirmed';
};

export const buildDashboardLanes = (projects: Project[]) => {
  const lanes: Record<DashboardLaneKey, Project[]> = {
    toBeConfirmed: [],
    readyToPrint: [],
    printing: []
  };

  projects
    .filter(isActiveProject)
    .sort((a, b) => a.priorityNumber - b.priorityNumber || a.createdAt.localeCompare(b.createdAt))
    .forEach((project) => {
      const lane = getProjectLane(project);
      if (lane) lanes[lane].push(project);
    });

  return lanes;
};

export const getWorkspaceTabForState = (state: ProjectState): WorkspaceTab => {
  if (state === 'INTAKE' || state === 'REVIEW') return 'parts';
  if (state === 'QUOTE' || state === 'AWAITING_PAYMENT' || state === 'READY_FOR_PRINTING') return 'quote';
  if (state === 'IN_PRODUCTION') return 'production';
  if (state === 'READY_FOR_COLLECTION' || state === 'PARTIALLY_COLLECTED' || state === 'CLOSED' || state === 'CANCELLED') return 'collection';
  return 'overview';
};

export const getNextAction = (project: Project) => {
  const counts = getPartCounts(project);
  const blockers = getProjectBlockers(project);

  if (project.state === 'INTAKE' || project.state === 'REVIEW') {
    if (counts.total === 0) return 'Add printable parts';
    if (blockers.some((item) => item.includes('verified'))) return 'Verify extracted parts';
    return 'Move to quote';
  }

  if (project.state === 'QUOTE') return project.quoteSnapshot ? 'Review quote' : 'Make initial quote';
  if (project.state === 'AWAITING_PAYMENT') return 'Record receipt or payment route';
  if (project.state === 'READY_FOR_PRINTING') return 'Start the next print';
  if (project.state === 'IN_PRODUCTION') {
    if (counts.printing > 0) return 'Finish or fail active prints';
    if (counts.printed < counts.total) return 'Start queued parts';
    return 'Move to collection';
  }
  if (project.state === 'READY_FOR_COLLECTION' || project.state === 'PARTIALLY_COLLECTED') return 'Collect finished parts';
  if (project.state === 'CLOSED') return 'Project closed';
  if (project.state === 'CANCELLED') return 'Project cancelled';
  return 'Review project';
};

export const getPaymentLabel = (project: Project) => {
  if (!project.needsPayment) return 'No payment required';
  if (project.moduleOrLecturerPays) return 'Covered by module/lecturer';
  if (project.receiptNumber?.trim()) return `Receipt ${project.receiptNumber.trim()}`;
  if (project.paymentOverrideNote?.trim()) return 'Payment override approved';
  return 'Payment required';
};

export const getPartTotalWeight = (part: Part) =>
  (part.primaryEstimatedWeight || 0) + (part.secondaryEstimatedWeight || 0);
