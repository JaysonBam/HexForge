import type { Part, Project, QuoteSnapshotMaterialLine } from '../types';
import type { GmailAttachment } from './gmailDraftUtils';
import { createQuotePdfBytes, loadQuoteLogoImage, type QuotePdfLine } from './quotePdfUtils';
import type { Filament } from '../domain/settingsConfig';
import {
  filamentSourceShortLabel,
  getPartFilamentSource,
  isProvidedFilamentSource
} from '../domain/filamentSource.ts';

const getPrimaryCost = (
  part: Part,
  getFilamentPrice: (type: string) => number,
  providedFilamentPricePerGram: number
) => {
  const weight = part.primaryEstimatedWeight || 0;
  const source = getPartFilamentSource(part.primaryFilamentSource, part.primaryOwnFilament);
  return isProvidedFilamentSource(source) ? weight * providedFilamentPricePerGram : weight * getFilamentPrice(part.primaryMaterial);
};

const getSecondaryCost = (
  part: Part,
  getFilamentPrice: (type: string) => number,
  providedFilamentPricePerGram: number
) => {
  if (!part.secondaryMaterial) return 0;
  const weight = part.secondaryEstimatedWeight || 0;
  const source = getPartFilamentSource(part.secondaryFilamentSource, part.secondaryOwnFilament);
  return isProvidedFilamentSource(source) ? weight * providedFilamentPricePerGram : weight * getFilamentPrice(part.secondaryMaterial);
};

const formatMaterialLabel = (part: Part, slot: 'primary' | 'secondary') => {
  const material = slot === 'primary' ? part.primaryMaterial : part.secondaryMaterial;
  const source = slot === 'primary'
    ? getPartFilamentSource(part.primaryFilamentSource, part.primaryOwnFilament)
    : getPartFilamentSource(part.secondaryFilamentSource, part.secondaryOwnFilament);

  return `${material || ''}${source === 'misc' ? '' : ` (${filamentSourceShortLabel(source)})`}`;
};

const formatSnapshotMaterialLabel = (material: QuoteSnapshotMaterialLine) =>
  `${material.material || material.material_bucket || 'Unspecified'}${!material.filament_source || material.filament_source === 'misc' ? '' : ` (${filamentSourceShortLabel(material.filament_source)})`}`;

const formatWeight = (grams: number) => `${Number(grams || 0).toFixed(1).replace(/\.0$/, '')}g`;

const buildQuotePdfLines = (
  project: Project,
  getFilamentPrice: (type: string) => number,
  providedFilamentPricePerGram: number
): QuotePdfLine[] => {
  if (project.quoteSnapshot) {
    return (project.quoteSnapshot.line_summary || []).map((line) => ({
      partName: line.part_name,
      materials: line.materials.map(formatSnapshotMaterialLabel),
      weights: line.materials.map((material) => formatWeight(material.grams)),
      costs: line.materials.map((material) => `R ${Number(material.cost || 0).toFixed(2)}`)
    }));
  }

  return project.parts.map((part) => {
    const primaryCost = getPrimaryCost(part, getFilamentPrice, providedFilamentPricePerGram);
    const secondaryCost = part.secondaryMaterial
      ? getSecondaryCost(part, getFilamentPrice, providedFilamentPricePerGram)
      : 0;

    return {
      partName: part.partName,
      materials: [
        formatMaterialLabel(part, 'primary'),
        ...(part.secondaryMaterial ? [formatMaterialLabel(part, 'secondary')] : [])
      ],
      weights: [
        `${part.primaryEstimatedWeight}g`,
        ...(part.secondaryMaterial ? [`${part.secondaryEstimatedWeight || 0}g`] : [])
      ],
      costs: [
        `R ${primaryCost.toFixed(2)}`,
        ...(part.secondaryMaterial ? [`R ${secondaryCost.toFixed(2)}`] : [])
      ]
    };
  });
};

export const getQuotePdfFilename = (project: Project) =>
  `MISC-quote-${project.priorityNumber}-${project.studentNumber}.pdf`;

export const buildProjectQuotePdfBytes = async (
  project: Project,
  getFilamentPrice: (type: string) => number,
  filaments: Filament[],
  providedFilamentPricePerGram: number
) => {
  const totalCost = project.quoteSnapshot
    ? Number(project.quoteSnapshot.total_cost || 0)
    : project.parts.reduce(
        (sum, part) =>
          sum +
          getPrimaryCost(part, getFilamentPrice, providedFilamentPricePerGram) +
          getSecondaryCost(part, getFilamentPrice, providedFilamentPricePerGram),
        0
      );

  return createQuotePdfBytes({
    project,
    totalCost,
    lines: buildQuotePdfLines(project, getFilamentPrice, providedFilamentPricePerGram),
    filaments,
    providedFilamentPricePerGram,
    logo: await loadQuoteLogoImage()
  });
};

export const buildProjectQuoteAttachment = async (
  project: Project,
  getFilamentPrice: (type: string) => number,
  filaments: Filament[],
  providedFilamentPricePerGram: number
): Promise<GmailAttachment> => ({
  filename: getQuotePdfFilename(project),
  mimeType: 'application/pdf',
  bytes: await buildProjectQuotePdfBytes(project, getFilamentPrice, filaments, providedFilamentPricePerGram)
});
