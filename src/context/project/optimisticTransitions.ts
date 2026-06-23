import type { Part, PrintRun, PrintStatus, Project, ProjectState } from '../../types';
import type { PartTransitionAction, ProjectTransitionAction } from './types';

const clonePrintRun = (run: PrintRun): PrintRun => ({ ...run });

export const applyOptimisticPartTransition = (
  projects: Project[],
  {
    projectId,
    partId,
    action,
    technicianName,
    machineName,
    reason
  }: {
    projectId: string;
    partId: string;
    action: PartTransitionAction;
    technicianName: string;
    machineName?: string;
    reason?: string;
  }
) => {
  const now = new Date().toISOString();

  return projects.map((project) => {
    if (project.id !== projectId) return project;

    return {
      ...project,
      parts: project.parts.map((part) => {
        if (part.id !== partId) return part;

        const currentRuns = part.printRuns ?? [];
        const latestRun = currentRuns[0];

        const setPrintStatus = (printStatus: PrintStatus, extra: Partial<Part> = {}): Part => ({
          ...part,
          ...extra,
          printStatus
        });

        switch (action) {
          case 'VERIFY_PART':
            return setPrintStatus('VERIFIED', { checkedBy: technicianName });
          case 'UNVERIFY_PART':
            return setPrintStatus('DRAFT', { checkedBy: '' });
          case 'MARK_PART_READY':
            return setPrintStatus('READY');
          case 'START_PRINT':
            return setPrintStatus('PRINTING', {
              printerName: machineName,
              startedBy: technicianName,
              printRuns: [
                {
                  id: -Date.now(),
                  part_id: part.id,
                  project_id: project.id,
                  machine_name: machineName || null,
                  started_by: technicianName,
                  started_at: now,
                  outcome: null
                },
                ...currentRuns.map(clonePrintRun)
              ]
            });
          case 'FINISH_PRINT':
            return setPrintStatus('PRINTED', {
              removedBy: technicianName,
              printRuns: currentRuns.length > 0
                ? [
                    {
                      ...clonePrintRun(latestRun),
                      ended_by: technicianName,
                      finished_at: now,
                      outcome: 'PRINTED'
                    },
                    ...currentRuns.slice(1).map(clonePrintRun)
                  ]
                : currentRuns
            });
          case 'FAIL_PRINT':
            return setPrintStatus('FAILED', {
              printRuns: currentRuns.length > 0
                ? [
                    {
                      ...clonePrintRun(latestRun),
                      ended_by: technicianName,
                      failed_at: now,
                      failure_reason: reason ?? null,
                      outcome: 'FAILED'
                    },
                    ...currentRuns.slice(1).map(clonePrintRun)
                  ]
                : currentRuns
            });
          case 'SEND_TO_POST_PROCESSING':
            return setPrintStatus('POST_PROCESSING');
          case 'MARK_PRINTED_READY':
            return setPrintStatus('PRINTED');
          case 'COLLECT_PART':
            return setPrintStatus('COLLECTED', { collectedBy: technicianName, collectedAt: now });
          case 'REQUEUE_PART':
            return setPrintStatus('READY', {
              printerName: undefined,
              startedBy: undefined,
              removedBy: technicianName,
              printRuns: currentRuns.length > 0
                ? [
                    {
                      ...clonePrintRun(latestRun),
                      ended_by: latestRun && !latestRun.finished_at && !latestRun.failed_at ? technicianName : latestRun?.ended_by,
                      failed_at: latestRun && !latestRun.finished_at && !latestRun.failed_at ? now : latestRun?.failed_at,
                      failure_reason: latestRun && !latestRun.finished_at && !latestRun.failed_at
                        ? (reason ?? latestRun.failure_reason ?? 'Requeued before completion.')
                        : latestRun?.failure_reason,
                      outcome: latestRun && !latestRun.finished_at && !latestRun.failed_at
                        ? 'FAILED'
                        : latestRun?.outcome
                    },
                    ...currentRuns.slice(1).map(clonePrintRun)
                  ]
                : currentRuns
            });
          default:
            return part;
        }
      })
    };
  });
};

export const applyOptimisticProjectTransition = (
  projects: Project[],
  {
    projectId,
    action,
    printLabel
  }: {
    projectId: string;
    action: ProjectTransitionAction;
    printLabel?: string;
  }
): Project[] =>
  projects.map((project) => {
    if (project.id !== projectId) return project;

    switch (action) {
      case 'BEGIN_REVIEW':
      case 'REOPEN_REVIEW':
        return { ...project, state: 'REVIEW' as ProjectState };
      case 'COMPLETE_REVIEW':
        return { ...project, state: 'QUOTE' as ProjectState };
      case 'ISSUE_QUOTE':
        return {
          ...project,
          state: (project.needsPayment ? 'AWAITING_PAYMENT' : 'READY_FOR_PRINTING') as ProjectState
        };
      case 'MOVE_TO_PRINTING':
        return { ...project, state: 'IN_PRODUCTION' as ProjectState };
      case 'MARK_READY_FOR_COLLECTION':
        return {
          ...project,
          state: 'READY_FOR_COLLECTION' as ProjectState,
          printLabel: printLabel ?? project.printLabel
        };
      case 'CLOSE_PROJECT':
        return { ...project, state: 'CLOSED' as ProjectState };
      case 'CANCEL_PROJECT':
        return { ...project, state: 'CANCELLED' as ProjectState };
      default:
        return project;
    }
  });
