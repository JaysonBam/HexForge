import JSZip from 'jszip';
import type { Part, PrintRun, Project } from '../types';
import { filamentSourceLabel, getPartFilamentSource } from '../domain/filamentSource.ts';

export const COLLECTION_REPORT_COLUMNS = [
  'Timestamp:',
  'Who started (printed) the project?',
  'Print started on:',
  'Student Number:',
  'Student Name & Surname:',
  'Module Code [eg: XXX 123]:',
  'Lecturer/Supervisor:',
  'Project Name:',
  'Printer:',
  'Primary Material:',
  'Primary Material Brand:',
  'Primary Grams (g):',
  'Primary filament Length (m):',
  'Primary filament used was:',
  'Secondary Material:',
  'Secondary Brand:',
  'Secondary Grams (g):',
  'Secondary filament used was:',
  'Secondary filament Length (m):',
  'Time to Print:',
  'Total Material Cost (R):',
  'Total Service Cost (R):',
  'Receipt Required?:',
  'Receipt Number:',
  'Staff member assisted in Collection:'
] as const;

type CollectionReportValue = string | number | Date | null;

export type CollectionReportRow = Record<typeof COLLECTION_REPORT_COLUMNS[number], CollectionReportValue>;

const DATE_COLUMN_INDEXES = new Set([0, 2]);
const NUMBER_COLUMN_INDEXES = new Set([11, 12, 16, 18, 20, 21]);
const CURRENCY_COLUMN_INDEXES = new Set([20, 21]);
const COLUMN_WIDTHS = [
  22, 30, 22, 18, 28, 24, 28, 30, 22, 20, 24, 18, 24,
  28, 20, 22, 18, 28, 26, 18, 22, 22, 22, 18, 34
];

const escapeXml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const toExcelSerialDate = (date: Date) =>
  (Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours(), date.getMinutes(), date.getSeconds()) -
    Date.UTC(1899, 11, 30)) / 86400000;

