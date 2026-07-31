import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDashboardLanes,
  getStudentEmail,
  getPaymentLabel,
  getNextAction,
  getProjectBlockers,
  getWorkspaceTabForState,
  isCollectionBlocked,
  isValidStudentNumber,
  isPaymentBlocked
} from '../src/domain/operations.ts';
import { buildLiveQuoteLineSummary, compareQuoteSnapshot } from '../src/domain/quoteState.ts';

const baseProject = {
  id: 'ABCDE',
  priorityNumber: 1,
  studentName: 'Student One',
  studentNumber: '12345678',
  course: 'EPR 400',
  lecturer: 'Dr Smith',
  needsPayment: true,
  moduleOrLecturerPays: false,
  receiptNumber: '',
  paymentNote: '',
  paymentOverrideNote: '',
  state: 'AWAITING_PAYMENT',
  parts: [
    {
      id: 'part-1',
      partNumber: 1,
      partName: 'Plate 1',
      primaryMaterial: 'PLA',
      primaryBrand: 'Generic',
      primaryOwnFilament: false,
      specialInstruction: '',
      primaryEstimatedWeight: 20,
      primaryMaterialCost: 0,
      primaryServiceCost: 60,
      printStatus: 'READY'
    }
  ],
  createdAt: '2026-01-01T00:00:00.000Z',
  archived: false
};

test('payment gate labels blocked student-paid projects clearly', () => {
  assert.equal(isPaymentBlocked(baseProject), true);
  assert.equal(getPaymentLabel(baseProject), 'Payment required');
  assert.deepEqual(getProjectBlockers(baseProject), ['Payment gate not cleared']);
});

test('module-paid projects are not treated as blocked', () => {
  const project = { ...baseProject, moduleOrLecturerPays: true };

  assert.equal(isPaymentBlocked(project), false);
  assert.equal(getPaymentLabel(project), 'Covered by module/lecturer');
  assert.deepEqual(getProjectBlockers(project), []);
});

test('draft parts with stale verifier names still block review', () => {
  const project = {
    ...baseProject,
    state: 'REVIEW',
    parts: [
      {
        ...baseProject.parts[0],
        printStatus: 'DRAFT',
        checkedBy: 'Old Technician'
      }
    ]
  };

  assert.deepEqual(getProjectBlockers(project), ['1 part not verified']);
});

test('dashboard lanes put pre-production work into the to-be-confirmed lane', () => {
  const lanes = buildDashboardLanes([baseProject]);

  assert.equal(lanes.toBeConfirmed.length, 1);
  assert.equal(lanes.readyToPrint.length, 0);
  assert.equal(lanes.printing.length, 0);
});

test('dashboard lanes keep started production work in printing even without an active print', () => {
  const project = {
    ...baseProject,
    state: 'IN_PRODUCTION',
    parts: [
      {
        ...baseProject.parts[0],
        printStatus: 'PRINTED'
      },
      {
        ...baseProject.parts[0],
        id: 'part-2',
        partNumber: 2,
        partName: 'Plate 2',
        printStatus: 'READY'
      }
    ]
  };

  const lanes = buildDashboardLanes([project]);

  assert.equal(lanes.toBeConfirmed.length, 0);
  assert.equal(lanes.readyToPrint.length, 0);
  assert.equal(lanes.printing.length, 1);
});

test('dashboard lanes keep fully completed production work in printing until collection is released', () => {
  const project = {
    ...baseProject,
    state: 'IN_PRODUCTION',
    parts: [
      {
        ...baseProject.parts[0],
        printStatus: 'PRINTED'
      },
      {
        ...baseProject.parts[0],
        id: 'part-2',
        partNumber: 2,
        partName: 'Plate 2',
        printStatus: 'POST_PROCESSING'
      }
    ]
  };

  const lanes = buildDashboardLanes([project]);

  assert.equal(lanes.toBeConfirmed.length, 0);
  assert.equal(lanes.readyToPrint.length, 0);
  assert.equal(lanes.printing.length, 1);
});

