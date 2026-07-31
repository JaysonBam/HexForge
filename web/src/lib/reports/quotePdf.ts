import type { Project } from '../types';
import type { PDFFont, PDFPage } from 'pdf-lib';
import {
  quoteContactSettings,
  type QuoteContactSettings
} from '../domain/environmentSettings';
import {
  groupFilamentsByPrice,
  type Filament
} from '../domain/settingsConfig';

export type QuotePdfLine = {
  partName: string;
  materials: string[];
  weights: string[];
  costs: string[];
};

type QuotePdfRequest = {
  project: Project;
  totalCost: number;
  lines: QuotePdfLine[];
  filaments: Filament[];
  providedFilamentPricePerGram: number;
  logo?: QuotePdfImage;
  quoteSettings?: QuoteContactSettings;
};

type QuotePdfImage = {
  bytes: Uint8Array;
  width: number;
  height: number;
};

type QuotePdfFonts = {
  regular: PDFFont;
  bold: PDFFont;
};

const pageWidth = 595;
const pageHeight = 842;
const marginX = 54;
const rightX = 540;
const centerX = pageWidth / 2;
const footerTopY = 190;
const tableBodyLineGap = 12;
const tableBodyRowGap = 11;
const tableBodyTextAscent = 7;
const tableBodyTextDescent = 2;

const drawText = (
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  size: number,
  font: PDFFont
) => {
  page.drawText(text, { x, y, size, font });
};

const drawCenteredText = (page: PDFPage, text: string, y: number, size: number, font: PDFFont) => {
  drawText(page, text, centerX - font.widthOfTextAtSize(text, size) / 2, y, size, font);
};

const drawCenteredWrappedText = (
  page: PDFPage,
  text: string,
  y: number,
  size: number,
  font: PDFFont,
  maxWidth: number,
  lineGap = 14
) => {
  const lines = wrapText(text, font, size, maxWidth);
  lines.forEach((line, index) => drawCenteredText(page, line, y - index * lineGap, size, font));
  return y - lines.length * lineGap;
};

const drawRightText = (page: PDFPage, text: string, x: number, y: number, size: number, font: PDFFont) => {
  drawText(page, text, x - font.widthOfTextAtSize(text, size), y, size, font);
};

const drawRule = (page: PDFPage, y: number) => {
  page.drawLine({
    start: { x: marginX, y },
    end: { x: rightX, y },
    thickness: 1
  });
};

const drawOptionalText = (
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  size: number,
  font: PDFFont
) => {
  if (!text.trim()) return y;
  drawText(page, text, x, y, size, font);
  return y - 12;
};

const drawKeyValueRight = (
  page: PDFPage,
  fonts: QuotePdfFonts,
  label: string,
  value: string,
  y: number,
  size: number
) => {
  drawText(page, label, 400, y, size, fonts.bold);
  drawRightText(page, value, rightX, y, size, fonts.regular);
};

const wrapText = (value: string, font: PDFFont, size: number, maxWidth: number) => {
  const words = value.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';

  words.forEach((word) => {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  });

  if (current) lines.push(current);
  return lines.length > 0 ? lines : [''];
};

const formatFooterCurrency = (value: number) =>
  `R${Number(value || 0).toFixed(2).replace('.', '-')}`;

const drawReceiptInstruction = (
  page: PDFPage,
  fonts: QuotePdfFonts,
  y: number,
  collectionLocation: string
) => {
  const size = 10.2;
  const prefix = 'Please request ';
  const emphasis = 'TWO';
  const suffix = collectionLocation
    ? ` receipts. One will be required at the ${collectionLocation} on collection.`
    : ' receipts. One will be required on collection.';
  const prefixWidth = fonts.regular.widthOfTextAtSize(prefix, size);
  const emphasisWidth = fonts.bold.widthOfTextAtSize(emphasis, size);
  const suffixWidth = fonts.regular.widthOfTextAtSize(suffix, size);
  const startX = centerX - (prefixWidth + emphasisWidth + suffixWidth) / 2;
  const emphasisX = startX + prefixWidth;

  drawText(page, prefix, startX, y, size, fonts.regular);
  drawText(page, emphasis, emphasisX, y, size, fonts.bold);
  page.drawLine({
    start: { x: emphasisX, y: y - 1.5 },
    end: { x: emphasisX + emphasisWidth, y: y - 1.5 },
    thickness: 0.75
  });
  drawText(page, suffix, emphasisX + emphasisWidth, y, size, fonts.regular);
};

