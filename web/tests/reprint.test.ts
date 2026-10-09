import test from 'node:test';
import assert from 'node:assert/strict';
import type { Part, Project } from '@/types/index.ts';
import { applyOptimisticPartTransition } from '@/features/projects/context/optimisticTransitions.ts';
import { buildDashboardLanes, getNextAction, getPartCounts, getWorkspaceTabForState } from '@/domain/operations.ts';
import { getCollectionReportRows } from '@/lib/reports/collectionReportXlsx.ts';

const makePart = (id: string): Part => ({
  id,
  partNumber: 1,
  partName: 'Returned plate',
  primaryMaterial: 'PLA',
  primaryBrand: 'Generic',
  primaryOwnFilament: false,
  primaryEstimatedWeight: 20,
  primaryMaterialCost: 10,
  primaryServiceCost: 60,
  specialInstruction: 'Keep the same orientation.',
  checkedBy: 'Reviewer',
  printerName: 'Printer A',
  startedBy: 'Printing staff',
  removedBy: 'Printing staff',
  collectedBy: 'Collection staff',
  collectedByStudentNumber: '12345678',
  collectedAt: '2026-10-01T10:00:00.000Z',
  printStatus: 'COLLECTED',
  printRuns: [{
    id: 1,
    part_id: id,
    project_id: 'RETURN',
    machine_name: 'Printer A',
    started_by: 'Printing staff',
    ended_by: 'Printing staff',
    started_at: '2026-10-01T08:00:00.000Z',
    finished_at: '2026-10-01T09:00:00.000Z',
    outcome: 'PRINTED'
  }]
});

const makeProject = (parts: Part[] = [makePart('returned')]): Project => ({
  id: 'RETURN',
  priorityNumber: 12,
  studentName: 'Test Student',
  studentNumber: '12345678',
  email: 'student@example.com',
  course: 'Test module',
  lecturer: 'Test lecturer',
  needsPayment: true,
  receiptNumber: 'ORIGINAL-RECEIPT',
  state: 'CLOSED',
  archived: true,
  createdAt: '2026-09-01T08:00:00.000Z',
  quoteSnapshot: {
    snapshot_version: 1,
    status: 'ISSUED',
    currency: 'ZAR',
    total_cost: 70,
    generated_at: '2026-09-01T09:00:00.000Z',
    line_summary: []
  },
  parts
});

const returnPart = (project: Project) => applyOptimisticPartTransition([project], {
  projectId: project.id,
  partId: 'returned',
  action: 'RETURN_FOR_REPRINT',
  technicianName: 'Returns staff'
})[0];

test('a collected return reopens an archived project in the normal swimlane', () => {
  const before = makeProject();
  const after = returnPart(before);
  const part = after.parts[0];

  assert.equal(after.state, 'IN_PRODUCTION');
  assert.equal(after.archived, false);
  assert.equal(part.printStatus, 'READY');
  for (const field of ['printerName', 'startedBy', 'removedBy', 'collectedBy', 'collectedByStudentNumber', 'collectedAt'] as const) {
    assert.equal(part[field], undefined);
  }
  assert.deepEqual(buildDashboardLanes([after]).readyToPrint, [after]);
  assert.equal(getWorkspaceTabForState(after.state), 'production');
  assert.equal(getNextAction(after), 'Start queued parts');
  assert.equal(getPartCounts(after).collected, 0);
  assert.deepEqual(getCollectionReportRows([after], '2026-10'), []);
  assert.equal(before.state, 'CLOSED');
  assert.equal(before.parts[0].printStatus, 'COLLECTED');
});

test('returning one part preserves other collections, payment, quote, priority and completed runs', () => {
  const before = makeProject([makePart('returned'), makePart('kept')]);
  const after = returnPart(before);

  assert.strictEqual(after.parts[1], before.parts[1]);
  assert.strictEqual(after.parts[0].printRuns, before.parts[0].printRuns);
  assert.strictEqual(after.quoteSnapshot, before.quoteSnapshot);
  assert.equal(after.receiptNumber, 'ORIGINAL-RECEIPT');
  assert.equal(after.priorityNumber, 12);
  assert.equal(after.parts[0].checkedBy, 'Reviewer');
  assert.equal(after.parts[0].primaryEstimatedWeight, 20);
  assert.equal(after.parts[0].specialInstruction, 'Keep the same orientation.');
  assert.equal(getPartCounts(after).collected, 1);
  assert.equal(getCollectionReportRows([after], '2026-10').length, 1);
  assert.equal(buildDashboardLanes([after]).readyToPrint.length, 1);
});

test('a reprint uses the standard start and finish actions with a new attempt', () => {
  const returned = returnPart(makeProject([makePart('returned'), makePart('kept')]));
  const started = applyOptimisticPartTransition([returned], {
    projectId: returned.id,
    partId: 'returned',
    action: 'START_PRINT',
    technicianName: 'Printing staff',
    machineName: 'Printer B'
  })[0];
  assert.equal(buildDashboardLanes([started]).printing.length, 1);
  assert.equal(started.parts[0].printRuns?.length, 2);
  assert.deepEqual(started.parts[0].printRuns?.[1], returned.parts[0].printRuns?.[0]);

  const finished = applyOptimisticPartTransition([started], {
    projectId: started.id,
    partId: 'returned',
    action: 'FINISH_PRINT',
    technicianName: 'Printing staff'
  })[0];
  assert.equal(finished.state, 'IN_PRODUCTION');
  assert.equal(finished.parts[0].printStatus, 'PRINTED');
  assert.equal(getNextAction(finished), 'Move to collection');
  assert.equal(finished.parts[1].printStatus, 'COLLECTED');
});

test('parts waiting in collection can also be sent back for reprint', () => {
  for (const printStatus of ['PRINTED', 'POST_PROCESSING'] as const) {
    const before = makeProject([{ ...makePart('returned'), printStatus }]);
    before.state = 'READY_FOR_COLLECTION';
    const after = returnPart(before);
    assert.equal(after.parts[0].printStatus, 'READY');
    assert.equal(buildDashboardLanes([after]).readyToPrint.length, 1);
  }
});
