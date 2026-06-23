import { Download } from 'lucide-react';
import type { QuoteComparisonStatus } from '../../domain/quoteState';
import { filamentSourceShortLabel } from '../../domain/filamentSource.ts';
import { Button } from '../ui/Button';
import { formatCurrency, formatLineWeight, type QuoteView } from './quoteCostSummaryModel';

export function QuoteCostSummary({
  quoteViews,
  selectedQuoteView,
  selectedQuoteViewId,
  setSelectedQuoteViewId,
  showQuoteViewSelect,
  quoteIsIssued,
  quoteStatus,
  currentIssuedVersion,
  downloadQuotePdf
}: {
  quoteViews: QuoteView[];
  selectedQuoteView?: QuoteView;
  selectedQuoteViewId: string;
  setSelectedQuoteViewId: (id: string) => void;
  showQuoteViewSelect: boolean;
  quoteIsIssued: boolean;
  quoteStatus: QuoteComparisonStatus;
  currentIssuedVersion: number | null;
  downloadQuotePdf: () => void;
}) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-600">Cost Summary</p>
          <h3 className="mt-1 text-lg font-black text-slate-950">{selectedQuoteView?.title}</h3>
          <p className="mt-1 text-sm font-semibold text-slate-600">{selectedQuoteView?.description}</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {showQuoteViewSelect && (
            <select
              value={selectedQuoteViewId}
              onChange={(event) => setSelectedQuoteViewId(event.target.value)}
              className="forge-command-input h-8 min-w-[210px] px-3 text-xs font-bold text-slate-800"
              aria-label="Select quote version"
            >
              {quoteViews.map((view) => (
                <option key={view.id} value={view.id}>{view.label}</option>
              ))}
            </select>
          )}
          <Button
            variant="outline"
            size="sm"
            className="gap-2 text-slate-700"
            onClick={downloadQuotePdf}
            disabled={!quoteIsIssued}
            title={!quoteIsIssued ? 'Issue the initial quote before downloading.' : 'Download the current issued quote.'}
          >
            <Download className="w-4 h-4" /> Download issued quote
          </Button>
        </div>
      </div>

      {!quoteIsIssued && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
          This is a draft preview. Issue the initial quote to unlock downloads, communication, and production.
        </div>
      )}
      {quoteStatus === 'outdated' && selectedQuoteView?.tone === 'issued' && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
          The official quote is still v{currentIssuedVersion}, but the live project values have changed. Select updated draft values to preview the pending update.
        </div>
      )}
      {selectedQuoteView?.id === 'draft-updated' && (
        <div className="rounded-md border border-sky-200 bg-sky-50 px-4 py-3 text-sm font-semibold text-sky-900">
          Preview only. Updating the quote will supersede current issued v{currentIssuedVersion} with these draft values.
        </div>
      )}
      {selectedQuoteView?.tone === 'previous' && (
        <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700">
          Historical view. This version is preserved for traceability; the current issued quote remains v{currentIssuedVersion}.
        </div>
      )}

      <div className="overflow-x-auto border-y border-slate-300">
        <table className="w-full min-w-[760px] table-fixed text-left text-sm">
          <colgroup>
            <col className="w-[40%]" />
            <col className="w-[16%]" />
            <col className="w-[14%]" />
            <col className="w-[16%]" />
            <col className="w-[14%]" />
          </colgroup>
          <thead className="forge-table-head">
            <tr>
              <th className="border-b border-slate-300 px-6 py-3 font-medium">Part Name</th>
              <th className="whitespace-nowrap border-b border-slate-300 px-6 py-3 font-medium">Material</th>
              <th className="whitespace-nowrap border-b border-slate-300 px-6 py-3 text-right font-medium">Est. Weight</th>
              <th className="whitespace-nowrap border-b border-slate-300 px-6 py-3 text-center font-medium">Settings</th>
              <th className="whitespace-nowrap border-b border-slate-300 px-6 py-3 text-right font-medium">Cost</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-300">
            {selectedQuoteView?.lines.map((line) => (
              <tr key={`${selectedQuoteView.id}-${line.part_id}-${line.part_number}`}>
                <td className="break-words px-6 py-4 align-top font-medium text-slate-950">{line.part_name}</td>
                <td className="px-6 py-4 align-top text-slate-700">
                  {line.materials.map((material) => (
                    <div key={`${line.part_id}-${material.slot}-material`} className="break-words [&+&]:mt-1">
                      {material.material || material.material_bucket || 'Unspecified'}
                    </div>
                  ))}
                </td>
                <td className="whitespace-nowrap px-6 py-4 text-right align-top text-slate-700">
                  {line.materials.map((material) => (
                    <div key={`${line.part_id}-${material.slot}-grams`} className="[&+&]:mt-1">
                      {formatLineWeight(material.grams)}
                    </div>
                  ))}
                </td>
                <td className="px-6 py-4 text-center align-top text-xs text-slate-700">
                  <div className="flex flex-col items-center gap-2">
                    {line.materials.map((material) => (
                      <span key={`${line.part_id}-${material.slot}-source`} className={`forge-badge ${material.slot === 'primary' ? 'forge-badge-blue' : 'forge-badge-pink'} inline-flex min-w-fit items-center justify-center whitespace-nowrap px-2.5 py-1 text-[11px] leading-none`}>
                        {filamentSourceShortLabel(material.filament_source || 'misc')}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="whitespace-nowrap px-6 py-4 text-right align-top font-medium tabular-nums text-slate-950">
                  {line.materials.map((material) => (
                    <div key={`${line.part_id}-${material.slot}-cost`} className={material.slot === 'secondary' ? 'text-sm font-normal text-slate-700 [&+&]:mt-1' : '[&+&]:mt-1'}>
                      {formatCurrency(Number(material.cost || 0))}
                    </div>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-slate-100 font-bold text-slate-950">
            <tr>
              <td colSpan={4} className="border-t border-slate-500 px-6 py-4 text-right">Total Cost</td>
              <td className="whitespace-nowrap border-t border-slate-500 px-6 py-4 text-right text-lg tabular-nums">{formatCurrency(selectedQuoteView?.totalCost || 0)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}
