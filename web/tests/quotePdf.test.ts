import assert from 'node:assert/strict';
import test from 'node:test';
import { decodePDFRawStream, PDFArray, PDFDocument, PDFRawStream } from 'pdf-lib';
import { createQuotePdfBytes, type QuotePdfLine } from '@/lib/reports/quotePdf.ts';
import type { QuoteContactSettings } from '@/domain/environmentSettings.ts';
import type { Project } from '@/types/index.ts';

const project: Project = {
  id: 'quote-pagination',
  priorityNumber: 42,
  studentName: 'Example Student',
  studentNumber: '12345678',
  email: 'student@example.com',
  course: 'EPR 400',
  lecturer: 'Example Lecturer',
  needsPayment: true,
  state: 'QUOTE',
  parts: [],
  createdAt: '2026-10-22T00:00:00.000Z',
  archived: false
};

const quoteSettings: QuoteContactSettings = {
  supportEmail: 'printing@example.com',
  quoteEmail: 'printing@example.com',
  organizationName: 'Example University',
  serviceName: '3D Printing Services',
  locationName: 'Printing Lab',
  addressLines: ['Engineering Building', 'Example Campus', 'South Africa'],
  phone: '012 555 0100',
  paymentInstructions: '',
  costCentreAccount: 'PRINT-123',
  collectionLocation: 'Printing Lab'
};

const makeLines = (count: number): QuotePdfLine[] => Array.from({ length: count }, (_, index) => ({
  partNumber: index + 1,
  partName: `Bracket ${String(index + 1).padStart(3, '0')}`,
  materials: ['PLA', 'PETG'],
  weights: ['20g', '5g'],
  costs: ['R 60.00', 'R 15.00']
}));

type PrintedText = { text: string; x: number; y: number };

// Inspect the saved PDF's text and positions, including every content stream.
const readPages = async (lines: QuotePdfLine[]) => {
  const bytes = await createQuotePdfBytes({
    project,
    totalCost: 1500,
    lines,
    filaments: [{ id: 'pla', type: 'PLA', pricePerGram: 3 }],
    providedFilamentPricePerGram: 2,
    quoteSettings
  });
  const document = await PDFDocument.load(bytes);
  return document.getPages().map((page) => {
    const contents = page.node.Contents();
    const streams = contents instanceof PDFArray
      ? contents.asArray().map((ref) => document.context.lookup(ref, PDFRawStream))
      : contents instanceof PDFRawStream ? [contents] : [];
    const text: PrintedText[] = [];
    for (const stream of streams) {
      const operators = Buffer.from(decodePDFRawStream(stream).decode()).toString('latin1');
      for (const [, block] of operators.matchAll(/BT\s([\s\S]*?)\sET/g)) {
        const position = block.match(/1 0 0 1 ([\d.-]+) ([\d.-]+) Tm/);
        const value = block.match(/<([\dA-Fa-f]*)> Tj/);
        assert.ok(position && value, 'expected positioned standard-font text');
        text.push({ text: Buffer.from(value[1], 'hex').toString('latin1'), x: Number(position[1]), y: Number(position[2]) });
      }
    }
    return text;
  });
};

