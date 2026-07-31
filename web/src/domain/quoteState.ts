import type { Part, Project, QuoteSnapshot, QuoteSnapshotLine, QuoteSnapshotMaterialLine } from '../types';
import {
  filamentSourceLabel,
  getPartFilamentSource,
  normalizeFilamentSource,
  type FilamentSource
} from './filamentSource.ts';

export type QuoteComparisonStatus = 'no_quote' | 'up_to_date' | 'outdated';

export interface QuoteComparison {
  status: QuoteComparisonStatus;
  hasSnapshot: boolean;
  currentTotalCost: number;
  issuedTotalCost: number;
  currentLineSummary: QuoteSnapshotLine[];
  differences: string[];
}

const roundMoney = (value: number) => Math.round((Number(value) || 0) * 100) / 100;

const trimText = (value?: string | null) => (value || '').trim();

const formatNumber = (value: number) => {
  const rounded = roundMoney(value);
  return Number.isInteger(rounded)
    ? `${rounded.toFixed(0)}`
    : rounded.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
};

const formatWeight = (value: number) => `${formatNumber(value)}g`;

export const normalizeMaterialBucket = (material: string) => {
  const normalized = trimText(material).toUpperCase();
  if (!normalized) return 'UNSPECIFIED';
  if (normalized.includes('PLA')) return 'PLA';
  return normalized;
};

const buildMaterialLine = (
  slot: QuoteSnapshotMaterialLine['slot'],
  material: string | undefined,
  filamentSource: FilamentSource,
  grams: number,
  cost: number
): QuoteSnapshotMaterialLine | null => {
  const normalizedMaterial = trimText(material);
  const roundedGrams = roundMoney(grams);
  const roundedCost = roundMoney(cost);

  if (!normalizedMaterial && roundedGrams === 0 && roundedCost === 0) {
    return null;
  }

  return {
    slot,
    material_bucket: normalizeMaterialBucket(normalizedMaterial),
    filament_source: filamentSource,
    material: normalizedMaterial,
    grams: roundedGrams,
    cost: roundedCost
  };
};

export const buildLiveQuoteLineSummary = (
  project: Project,
  getPrimaryCost: (part: Part) => number,
  getSecondaryCost: (part: Part) => number
): QuoteSnapshotLine[] => project.parts
  .slice()
  .sort((a, b) => a.partNumber - b.partNumber || a.id.localeCompare(b.id))
  .map((part) => {
    const primaryGrams = roundMoney(part.primaryEstimatedWeight || 0);
    const primaryCost = roundMoney(getPrimaryCost(part));
    const secondaryGrams = part.secondaryMaterial ? roundMoney(part.secondaryEstimatedWeight || 0) : 0;
    const secondaryCost = part.secondaryMaterial ? roundMoney(getSecondaryCost(part)) : 0;

    const materials = [
      buildMaterialLine(
        'primary',
        part.primaryMaterial,
        getPartFilamentSource(part.primaryFilamentSource, part.primaryOwnFilament),
        primaryGrams,
        primaryCost
      ),
      buildMaterialLine(
        'secondary',
        part.secondaryMaterial,
        getPartFilamentSource(part.secondaryFilamentSource, part.secondaryOwnFilament),
        secondaryGrams,
        secondaryCost
      )
    ].filter((line): line is QuoteSnapshotMaterialLine => Boolean(line));

    return {
      part_id: part.id,
      part_number: part.partNumber,
      part_name: trimText(part.partName),
      total_grams: roundMoney(primaryGrams + secondaryGrams),
      total_cost: roundMoney(primaryCost + secondaryCost),
      materials
    };
  });

const normalizeLine = (line: QuoteSnapshotLine) => ({
  part_id: line.part_id,
  part_number: line.part_number,
  part_name: trimText(line.part_name),
  total_grams: roundMoney(line.total_grams),
  total_cost: roundMoney(line.total_cost),
  materials: (line.materials || [])
    .slice()
    .sort((a, b) => a.slot.localeCompare(b.slot))
    .map((material) => ({
      slot: material.slot,
      material_bucket: normalizeMaterialBucket(material.material_bucket),
      filament_source: normalizeFilamentSource(material.filament_source),
      material: trimText(material.material),
      grams: roundMoney(material.grams),
      cost: roundMoney(material.cost)
    }))
});

const sameMoney = (a: number, b: number) => Math.abs(roundMoney(a) - roundMoney(b)) < 0.005;

const describeWeightChange = (
  slotLabel: 'primary' | 'secondary',
  currentMaterial?: QuoteSnapshotMaterialLine,
  issuedMaterial?: QuoteSnapshotMaterialLine
) => {
  if (!currentMaterial && !issuedMaterial) return null;

  const currentGrams = currentMaterial?.grams ?? 0;
  const issuedGrams = issuedMaterial?.grams ?? 0;

  if (sameMoney(currentGrams, issuedGrams)) return null;

  return `${slotLabel} weight ${formatWeight(issuedGrams)} -> ${formatWeight(currentGrams)}`;
};