export const createQuotePdfBytes = async ({
  project,
  totalCost,
  lines,
  filaments,
  providedFilamentPricePerGram,
  logo,
  quoteSettings = quoteContactSettings
}: QuotePdfRequest) => {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([pageWidth, pageHeight]);
  const contactSettings = quoteSettings;
  const fonts: QuotePdfFonts = {
    regular: await pdfDoc.embedFont(StandardFonts.Helvetica),
    bold: await pdfDoc.embedFont(StandardFonts.HelveticaBold)
  };
  let y = 806;

  if (logo) {
    const logoImage = await pdfDoc.embedJpg(logo.bytes);
    const logoHeight = 50;
    const logoWidth = logoHeight * (logo.width / logo.height);
    page.drawImage(logoImage, {
      x: centerX - logoWidth / 2,
      y: y - logoHeight + 4,
      width: logoWidth,
      height: logoHeight
    });
    y -= 66;
  }

  if (contactSettings.organizationName) {
    drawCenteredText(page, contactSettings.organizationName, y, 16, fonts.bold);
    y -= 20;
  }
  drawCenteredText(page, contactSettings.serviceName, y, 13, fonts.bold);
  y -= 36;

  drawRule(page, y);
  y -= 16;
  if (contactSettings.locationName) {
    drawText(page, contactSettings.locationName, marginX, y, 10, fonts.bold);
  }
  drawKeyValueRight(page, fonts, 'Date:', new Date().toLocaleDateString(), y, 10);
  y -= 13;
  contactSettings.addressLines.forEach((line) => {
    y = drawOptionalText(page, line, marginX, y, 9, fonts.regular);
  });
  drawKeyValueRight(page, fonts, 'Priority Number:', `#${project.priorityNumber}`, y, 9);
  if (contactSettings.phone) {
    drawText(page, contactSettings.phone, marginX, y, 9, fonts.regular);
  }
  y -= 12;
  drawKeyValueRight(page, fonts, 'Module:', project.course || 'N/A', y, 9);
  if (contactSettings.quoteEmail) {
    drawText(page, contactSettings.quoteEmail, marginX, y, 9, fonts.regular);
  }
  y -= 12;
  y -= 20;
  drawRule(page, y);
  y -= 18;

  drawText(page, 'Student Name:', marginX, y, 10, fonts.bold);
  drawText(page, project.studentName, 150, y, 10, fonts.regular);
  y -= 15;
  drawText(page, 'Student Number:', marginX, y, 10, fonts.bold);
  drawText(page, project.studentNumber, 150, y, 10, fonts.regular);
  y -= 30;

  drawRule(page, y + 12);
  drawRule(page, y - 4);
  drawText(page, 'Part Name', marginX, y, 10, fonts.bold);
  drawText(page, 'Material', 275, y, 10, fonts.bold);
  drawRightText(page, 'Weight', 430, y, 10, fonts.bold);
  drawRightText(page, 'Cost', rightX, y, 10, fonts.bold);
  y -= 18;

  let tableBottomRuleY = y + 8;

  lines.forEach((line) => {
    if (y < footerTopY + 54) return;

    const partLines = wrapText(line.partName, fonts.regular, 9, 190);
    const rowLineCount = Math.max(partLines.length, line.materials.length, line.weights.length, line.costs.length, 1);
    const rowStartY = y;

    Array.from({ length: rowLineCount }).forEach((_, index) => {
      const rowY = rowStartY - index * tableBodyLineGap;
      if (rowY < footerTopY + 54) return;
      if (partLines[index]) drawText(page, partLines[index], marginX, rowY, 9, fonts.regular);
      if (line.materials[index]) drawText(page, line.materials[index], 275, rowY, 9, fonts.regular);
      if (line.weights[index]) drawRightText(page, line.weights[index], 430, rowY, 9, fonts.regular);
      if (line.costs[index]) drawRightText(page, line.costs[index], rightX, rowY, 9, fonts.regular);
    });

    const lastRowTextBaselineY = rowStartY - (rowLineCount - 1) * tableBodyLineGap;
    const nextRowBaselineY = rowStartY - rowLineCount * tableBodyLineGap - tableBodyRowGap;
    tableBottomRuleY = (
      lastRowTextBaselineY - tableBodyTextDescent + nextRowBaselineY + tableBodyTextAscent
    ) / 2;
    drawRule(page, tableBottomRuleY);
    y = nextRowBaselineY;
  });

  const totalY = tableBottomRuleY - 18;
  drawRightText(page, 'Total Cost', 430, totalY, 10, fonts.bold);
  drawRightText(page, `R ${totalCost.toFixed(2)}`, rightX, totalY, 10, fonts.bold);

  y = footerTopY;
  drawRule(page, y + 16);
  y -= 12;
  drawCenteredText(page, 'Prints will only be started on acceptance of the quote.', y, 10.5, fonts.regular);
  y -= 28;

  if (contactSettings.costCentreAccount) {
    const label = 'Please make payment into the following Cost Centre Account:';
    const size = 10.2;
    const labelWidth = fonts.regular.widthOfTextAtSize(label, size);
    const boxWidth = 196;
    const boxHeight = 16;
    const gap = 8;
    const startX = centerX - (labelWidth + gap + boxWidth) / 2;
    const boxX = startX + labelWidth + gap;
    drawText(page, label, startX, y, size, fonts.regular);
    page.drawRectangle({
      x: boxX,
      y: y - 5,
      width: boxWidth,
      height: boxHeight,
      color: rgb(1, 1, 1),
      borderColor: rgb(0, 0, 0),
      borderWidth: 1.5
    });
    drawText(
      page,
      contactSettings.costCentreAccount,
      boxX + boxWidth / 2 - fonts.regular.widthOfTextAtSize(contactSettings.costCentreAccount, 11.5) / 2,
      y + 0.5,
      11.5,
      fonts.regular
    );
    y -= 28;
  } else if (contactSettings.paymentInstructions) {
    y = drawCenteredWrappedText(page, contactSettings.paymentInstructions, y, 10.2, fonts.regular, rightX - marginX, 13) - 8;
  }

  drawReceiptInstruction(page, fonts, y, contactSettings.collectionLocation);
  y -= 34;

  const filamentPriceLines = groupFilamentsByPrice(filaments)
    .filter((group) => group.filaments.length > 0)
    .map((group) =>
      `${group.filaments.map((filament) => filament.type).join(', ')} @ ${formatFooterCurrency(group.pricePerGram)} per gram`
    );
  [
    ...filamentPriceLines,
    `Filament Provided* Printing Service @ ${formatFooterCurrency(providedFilamentPricePerGram)} per gram`
  ].forEach((text) => {
    y = drawCenteredWrappedText(page, text, y, 12.4, fonts.regular, rightX - marginX, 15);
  });

  y -= 8;
  drawCenteredWrappedText(
    page,
    '* Please discuss compatible filaments with a team member before bringing spools for printing.',
    y,
    8.8,
    fonts.regular,
    rightX - marginX,
    12
  );

  return pdfDoc.save();
};

export const loadQuoteLogoImage = async (src = '/images/logo.png'): Promise<QuotePdfImage | undefined> => {
  if (typeof Image === 'undefined' || typeof document === 'undefined') return undefined;

  try {
    const image = new Image();
    image.decoding = 'async';
    image.src = src;
    await image.decode();

    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    if (!context) return undefined;

    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
    if (!blob) return undefined;
    return {
      bytes: new Uint8Array(await blob.arrayBuffer()),
      width: canvas.width,
      height: canvas.height
    };
  } catch {
    return undefined;
  }
};