const columnName = (index: number) => {
  let name = '';
  let column = index + 1;

  while (column > 0) {
    const remainder = (column - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    column = Math.floor((column - 1) / 26);
  }

  return name;
};

const parseDate = (value?: string | null) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const latestPrintedRun = (part: Part): PrintRun | undefined =>
  [...(part.printRuns ?? [])]
    .filter((run) => run.outcome === 'PRINTED' || Boolean(run.finished_at))
    .sort((a, b) => (b.finished_at || b.started_at || '').localeCompare(a.finished_at || a.started_at || ''))[0];

export const getPartCollectionTimestamp = (project: Project, part: Part) =>
  parseDate(part.collectedAt) ?? parseDate(latestPrintedRun(part)?.finished_at) ?? parseDate(project.createdAt);

const isInMonth = (date: Date, monthValue: string) => {
  const [year, month] = monthValue.split('-').map(Number);
  return date.getFullYear() === year && date.getMonth() === month - 1;
};

const numberOrNull = (value?: number) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const billableGrams = (roundedGrams?: number, measuredGrams?: number) =>
  numberOrNull(roundedGrams) ?? (
    numberOrNull(measuredGrams) === null ? null : Math.round(numberOrNull(measuredGrams) as number)
  );

const latestRunStartedAt = (part: Part) =>
  parseDate(latestPrintedRun(part)?.started_at ?? part.printRuns?.[0]?.started_at);

const latestRunStartedBy = (part: Part) =>
  latestPrintedRun(part)?.started_by || part.printRuns?.[0]?.started_by || part.startedBy || '';

const latestRunPrinter = (part: Part) =>
  part.printerName || latestPrintedRun(part)?.machine_name || part.printRuns?.[0]?.machine_name || '';

const filamentSource = (source: unknown, legacyOwnFilament?: boolean) =>
  filamentSourceLabel(getPartFilamentSource(source, legacyOwnFilament));

const receiptRequiredLabel = (project: Project) => {
  if (project.moduleOrLecturerPays) return 'Paid by Lecturer';
  return project.needsPayment ? 'Yes' : 'No';
};

export const getCollectionReportRows = (projects: Project[], monthValue: string): CollectionReportRow[] =>
  projects.flatMap((project) =>
    project.parts
      .filter((part) => part.printStatus === 'COLLECTED')
      .map((part) => ({ project, part, collectedAt: getPartCollectionTimestamp(project, part) }))
      .filter((entry): entry is { project: Project; part: Part; collectedAt: Date } =>
        Boolean(entry.collectedAt) && isInMonth(entry.collectedAt as Date, monthValue)
      )
      .map(({ project, part, collectedAt }) => {
        const primaryMaterialCost = numberOrNull(part.primaryMaterialCost) ?? 0;
        const secondaryMaterialCost = numberOrNull(part.secondaryMaterialCost) ?? 0;
        const primaryServiceCost = numberOrNull(part.primaryServiceCost) ?? 0;
        const secondaryServiceCost = numberOrNull(part.secondaryServiceCost) ?? 0;

        return {
          'Timestamp:': collectedAt,
          'Who started (printed) the project?': latestRunStartedBy(part),
          'Print started on:': latestRunStartedAt(part),
          'Student Number:': project.studentNumber || '',
          'Student Name & Surname:': project.studentName || '',
          'Module Code [eg: XXX 123]:': project.course || '',
          'Lecturer/Supervisor:': project.lecturer || '',
          'Project Name:': part.partName || project.printLabel || project.id,
          'Printer:': latestRunPrinter(part),
          'Primary Material:': part.primaryMaterial || '',
          'Primary Material Brand:': part.primaryBrand || '',
          'Primary Grams (g):': billableGrams(part.primaryEstimatedWeight, part.primaryWeight),
          'Primary filament Length (m):': numberOrNull(part.primaryLength),
          'Primary filament used was:': filamentSource(part.primaryFilamentSource, part.primaryOwnFilament),
          'Secondary Material:': part.secondaryMaterial || '',
          'Secondary Brand:': part.secondaryBrand || '',
          'Secondary Grams (g):': part.secondaryMaterial
            ? billableGrams(part.secondaryEstimatedWeight, part.secondaryWeight)
            : null,
          'Secondary filament used was:': part.secondaryMaterial
            ? filamentSource(part.secondaryFilamentSource, part.secondaryOwnFilament)
            : '',
          'Secondary filament Length (m):': numberOrNull(part.secondaryLength),
          'Time to Print:': part.printingTime || '',
          'Total Material Cost (R):': primaryMaterialCost + secondaryMaterialCost,
          'Total Service Cost (R):': primaryServiceCost + secondaryServiceCost,
          'Receipt Required?:': receiptRequiredLabel(project),
          'Receipt Number:': project.receiptNumber?.trim() || '0',
          'Staff member assisted in Collection:': part.collectedBy || ''
        };
      })
  );

const cellXml = (value: CollectionReportValue, rowIndex: number, columnIndex: number, isHeader = false) => {
  const ref = `${columnName(columnIndex)}${rowIndex}`;

  if (value === null || value === '') {
    return `<c r="${ref}" s="0"/>`;
  }

  if (value instanceof Date) {
    return `<c r="${ref}" s="2"><v>${toExcelSerialDate(value)}</v></c>`;
  }

  if (typeof value === 'number') {
    const styleId = CURRENCY_COLUMN_INDEXES.has(columnIndex) ? 4 : 3;
    return `<c r="${ref}" s="${styleId}"><v>${value}</v></c>`;
  }

  const styleId = isHeader ? 1 : NUMBER_COLUMN_INDEXES.has(columnIndex) ? 3 : DATE_COLUMN_INDEXES.has(columnIndex) ? 2 : 0;
  return `<c r="${ref}" s="${styleId}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`;
};

const worksheetXml = (rows: CollectionReportRow[]) => {
  const totalRows = rows.length + 1;
  const totalColumns = COLLECTION_REPORT_COLUMNS.length;
  const lastCell = `${columnName(totalColumns - 1)}${totalRows}`;
  const columns = COLUMN_WIDTHS.map((width, index) =>
    `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`
  ).join('');
  const header = `<row r="1" ht="24" customHeight="1">${COLLECTION_REPORT_COLUMNS
    .map((column, index) => cellXml(column, 1, index, true))
    .join('')}</row>`;
  const body = rows
    .map((row, rowOffset) => {
      const excelRow = rowOffset + 2;
      const cells = COLLECTION_REPORT_COLUMNS
        .map((column, columnIndex) => cellXml(row[column], excelRow, columnIndex))
        .join('');
      return `<row r="${excelRow}">${cells}</row>`;
    })
    .join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <dimension ref="A1:${lastCell}"/>
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="18"/>
  <cols>${columns}</cols>
  <sheetData>${header}${body}</sheetData>
  <autoFilter ref="A1:${lastCell}"/>
  <pageMargins left="0.25" right="0.25" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>
</worksheet>`;
};

const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="3">
    <numFmt numFmtId="164" formatCode="yyyy-mm-dd hh:mm"/>
    <numFmt numFmtId="165" formatCode="0.00"/>
    <numFmt numFmtId="166" formatCode="R #,##0.00"/>
  </numFmts>
  <fonts count="2">
    <font><sz val="11"/><name val="Aptos"/></font>
    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Aptos"/></font>
  </fonts>
  <fills count="3">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF0F172A"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border><left style="thin"><color rgb="FFCBD5E1"/></left><right style="thin"><color rgb="FFCBD5E1"/></right><top style="thin"><color rgb="FFCBD5E1"/></top><bottom style="thin"><color rgb="FFCBD5E1"/></bottom><diagonal/></border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="5">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFill="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
    <xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
    <xf numFmtId="166" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
  <dxfs count="0"/>
  <tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>
</styleSheet>`;

export const buildCollectionReportXlsx = async (rows: CollectionReportRow[]) => {
  const zip = new JSZip();
  const createdAt = new Date().toISOString();

  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`);
  zip.folder('_rels')?.file('.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`);
  zip.folder('docProps')?.file('app.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>HexForge</Application>
</Properties>`);
  zip.folder('docProps')?.file('core.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:creator>HexForge</dc:creator>
  <cp:lastModifiedBy>HexForge</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${createdAt}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${createdAt}</dcterms:modified>
</cp:coreProperties>`);
  zip.folder('xl')?.file('workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Collected Parts" sheetId="1" r:id="rId1"/></sheets>
</workbook>`);
  zip.folder('xl')?.folder('_rels')?.file('workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`);
  zip.folder('xl')?.file('styles.xml', stylesXml);
  zip.folder('xl')?.folder('worksheets')?.file('sheet1.xml', worksheetXml(rows));

  return zip.generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });
};

export const downloadCollectionReportXlsx = async (rows: CollectionReportRow[], monthValue: string) => {
  const blob = await buildCollectionReportXlsx(rows);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = `collected-parts-report-${monthValue}.xlsx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};