const describeSourceChange = (
  slotLabel: 'primary' | 'secondary',
  currentMaterial?: QuoteSnapshotMaterialLine,
  issuedMaterial?: QuoteSnapshotMaterialLine
) => {
  if (!currentMaterial && !issuedMaterial) return null;

  const currentSource = normalizeFilamentSource(currentMaterial?.filament_source);
  const issuedSource = normalizeFilamentSource(issuedMaterial?.filament_source);

  if (currentSource === issuedSource) return null;

  return `${slotLabel} source ${filamentSourceLabel(issuedSource)} -> ${filamentSourceLabel(currentSource)}`;
};

const summarizeLineDifferences = (currentLine: QuoteSnapshotLine, issuedLine: QuoteSnapshotLine) => {
  const differences: string[] = [];
  const partLabel = `Part ${currentLine.part_number}`;

  const currentPrimary = currentLine.materials.find((material) => material.slot === 'primary');
  const issuedPrimary = issuedLine.materials.find((material) => material.slot === 'primary');
  const currentSecondary = currentLine.materials.find((material) => material.slot === 'secondary');
  const issuedSecondary = issuedLine.materials.find((material) => material.slot === 'secondary');

  const primaryChange = describeWeightChange('primary', currentPrimary, issuedPrimary);
  const secondaryChange = describeWeightChange('secondary', currentSecondary, issuedSecondary);
  const primarySourceChange = describeSourceChange('primary', currentPrimary, issuedPrimary);
  const secondarySourceChange = describeSourceChange('secondary', currentSecondary, issuedSecondary);

  if (primaryChange) differences.push(primaryChange);
  if (secondaryChange) differences.push(secondaryChange);
  if (primarySourceChange) differences.push(primarySourceChange);
  if (secondarySourceChange) differences.push(secondarySourceChange);

  return differences.length > 0 ? [`${partLabel}: ${differences.join('; ')}`] : [];
};

export const compareQuoteSnapshot = (
  project: Project,
  issuedSnapshot?: QuoteSnapshot,
  getPrimaryCost?: (part: Part) => number,
  getSecondaryCost?: (part: Part) => number
): QuoteComparison => {
  const currentLineSummary = getPrimaryCost && getSecondaryCost
    ? buildLiveQuoteLineSummary(project, getPrimaryCost, getSecondaryCost)
    : [];

  if (!issuedSnapshot) {
    return {
      status: 'no_quote',
      hasSnapshot: false,
      currentTotalCost: currentLineSummary.reduce((sum, line) => sum + line.total_cost, 0),
      issuedTotalCost: 0,
      currentLineSummary,
      differences: []
    };
  }

  const normalizedCurrent = currentLineSummary.map(normalizeLine);
  const normalizedIssued = (issuedSnapshot.line_summary || []).map(normalizeLine);

  const currentByPartId = new Map(normalizedCurrent.map((line) => [line.part_id, line] as const));
  const issuedByPartId = new Map(normalizedIssued.map((line) => [line.part_id, line] as const));

  const orderedPartIds = Array.from(new Set([
    ...normalizedIssued.map((line) => line.part_id),
    ...normalizedCurrent.map((line) => line.part_id)
  ])).sort((left, right) => {
    const leftLine = currentByPartId.get(left) ?? issuedByPartId.get(left);
    const rightLine = currentByPartId.get(right) ?? issuedByPartId.get(right);
    return (leftLine?.part_number ?? 0) - (rightLine?.part_number ?? 0) || left.localeCompare(right);
  });

  const differences: string[] = [];
  const currentTotalCost = roundMoney(normalizedCurrent.reduce((sum, line) => sum + line.total_cost, 0));
  const issuedTotalCost = roundMoney(issuedSnapshot.total_cost || 0);

  orderedPartIds.forEach((partId) => {
    const currentLine = currentByPartId.get(partId);
    const issuedLine = issuedByPartId.get(partId);

    if (!currentLine && !issuedLine) return;

    if (!issuedLine && currentLine) {
      differences.push(`Part ${currentLine.part_number}: added`);
      return;
    }

    if (!currentLine && issuedLine) {
      differences.push(`Part ${issuedLine.part_number}: removed`);
      return;
    }

    if (!currentLine || !issuedLine) return;

    const lineDifferences = summarizeLineDifferences(currentLine, issuedLine);
    if (lineDifferences.length > 0) {
      differences.push(...lineDifferences);
    }
  });

  const isExactMatch =
    sameMoney(currentTotalCost, issuedTotalCost) &&
    JSON.stringify(normalizedCurrent) === JSON.stringify(normalizedIssued);

  const limitedDifferences = differences.slice(0, 5);
  if (differences.length > 5) {
    limitedDifferences.push(`+${differences.length - 5} more change${differences.length - 5 === 1 ? '' : 's'}`);
  }

  return {
    status: isExactMatch ? 'up_to_date' : 'outdated',
    hasSnapshot: true,
    currentTotalCost,
    issuedTotalCost,
    currentLineSummary,
    differences: limitedDifferences
  };
};
