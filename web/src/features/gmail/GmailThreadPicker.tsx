import { useEffect, useMemo, useState } from 'react';
import { Loader2, Mail, Paperclip, RefreshCw, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useFeedback } from '@/app/providers/FeedbackProvider';
import { GmailAuthError, requestGmailReadAccess } from '@/api/google/gmail/client';
import { listRecent3dPrintThreads } from '@/api/google/gmail/threads';
import type { GmailThreadListItem } from '@/api/google/gmail/types';

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
  const [search, setSearch] = useState('');

  const filteredItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return items;
    return items.filter((item) => [
      item.senderName,
      item.senderEmail,
      item.subject,
      item.preview,
      ...item.attachmentFilenames,
      item.snapshot.accountEmail,
      item.snapshot.mainContactEmail,
      ...item.snapshot.messages.flatMap((message) => [
        message.senderName,
        message.senderEmail,
        ...message.recipientEmails,
        message.subject,
        message.body,
        ...message.attachments.map((attachment) => attachment.filename)
      ])
    ].join('\n').toLowerCase().includes(query));
  }, [items, search]);

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
    const timer = window.setTimeout(() => {
      setSearch('');
      void load();
    }, 0);
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
            <p className="mt-1 text-xs font-semibold text-slate-600">Showing up to 50 of the most recent 3D-printing-related email threads from the last 30 days.</p>
          </div>
          <div className="flex gap-1">
            <Button variant="ghost" size="icon" onClick={() => void load()} disabled={loading} aria-label="Refresh recent Gmail threads">
              <RefreshCw size={17} className={loading ? 'animate-spin' : ''} />
            </Button>
            <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close Gmail picker"><X size={18} /></Button>
          </div>
        </header>
        <div className="overflow-y-auto bg-slate-100 p-4">
          {!error && items.length > 0 && (
            <div className="relative mb-4">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sky-600" size={16} />
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search names, emails, subjects, or message text"
                aria-label="Search recent Gmail threads"
                className="forge-command-input h-10 w-full pl-10 pr-10 text-sm font-semibold"
              />
              {search && (
                <button type="button" onClick={() => setSearch('')} aria-label="Clear Gmail thread search" className="forge-focus-ring absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-500 hover:text-slate-900">
                  <X size={15} />
                </button>
              )}
            </div>
          )}
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
          {!loading && !error && items.length > 0 && filteredItems.length === 0 && (
            <div className="rounded-md border border-slate-300 bg-white p-8 text-center text-sm font-semibold text-slate-600">
              No email threads matched “{search.trim()}” within the recent 3D-printing emails from the last 30 days. Try a different name, email address, or phrase.
            </div>
          )}
          <div className="space-y-3">
            {filteredItems.map((item) => (
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