test('20 multi-material parts all appear once across pages with their part numbers', async () => {
  const lines = makeLines(20);
  const pages = await readPages(lines);
  assert.ok(pages.length > 1);
  const all = pages.flat();
  lines.forEach((line) => {
    const matches = all.filter(({ text }) => text === line.partName);
    assert.equal(matches.length, 1, `${line.partName} must appear exactly once`);
    const page = pages.find((items) => items.includes(matches[0]))!;
    assert.ok(page.some(({ text, x, y }) => text === String(line.partNumber) && x < 80 && y === matches[0].y));
    assert.ok(page.some(({ text, y }) => text === 'PETG' && y === matches[0].y - 12));
  });
  pages.forEach((page, index) => {
    for (const heading of ['#', 'Part Name', 'Material', 'Weight', 'Cost']) {
      assert.equal(page.filter(({ text }) => text === heading).length, 1);
    }
    assert.ok(page.some(({ text }) => text === `Page ${index + 1} of ${pages.length}`));
    if (index < pages.length - 1) {
      assert.ok(!page.some(({ text }) => text === 'Total Cost' || text.includes('acceptance of the quote')));
      assert.ok(page.some(({ text }) => text === 'Continued on next page'));
    }
  });
  assert.equal(all.filter(({ text }) => text === 'Total Cost').length, 1);
  assert.ok(pages.at(-1)!.some(({ text }) => text === 'R 1500.00'));
  assert.ok(pages.at(-1)!.some(({ text }) => text.includes('acceptance of the quote')));
  assert.equal(all.filter(({ text }) => text === 'PLA').length, 20);
  assert.equal(all.filter(({ text }) => text === 'PETG').length, 20);
  all.filter(({ text }) => /^(Bracket|PLA$|PETG$|20g$|5g$)/.test(text)).forEach(({ y }) => assert.ok(y >= 54));
  const firstPageMaterials = pages[0].filter(({ text }) => text === 'PETG');
  assert.ok(Math.min(...firstPageMaterials.map(({ y }) => y)) < 100, 'page one should use the space down to the bottom margin');
  const finalPage = pages.at(-1)!;
  const total = finalPage.find(({ text }) => text === 'Total Cost')!;
  const paymentNotice = finalPage.find(({ text }) => text.includes('acceptance of the quote'))!;
  assert.equal(total.y - paymentNotice.y, 40, 'payment details should follow the total without a large blank gap');
});

test('short and empty quotes stay on one page; supplied part numbers are preserved', async () => {
  const lines = makeLines(2);
  lines[0].partNumber = 7;
  delete lines[1].partNumber;
  const pages = await readPages(lines);
  assert.equal(pages.length, 1);
  assert.ok(pages[0].some(({ text, x }) => text === '7' && x < 80));
  assert.ok(pages[0].some(({ text, x }) => text === '2' && x < 80));
  const empty = await readPages([]);
  assert.equal(empty.length, 1);
  assert.ok(empty[0].some(({ text }) => text === 'Total Cost'));
});

test('wrapped names and large quotes retain every row without overlapping the footer', async () => {
  const lines = makeLines(100).map((line) => ({ ...line, partName: `${line.partName} with an extended descriptive name for wrapping` }));
  const pages = await readPages(lines);
  const all = pages.flat();
  assert.ok(pages.length > 3);
  for (const line of lines) {
    const name = line.partName.split(' with ')[0];
    assert.equal(all.filter(({ text }) => text.startsWith(name)).length, 1);
  }
  all.filter(({ x, text }) => x === 80 && text !== 'Part Name').forEach(({ y }) => assert.ok(y >= 54));
  assert.equal(all.filter(({ text }) => text === 'Total Cost').length, 1);
});

test('a single part taller than a page continues without dropping material lines', async () => {
  const lines = [{
    partNumber: 3,
    partName: 'Large multi-material part',
    materials: Array.from({ length: 100 }, (_, index) => `Material ${index + 1}`),
    weights: Array(100).fill('1g'),
    costs: Array(100).fill('R 3.00')
  }];
  const pages = await readPages(lines);
  const all = pages.flat();
  for (const material of lines[0].materials) {
    assert.equal(all.filter(({ text }) => text === material).length, 1);
  }
  all.filter(({ text }) => text.startsWith('Material ')).forEach(({ y }) => assert.ok(y >= 54));
  assert.ok(pages.at(-1)!.find(({ text }) => text === 'Material 100')!.y >= 244);
  assert.equal(all.filter(({ text }) => text === 'Total Cost').length, 1);
});

test('the final part stays with the total when the payment details need another page', async () => {
  const lines = makeLines(14);
  const pages = await readPages(lines);
  assert.equal(pages.length, 2);
  const finalPage = pages.at(-1)!;
  assert.ok(finalPage.some(({ text }) => text === lines.at(-1)!.partName));
  assert.ok(finalPage.some(({ text }) => text === 'Total Cost'));
  assert.ok(finalPage.some(({ text }) => text.includes('acceptance of the quote')));
  assert.ok(Math.min(...pages[0].filter(({ text }) => text === 'PETG').map(({ y }) => y)) < 244);
});
