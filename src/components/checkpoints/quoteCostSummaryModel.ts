import { filamentSourceShortLabel } from '../../domain/filamentSource.ts';
import type { QuoteComparisonStatus } from '../../domain/quoteState';
import type { QuoteSnapshot, QuoteSnapshotLine, QuoteSnapshotMaterialLine } from '../../types';

export type QuoteView = {
  id: string;
  label: string;
  title: string;
  tone: 'draft' | 'issued' | 'previous';
  totalCost: number;
  lines: QuoteSnapshotLine[];
  snapshot?: QuoteSnapshot;
  description: string;
};

export const formatCurrency = (value: number) => `R ${value.toFixed(2)}`;

export const formatLineMaterialLabel = (material: QuoteSnapshotMaterialLine) =>
  `${material.material || material.material_bucket || 'Unspecified'}${!material.filament_source || material.filament_source === 'misc' ? '' : ` (${filamentSourceShortLabel(material.filament_source)})`}`;

export const formatLineWeight = (grams: number) => `${Number(grams || 0).toFixed(1).replace(/\.0$/, '')}g`;

const formatQuoteDate = (value?: string) => value ? new Date(value).toLocaleDateString() : 'unspecified date';

export const buildQuoteViews = ({
  previousSnapshots,
  currentIssuedSnapshot,
  quoteStatus,
  draftTotalCost,
  draftLineSummary
}: {
  previousSnapshots: QuoteSnapshot[];
  currentIssuedSnapshot?: QuoteSnapshot;
  quoteStatus: QuoteComparisonStatus;
  draftTotalCost: number;
  draftLineSummary: QuoteSnapshotLine[];
}): QuoteView[] => {
  const views: QuoteView[] = previousSnapshots.map((snapshot) => ({
    id: `snapshot-${snapshot.snapshot_version}`,
    label: `Version ${snapshot.snapshot_version}`,
    title: `Version ${snapshot.snapshot_version}`,
    tone: 'previous',
    totalCost: Number(snapshot.total_cost || 0),
    lines: snapshot.line_summary || [],
    snapshot,
    description: `Historical quote from ${formatQuoteDate(snapshot.generated_at)}.`
  }));

  if (currentIssuedSnapshot) {
    views.push({
      id: `snapshot-${currentIssuedSnapshot.snapshot_version}`,
      label: 'Current issued quote',
      title: 'Current issued quote',
      tone: 'issued',
      totalCost: Number(currentIssuedSnapshot.total_cost || 0),
      lines: currentIssuedSnapshot.line_summary || [],
      snapshot: currentIssuedSnapshot,
      description: `Official quote v${currentIssuedSnapshot.snapshot_version}, issued ${formatQuoteDate(currentIssuedSnapshot.generated_at)}.`
    });
  }

  if (!currentIssuedSnapshot || quoteStatus === 'outdated') {
    views.push({
      id: currentIssuedSnapshot ? 'draft-updated' : 'draft-current',
      label: currentIssuedSnapshot ? 'Updated draft values' : 'Draft quote - not issued',
      title: currentIssuedSnapshot ? 'Updated draft values' : 'Draft quote - not issued',
      tone: 'draft',
      totalCost: draftTotalCost,
      lines: draftLineSummary,
      description: currentIssuedSnapshot
        ? 'Preview of the current project values. This is not official until the quote is updated.'
        : 'Preview of the current project values. Issue an initial quote to make it official.'
    });
  }

  return views;
};
