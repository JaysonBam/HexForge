import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ExternalLink, Loader2, Paperclip, RefreshCw, Search, X } from 'lucide-react';
import gmailIcon from '@/assets/icons/gmail.svg';
import { Button } from '@/components/ui/Button';
import { requestGmailReadAccess } from '@/api/google/gmail/client';
import { getGmailThreadUrl } from '@/api/google/gmail/urls';
import { useGmailInbox } from './useGmailInbox';
import { refreshGmailInbox } from './gmailInboxStore';
import type { GmailThreadListItem } from '@/api/google/gmail/types';
import { setGmailThreadHidden } from '@/api/supabase/gmailRecords';
import { buildLinkedGmailThreadKeys, gmailThreadKey, gmailThreadNeedsAction, visibleGmailThreads } from './linkedGmailThreads';

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
});
const formatDate = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : dateFormatter.format(date);
};
const noItems: GmailThreadListItem[] = [];
const displaySubject = (subject: string) => {
  const main = subject.replace(/^(?:\s*re:\s*)+/i, '').trim();
  return main && main.toLowerCase() !== '(no subject)' ? main : 'No subject line';
};

export const GmailThreadPicker = ({
  open,
  onClose,
  onSelect,
  actionMode = false,
  onOpenProject
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (item: GmailThreadListItem) => void;
  actionMode?: boolean;
  onOpenProject?: (id: string) => void;
}) => open ? <GmailThreadPickerDialog onClose={onClose} onSelect={onSelect} actionMode={actionMode} onOpenProject={onOpenProject} /> : null;

