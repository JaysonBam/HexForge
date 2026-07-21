import { useEffect, useState } from 'react';
import { Loader2, Mail, Paperclip, RefreshCw, X } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { useFeedback } from '../components/ui/FeedbackProvider';
import { GmailAuthError, requestGmailReadAccess } from '../utils/gmailDraftUtils';
import { listRecent3dPrintThreads } from './gmailThreadApi';
import type { GmailThreadListItem } from './types';

const formatDate = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
};

export const GmailThreadPicker = ({
  open,
  onClose,
  onSelect
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (item: GmailThreadListItem) => void;
}) => {
  const { confirm } = useFeedback();
  const [items, setItems] = useState<GmailThreadListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await listRecent3dPrintThreads());
    } catch (loadError) {
      if (loadError instanceof GmailAuthError) {
        const reconnect = await confirm({
          title: 'Gmail access needed',
          message: 'Grant Gmail read access to choose a Main Gmail Thread.',
          messages: [loadError.message],
          confirmLabel: 'Grant Gmail Access'
        });
        if (reconnect) await requestGmailReadAccess();
      } else {
        setError(loadError instanceof Error ? loadError.message : 'Recent Gmail threads could not be loaded.');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
    // Loading is intentionally tied only to opening the picker; Refresh is explicit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-[2px]" onClick={onClose}>
      <section className="forge-drawer flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg" onClick={(event) => event.stopPropagation()} aria-modal="true" role="dialog" aria-labelledby="gmail-picker-title">
        <header className="flex items-start justify-between gap-4 border-b border-slate-300 bg-white px-5 py-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">Gmail intake</p>
            <h2 id="gmail-picker-title" className="text-lg font-black text-slate-950">Choose Main Gmail Thread</h2>
            <p className="mt-1 text-xs font-semibold text-slate-600">The 10 most recent read or unread 3D-printing-related threads.</p>
          </div>
          <div className="flex gap-1">
            <Button variant="ghost" size="icon" onClick={() => void load()} disabled={loading} aria-label="Refresh recent Gmail threads">
              <RefreshCw size={17} className={loading ? 'animate-spin' : ''} />
            </Button>
            <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close Gmail picker"><X size={18} /></Button>
          </div>
        </header>
        <div className="overflow-y-auto bg-slate-100 p-4">
          {loading && items.length === 0 && (
            <div className="flex min-h-48 items-center justify-center gap-2 text-sm font-bold text-slate-600"><Loader2 size={18} className="animate-spin" /> Loading Gmail threads…</div>
          )}
          {error && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm font-semibold text-amber-900">
              <p>{error}</p>
              <Button variant="outline" size="sm" className="mt-3 gap-2" onClick={() => void load()}><RefreshCw size={14} /> Try again</Button>
            </div>
          )}
          {!loading && !error && items.length === 0 && (
            <div className="rounded-md border border-slate-300 bg-white p-8 text-center text-sm font-semibold text-slate-600">No recent print-related Gmail threads were found.</div>
          )}
          <div className="space-y-3">
            {items.map((item) => (
              <button
                type="button"
                key={item.threadId}
                className="forge-focus-ring w-full rounded-lg border border-slate-300 bg-white p-4 text-left shadow-sm transition hover:border-sky-400 hover:bg-sky-50"
                onClick={() => { onSelect(item); onClose(); }}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-sm font-black text-slate-950"><Mail size={15} className="shrink-0 text-sky-700" /><span className="truncate">{item.senderName || item.senderEmail || 'Unknown sender'}</span></p>
                    {item.senderName && <p className="mt-0.5 truncate text-xs font-semibold text-slate-500">{item.senderEmail}</p>}
                  </div>
                  <time className="text-[11px] font-bold text-slate-500">{formatDate(item.messageDate)}</time>
                </div>
                <h3 className="mt-3 text-sm font-black text-slate-900">{item.subject}</h3>
                <p className="mt-1 line-clamp-2 text-xs font-medium leading-relaxed text-slate-600">{item.preview || 'No plain-text preview available.'}</p>
                {item.attachmentFilenames.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {item.attachmentFilenames.map((filename) => <span key={filename} className="forge-badge inline-flex items-center gap-1 px-2 py-1 text-[10px]"><Paperclip size={11} /> {filename}</span>)}
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
};