test('dashboard lanes keep all-queued production work in ready to print until a part has actually started', () => {
  const project = {
    ...baseProject,
    state: 'IN_PRODUCTION',
    parts: [
      {
        ...baseProject.parts[0],
        printStatus: 'READY'
      },
      {
        ...baseProject.parts[0],
        id: 'part-2',
        partNumber: 2,
        partName: 'Plate 2',
        printStatus: 'VERIFIED'
      }
    ]
  };

  const lanes = buildDashboardLanes([project]);

  assert.equal(lanes.toBeConfirmed.length, 0);
  assert.equal(lanes.readyToPrint.length, 1);
  assert.equal(lanes.printing.length, 0);
});

test('dashboard lanes use part progress to keep started work in printing even if the project state lags behind', () => {
  const project = {
    ...baseProject,
    state: 'READY_FOR_PRINTING',
    parts: [
      {
        ...baseProject.parts[0],
        printStatus: 'PRINTED'
      },
      {
        ...baseProject.parts[0],
        id: 'part-2',
        partNumber: 2,
        partName: 'Plate 2',
        printStatus: 'READY'
      }
    ]
  };

  const lanes = buildDashboardLanes([project]);

  assert.equal(lanes.toBeConfirmed.length, 0);
  assert.equal(lanes.readyToPrint.length, 0);
  assert.equal(lanes.printing.length, 1);
});

test('collection stays blocked if a required receipt number is later cleared', () => {
  const project = {
    ...baseProject,
    state: 'READY_FOR_COLLECTION',
    receiptNumber: 'ABC123'
  };

  assert.equal(isPaymentBlocked(project), false);

  const overwrittenReceiptProject = {
    ...project,
    receiptNumber: '   '
  };

  assert.equal(isPaymentBlocked(overwrittenReceiptProject), true);
  assert.deepEqual(getProjectBlockers(overwrittenReceiptProject), ['Payment gate not cleared']);
  assert.equal(getNextAction(overwrittenReceiptProject), 'Collect finished parts');
});

test('collection requires a receipt number even when a payment override exists', () => {
  const project = {
    ...baseProject,
    state: 'READY_FOR_COLLECTION',
    paymentOverrideNote: 'Approved to start printing before receipt arrived.'
  };

  assert.equal(isPaymentBlocked(project), false);
  assert.equal(isCollectionBlocked(project), true);
});

test('workspace opens on the task tab for the current state', () => {
  assert.equal(getWorkspaceTabForState('REVIEW'), 'parts');
  assert.equal(getWorkspaceTabForState('QUOTE'), 'quote');
  assert.equal(getWorkspaceTabForState('IN_PRODUCTION'), 'production');
  assert.equal(getWorkspaceTabForState('READY_FOR_COLLECTION'), 'collection');
});

test('quote next action reflects whether a snapshot exists', () => {
  const quoteProject = {
    ...baseProject,
    state: 'QUOTE',
    parts: [
      {
        ...baseProject.parts[0],
        primaryServiceCost: 60,
        secondaryServiceCost: 0
      }
    ]
  };

  const issuedSnapshot = {
    snapshot_version: 1,
    status: 'ISSUED' as const,
    currency: 'ZAR',
    total_cost: 75,
    generated_at: '2026-01-01T00:00:00.000Z',
    line_summary: buildLiveQuoteLineSummary(
      quoteProject,
      (part) => part.primaryServiceCost,
      (part) => part.secondaryServiceCost || 0
    )
  };

  assert.equal(getNextAction({ ...quoteProject, quoteSnapshot: undefined }), 'Make initial quote');
  assert.equal(getNextAction({ ...quoteProject, quoteSnapshot: issuedSnapshot }), 'Review quote');
});

test('student numbers must be exactly eight digits', () => {
  assert.equal(isValidStudentNumber('12345678'), true);
  assert.equal(isValidStudentNumber('1234567'), false);
  assert.equal(isValidStudentNumber('123456789'), false);
  assert.equal(isValidStudentNumber('u1234567'), false);
  assert.equal(isValidStudentNumber('1234 5678'), false);
  assert.equal(isValidStudentNumber('1234-5678'), false);
  assert.equal(getStudentEmail('12345678'), 'u12345678@tuks.co.za');
  assert.equal(getStudentEmail('u1234567'), '');
});

test('quote comparison reports when no issued snapshot exists', () => {
  const comparison = compareQuoteSnapshot(
    baseProject,
    undefined,
    (part) => part.primaryServiceCost,
    (part) => part.secondaryServiceCost || 0
  );

  assert.equal(comparison.status, 'no_quote');
  assert.equal(comparison.hasSnapshot, false);
  assert.equal(comparison.differences.length, 0);
});