const GmailThreadPickerDialog = ({ onClose, onSelect, actionMode, onOpenProject }: {
  onClose: () => void;
  onSelect: (item: GmailThreadListItem) => void;
  actionMode: boolean;
  onOpenProject?: (id: string) => void;
}) => {

  const inbox = useGmailInbox();
  const { error, linked, hiddenKeys, verified } = inbox;
  const items = inbox.detailsVerified ? inbox.items : noItems;
  // Never paint yesterday's list in the frame before the opening check starts.
  const [openingCheck] = useState(inbox.isRefreshing ? inbox.checkId - 1 : inbox.checkId);
  const openingVerified = inbox.checkId > openingCheck;
  const loading = inbox.isRefreshing || (!openingVerified && !error);
  const linkedKeys = useMemo(() => verified ? buildLinkedGmailThreadKeys(linked) : null, [linked, verified]);
  const [search, setSearch] = useState('');
  const [hideLinked, setHideLinked] = useState(true);
  const [hideHidden, setHideHidden] = useState(true);
  const [view, setView] = useState<'action' | 'hidden' | 'linked' | 'all'>('action');
  const [hideSaveError, setHideSaveError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const availableItems = useMemo(() => {
    if (!openingVerified || !verified || !linkedKeys) return [];
    if (!actionMode) return visibleGmailThreads(items, linkedKeys, hideLinked, hiddenKeys, hideHidden);
    return items.filter(item => {
      const key = gmailThreadKey(item.snapshot.accountEmail, item.threadId);
      const isLinked = linkedKeys.has(key);
      const isHidden = !isLinked && hiddenKeys.has(key);
      return view === 'all' || (view === 'linked' ? isLinked : view === 'hidden' ? isHidden
        : gmailThreadNeedsAction(isLinked, isHidden, item.snapshot.hasUnread === true));
    });
  }, [items, linkedKeys, hiddenKeys, verified, openingVerified, hideLinked, hideHidden, actionMode, view]);
  const filteredItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return availableItems;
    return availableItems.filter(item => [item.senderName, item.senderEmail, item.subject, item.preview,
      ...item.attachmentFilenames, item.snapshot.accountEmail, item.snapshot.mainContactEmail,
      ...item.snapshot.messages.flatMap(message => [message.senderName, message.senderEmail,
        ...message.recipientEmails, message.subject, message.body,
        ...message.attachments.map(attachment => attachment.filename)])
    ].join('\n').toLowerCase().includes(query));
  }, [availableItems, search]);

  const load = () => refreshGmailInbox();
  const changeHidden = async (item: GmailThreadListItem) => {
    const key = gmailThreadKey(item.snapshot.accountEmail, item.threadId);
    if (savingKey || !linkedKeys || !hiddenKeys || linkedKeys.has(key)) return;
    const hidden = !hiddenKeys.has(key);
    setSavingKey(key);
    setHideSaveError(null);
    try {
      await setGmailThreadHidden(item.snapshot.accountEmail, item.threadId, hidden);
    } catch (saveError) {
      setHideSaveError(saveError instanceof Error ? saveError.message : 'The hidden email list could not be updated.');
    } finally {
      setSavingKey(null);
    }
  };

  useEffect(() => { void refreshGmailInbox(); }, []);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-[2px]" onClick={onClose}>
      <section className="forge-drawer flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg" onClick={(event) => event.stopPropagation()} aria-modal="true" role="dialog" aria-labelledby="gmail-picker-title">
        <header className="shrink-0 border-b border-slate-200 bg-white px-4 py-4 sm:px-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
              <img src={gmailIcon} alt="" className="mt-1 h-6 w-7 shrink-0" />
              <div className="min-w-0">
                <h2 id="gmail-picker-title" className="text-lg font-black text-slate-950">{actionMode ? 'Emails needing action' : 'Choose Main Gmail Thread'}</h2>
                <p className="mt-1 text-xs text-slate-500">The latest 50 print-related threads from {inbox.year}.</p>
              </div>
            </div>
            <div className="flex shrink-0 gap-1">
              <Button variant="ghost" size="icon" onClick={() => void load()} disabled={loading || savingKey !== null} aria-label="Refresh recent Gmail threads">
                <RefreshCw size={17} className={loading ? 'animate-spin' : ''} />
              </Button>
              <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close Gmail picker"><X size={18} /></Button>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            {actionMode ? (
              <div className="flex flex-wrap gap-1.5" aria-label="Email views">
                {(['action', 'hidden', 'linked', 'all'] as const).map(value => (
                  <Button key={value} size="sm" variant={view === value ? 'primary' : 'outline'}
                    className={view === value ? 'shadow-none' : 'border-slate-200 font-semibold shadow-none'}
                    aria-pressed={view === value} onClick={() => setView(value)}>
                    {{ action: 'Needs action', hidden: 'Hidden', linked: 'Linked', all: 'All emails' }[value]}
                  </Button>
                ))}
              </div>
            ) : (
              <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs font-semibold text-slate-700">
                <label className="flex cursor-pointer items-center gap-2">
                  <input type="checkbox" checked={hideLinked} onChange={event => setHideLinked(event.target.checked)}
                    className="forge-focus-ring h-4 w-4 accent-sky-700" />
                  Hide linked emails
                </label>
                <label className="flex cursor-pointer items-center gap-2">
                  <input type="checkbox" checked={hideHidden} onChange={event => setHideHidden(event.target.checked)}
                    className="forge-focus-ring h-4 w-4 accent-sky-700" />
                  Hide hidden emails
                </label>
              </div>
            )}
            {(items.length > 0 || !loading) && (
              <p className="whitespace-nowrap text-xs font-semibold text-slate-500">{filteredItems.length} of {inbox.threadIds.length} visible</p>
            )}
          </div>
        </header>
        <div className="overflow-y-auto bg-slate-100 p-4">
          {hideSaveError && (
            <p role="alert" className="mb-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm font-semibold text-amber-900">{hideSaveError}</p>
          )}
          {items.length > 0 && (
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
          {loading && items.length > 0 && <p role="status" className="mb-3 flex items-center gap-2 text-xs font-semibold text-slate-600"><Loader2 size={14} className="animate-spin" /> Loading remaining threads…</p>}
          {error && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm font-semibold text-amber-900">
              <p>{error}</p>
              {inbox.status === 'auth' && <Button size="sm" className="mt-3" onClick={() => void requestGmailReadAccess()}>Grant Gmail access</Button>}
              <Button variant="outline" size="sm" className="mt-3 gap-2" onClick={() => void load()}><RefreshCw size={14} /> Try again</Button>
            </div>
          )}
          {!loading && !error && items.length === 0 && (
            <div className="rounded-md border border-slate-300 bg-white p-8 text-center text-sm font-semibold text-slate-600">No print-related Gmail threads were found this year.</div>
          )}
          {!loading && !error && items.length > 0 && availableItems.length === 0
            && (!(hideLinked || hideHidden) || linkedKeys) && (!hideHidden || hiddenKeys) && (
            <div className="rounded-md border border-slate-300 bg-white p-8 text-center text-sm font-semibold text-slate-600">
              {actionMode ? 'No emails in this view.' : 'All emails are filtered out. Turn off the filters to show them.'}
            </div>
          )}
          {!loading && !error && availableItems.length > 0 && filteredItems.length === 0 && (
            <div className="rounded-md border border-slate-300 bg-white p-8 text-center text-sm font-semibold text-slate-600">
              No email threads matched “{search.trim()}” in this year’s print emails. Try a different name, email address, or phrase.
            </div>
          )}
          <div className="space-y-3">
            {filteredItems.map((item) => {
              const key = gmailThreadKey(item.snapshot.accountEmail, item.threadId);
              const linked = linkedKeys?.has(key) || false;
              const hidden = !linked && hiddenKeys?.has(key);
              return (
                <div key={item.threadId} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                  {actionMode ? <ThreadDetails item={item} linked={linked} hidden={!!hidden} /> : (
                    <button type="button" className="forge-focus-ring block w-full rounded text-left hover:text-sky-800"
                      onClick={() => { onSelect(item); onClose(); }}>
                      <ThreadDetails item={item} linked={linked} hidden={!!hidden} />
                    </button>
                  )}
                  <div className="mt-2 flex flex-wrap items-end gap-x-3 gap-y-1">
                    <ThreadBody item={item} />
                    <div className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-2">
                      {actionMode ? <>
                        <a href={getGmailThreadUrl(item.threadId)} target="_blank" rel="noreferrer"
                          className="forge-focus-ring inline-flex h-8 items-center gap-2 rounded-md border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"><img src={gmailIcon} alt="" className="h-3.5 w-4" /> Open in Gmail</a>
                        {linked ? inbox.linked.filter(link => link.id && link.gmailThreadId === item.threadId
                          && link.gmailAccountEmail?.trim().toLowerCase() === item.snapshot.accountEmail).map(link => (
                            <Button key={link.id} size="sm" variant="outline" className="gap-1.5 border-slate-200 font-semibold shadow-none" onClick={() => { onOpenProject?.(link.id!); onClose(); }}><ExternalLink size={13} /> {link.priorityNumber == null ? 'Open project' : `Open P${link.priorityNumber}`}</Button>
                          )) : <>
                          <Button size="sm" onClick={() => { onSelect(item); onClose(); }}>Create project</Button>
                          <Button variant="ghost" size="sm" className="text-slate-500" disabled={savingKey !== null || !verified} onClick={() => void changeHidden(item)}>
                            {savingKey === key ? <Loader2 size={14} className="animate-spin" /> : hidden ? 'Unhide' : 'Hide'}
                          </Button>
                        </>}
                      </> : <>
                        <Button size="sm" onClick={() => { onSelect(item); onClose(); }}>Select thread</Button>
                        <Button variant="ghost" size="sm" className="text-xs text-slate-500"
                          disabled={savingKey !== null || !linkedKeys || !hiddenKeys || linked}
                          title={linked ? 'Linked emails cannot be hidden.' : undefined}
                          aria-label={`${hidden ? 'Unhide' : 'Hide'} email: ${item.subject}`}
                          onClick={() => void changeHidden(item)}>
                          {savingKey === key ? <Loader2 size={14} className="animate-spin" /> : linked ? 'Linked' : hidden ? 'Unhide' : 'Hide'}
                        </Button>
                      </>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
};

const ThreadDetails = ({ item, linked, hidden }: { item: GmailThreadListItem; linked: boolean; hidden: boolean }) => (
  <div className="flex items-start justify-between gap-3">
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <p className="break-words text-sm font-bold text-slate-900">{item.senderName || item.senderEmail || 'Unknown sender'}</p>
        {item.senderName && <p className="break-all text-[11px] text-slate-500">{item.senderEmail}</p>}
      </div>
      <h3 className="mt-2 break-words text-sm font-bold text-slate-900">{displaySubject(item.subject)}</h3>
    </div>
    <div className="flex max-w-[45%] shrink-0 flex-col items-end gap-1.5 text-right">
      <time dateTime={item.messageDate} title={item.messageDate} className="text-[11px] text-slate-500">{formatDate(item.messageDate)}</time>
      <div className="flex flex-wrap justify-end gap-1.5 text-[10px] font-semibold">
        {!linked && !hidden && <span className="rounded px-1.5 py-0.5 text-emerald-800 bg-emerald-50">New thread</span>}
        {item.snapshot.hasUnread && <span className="rounded px-1.5 py-0.5 text-sky-800 bg-sky-50">Unread message</span>}
        {item.snapshot.hasSpam && <span className="rounded px-1.5 py-0.5 text-amber-800 bg-amber-50">Spam</span>}
      </div>
    </div>
  </div>
);

const ThreadBody = ({ item }: { item: GmailThreadListItem }) => {
  const message = item.snapshot.messages.find(message => message.id === item.messageId) || item.snapshot.messages.at(-1);
  return (
    <details className="group min-w-0 flex-1 basis-44 open:basis-full">
      <summary className="forge-focus-ring flex w-fit cursor-pointer list-none items-center gap-1 rounded text-xs text-slate-500 hover:text-slate-900 [&::-webkit-details-marker]:hidden">
        <ChevronDown size={13} className="transition-transform group-open:rotate-180 motion-reduce:transition-none" />
        Details{item.attachmentFilenames.length > 0 && <span className="ml-1 inline-flex items-center gap-1"><Paperclip size={11} />{item.attachmentFilenames.length} {item.attachmentFilenames.length === 1 ? 'attachment' : 'attachments'}</span>}
      </summary>
      <div className="mt-3 space-y-3 rounded-md bg-slate-50 p-3">
        <p className="max-h-52 overflow-y-auto whitespace-pre-wrap break-words text-xs leading-relaxed text-slate-600">{message?.body || item.preview || 'No plain-text message available.'}</p>
        {item.attachmentFilenames.length > 0 && <ul className="grid gap-1.5 sm:grid-cols-2" aria-label="Attachments">
          {item.attachmentFilenames.map((filename, index) => <li key={`${index}:${filename}`} className="flex min-w-0 items-start gap-1.5 text-xs text-slate-600"><Paperclip size={12} className="mt-0.5 shrink-0" /><span className="break-all">{filename}</span></li>)}
        </ul>}
      </div>
    </details>
  );
};
