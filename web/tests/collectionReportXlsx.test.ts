import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import type { Project } from '../src/types/index.ts';
import {
  buildCollectionReportXlsx,
  COLLECTION_REPORT_COLUMNS,
  getCollectionReportRows
} from '../src/utils/collectionReportXlsx.ts';

const collectedProject: Project = {
  id: 'ABCDE',
  priorityNumber: 1,
  studentName: 'Student One',
  studentNumber: '12345678',
  email: 'student@example.com',
  course: 'EPR 400',
  lecturer: 'Dr Smith',
  needsPayment: true,
  moduleOrLecturerPays: true,
  receiptNumber: '',
  state: 'CLOSED',
  parts: [
    {
      id: 'part-1',
      partNumber: 1,
      partName: 'Plate A',
      printerName: 'Bambu A1',
      primaryMaterial: 'PLA',
      primaryBrand: 'Brand A',
      primaryFilamentSource: 'misc',
      primaryOwnFilament: false,
      primaryWeight: 20.5,
      primaryEstimatedWeight: 21,
      primaryLength: 6.2,
      primaryMaterialCost: 12.34,
      primaryServiceCost: 63,
      secondaryMaterial: 'PETG',
      secondaryBrand: 'Brand B',
      secondaryFilamentSource: 'module_provided',
      secondaryOwnFilament: true,
      secondaryWeight: 5.4,
      secondaryEstimatedWeight: 5,
      secondaryLength: 1.5,
      secondaryMaterialCost: 2.5,
      secondaryServiceCost: 10,
      specialInstruction: '',
      printingTime: '02:15',
      checkedBy: 'Reviewer',
      startedBy: 'Printer Staff',
      collectedBy: 'Collection Staff',
      collectedAt: '2026-05-15T10:30:00.000Z',
      printStatus: 'COLLECTED',
      printRuns: [
        {
          id: 1,
          part_id: 'part-1',
          project_id: 'ABCDE',
          machine_name: 'Bambu A1',
          started_by: 'Printer Staff',
          started_at: '2026-05-15T08:00:00.000Z',
          finished_at: '2026-05-15T10:15:00.000Z',
          outcome: 'PRINTED'
        }
      ]
    }
  ],
  createdAt: '2026-05-01T00:00:00.000Z',
  archived: false
};

test('collection report rows use the requested column order and one collected part per row', () => {
  const rows = getCollectionReportRows([collectedProject], '2026-05');

  assert.equal(rows.length, 1);
  assert.deepEqual(Object.keys(rows[0]), [...COLLECTION_REPORT_COLUMNS]);
  assert.equal(rows[0]['Project Name:'], 'Plate A');
  assert.equal(rows[0]['Receipt Required?:'], 'Paid by Lecturer');
  assert.equal(rows[0]['Receipt Number:'], '0');
  assert.equal(rows[0]['Primary filament used was:'], 'Misc filament');
  assert.equal(rows[0]['Secondary filament used was:'], 'Module-provided filament');
  assert.equal(rows[0]['Primary Grams (g):'], 21);
  assert.equal(rows[0]['Secondary Grams (g):'], 5);
  assert.equal(rows[0]['Total Material Cost (R):'], 14.84);
  assert.equal(rows[0]['Total Service Cost (R):'], 73);
  assert.equal(getCollectionReportRows([collectedProject], '2026-06').length, 0);
});

test('collection report workbook is a formatted xlsx package', async () => {
  const rows = getCollectionReportRows([collectedProject], '2026-05');
  const blob = await buildCollectionReportXlsx(rows);
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());

  assert.ok(zip.file('xl/workbook.xml'));
  assert.ok(zip.file('xl/worksheets/sheet1.xml'));
  assert.ok(zip.file('xl/styles.xml'));

  const workbookXml = await zip.file('xl/workbook.xml')?.async('string');
  const worksheetXml = await zip.file('xl/worksheets/sheet1.xml')?.async('string');
  const stylesXml = await zip.file('xl/styles.xml')?.async('string');

  assert.match(workbookXml ?? '', /Collected Parts/);
  assert.match(worksheetXml ?? '', /<autoFilter ref="A1:Y2"\/>/);
  assert.match(worksheetXml ?? '', /<pane ySplit="1"/);
  assert.match(stylesXml ?? '', /R #,##0.00/);
  assert.match(stylesXml ?? '', /FF0F172A/);
});
