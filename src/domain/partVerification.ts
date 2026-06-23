import type { Part, PrintStatus } from '../types';

const reviewVerifiedStatuses = new Set<PrintStatus>([
  'VERIFIED',
  'READY',
  'PRINTING',
  'PRINTED',
  'POST_PROCESSING',
  'COLLECTED'
]);

const clearableVerificationStatuses = new Set<PrintStatus>([
  'VERIFIED',
  'READY'
]);

export const isPartVerifiedForReview = (part: Pick<Part, 'printStatus'>) =>
  reviewVerifiedStatuses.has(part.printStatus);

export const canClearPartVerification = (part: Pick<Part, 'printStatus' | 'checkedBy'>) =>
  clearableVerificationStatuses.has(part.printStatus) && Boolean(part.checkedBy?.trim());

export const getVisibleCheckedBy = (part: Pick<Part, 'printStatus' | 'checkedBy'>) =>
  isPartVerifiedForReview(part) ? part.checkedBy?.trim() ?? '' : '';

export const normalizePartVerification = <T extends Pick<Part, 'printStatus' | 'checkedBy'>>(part: T): T => {
  if (isPartVerifiedForReview(part) || !part.checkedBy?.trim()) {
    return part;
  }

  return {
    ...part,
    checkedBy: ''
  };
};