test('quote comparison reports an up-to-date issued snapshot', () => {
  const quoteProject = {
    ...baseProject,
    parts: [
      {
        ...baseProject.parts[0],
        primaryServiceCost: 60,
        secondaryServiceCost: 0
      }
    ]
  };

  const issuedSnapshot = {
    snapshot_version: 1,
    status: 'ISSUED' as const,
    currency: 'ZAR',
    total_cost: 60,
    generated_at: '2026-01-01T00:00:00.000Z',
    line_summary: buildLiveQuoteLineSummary(
      quoteProject,
      (part) => part.primaryServiceCost,
      (part) => part.secondaryServiceCost || 0
    )
  };

  const comparison = compareQuoteSnapshot(
    quoteProject,
    issuedSnapshot,
    (part) => part.primaryServiceCost,
    (part) => part.secondaryServiceCost || 0
  );

  assert.equal(comparison.status, 'up_to_date');
  assert.equal(comparison.hasSnapshot, true);
  assert.deepEqual(comparison.differences, []);
});

test('quote comparison reports weight-only changes with part numbers', () => {
  const issuedProject = {
    ...baseProject,
    parts: [
      {
        ...baseProject.parts[0],
        secondaryMaterial: 'PETG',
        secondaryEstimatedWeight: 5,
        primaryServiceCost: 60,
        secondaryServiceCost: 15
      }
    ]
  };

  const issuedSnapshot = {
    snapshot_version: 1,
    status: 'ISSUED' as const,
    currency: 'ZAR',
    total_cost: 60,
    generated_at: '2026-01-01T00:00:00.000Z',
    line_summary: buildLiveQuoteLineSummary(
      issuedProject,
      (part) => part.primaryServiceCost,
      (part) => part.secondaryServiceCost || 0
    )
  };

  const updatedProject = {
    ...issuedProject,
    parts: [
      {
        ...issuedProject.parts[0],
        primaryEstimatedWeight: 28,
        secondaryEstimatedWeight: 7
      }
    ]
  };

  const comparison = compareQuoteSnapshot(
    updatedProject,
    issuedSnapshot,
    (part) => part.primaryServiceCost,
    (part) => part.secondaryServiceCost || 0
  );

  assert.equal(comparison.status, 'outdated');
  assert.equal(comparison.hasSnapshot, true);
  assert.ok(comparison.differences.some((difference) => difference.startsWith('Part 1:')));
  assert.ok(comparison.differences.some((difference) => difference.includes('primary weight 20g -> 28g')));
  assert.ok(comparison.differences.some((difference) => difference.includes('secondary weight 5g -> 7g')));
  assert.ok(comparison.differences.every((difference) => !difference.includes('Cost')));
  assert.ok(comparison.differences.every((difference) => !difference.includes('Plate 1')));
});

test('quote comparison reports filament source changes', () => {
  const issuedProject = {
    ...baseProject,
    parts: [
      {
        ...baseProject.parts[0],
        primaryFilamentSource: 'student_provided' as const,
        primaryOwnFilament: true,
        primaryServiceCost: 20
      }
    ]
  };

  const issuedSnapshot = {
    snapshot_version: 1,
    status: 'ISSUED' as const,
    currency: 'ZAR',
    total_cost: 20,
    generated_at: '2026-01-01T00:00:00.000Z',
    line_summary: buildLiveQuoteLineSummary(
      issuedProject,
      (part) => part.primaryServiceCost,
      (part) => part.secondaryServiceCost || 0
    )
  };

  const updatedProject = {
    ...issuedProject,
    parts: [
      {
        ...issuedProject.parts[0],
        primaryFilamentSource: 'module_provided' as const,
        primaryOwnFilament: true
      }
    ]
  };

  const comparison = compareQuoteSnapshot(
    updatedProject,
    issuedSnapshot,
    (part) => part.primaryServiceCost,
    (part) => part.secondaryServiceCost || 0
  );

  assert.equal(comparison.status, 'outdated');
  assert.ok(comparison.differences.some((difference) =>
    difference.includes('primary source Student-provided filament -> Module-provided filament')
  ));
});
