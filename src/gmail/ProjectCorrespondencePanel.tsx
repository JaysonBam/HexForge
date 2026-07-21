import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Download, ExternalLink, Loader2, Mail, Paperclip, RefreshCw, X } from 'lucide-react';
import type { Project } from '../types';
import { Button } from '../components/ui/Button';
import { useFeedback } from '../components/ui/FeedbackProvider';
import { useLocalHelper } from '../local-files/LocalHelperContext';
import { getAvailableProjectFiles } from '../local-files/projectLocalFileAvailability';
import { downloadPreparedGmailAttachments, prepareGmailAttachmentDownload, type PreparedGmailAttachmentDownload } from './gmailAttachmentDownload';
import { isGmailAttachmentSavedLocally } from './gmailAttachmentAvailability';
import { isSupportedGmailAttachment } from './gmailParsing';
import { loadProjectGmailMessages, syncProjectGmailThread } from './gmailProjectService';
import type { GmailThreadMessage } from './types';
import { openGmailThread } from './gmailUrls';
import { GMAIL_THREAD_ACCOUNT_MISMATCH, useProjectGmailThreadAccess } from './gmailThreadAccess';

const formatDateTime = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
};

export const ProjectCorrespondencePanel = ({
  project,
  open,
  onClose,
  onProjectSynced
}: {
  project: Project;
  open: boolean;
  onClose: () => void;
  onProjectSynced: (updates: Partial<Project>) => void;
}) => {
  const { notify, prompt } = useFeedback();
  const { state: helperState, client: helperClient } = useLocalHelper();
  const { canUseGmail } = useProjectGmailThreadAccess(project);
  const [messages, setMessages] = useState<GmailThreadMessage[]>([]);
  const [loadingCache, setLoadingCache] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [downloadingAttachment, setDownloadingAttachment] = useState<string | null>(null);
  const [availableLocalFiles, setAvailableLocalFiles] = useState<Awaited<ReturnType<typeof getAvailableProjectFiles>> | null>(null);
  const [checkingLocalFiles, setCheckingLocalFiles] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  const autoSyncedThread = useRef<string | null>(null);

  const loadCached = useCallback(async () => {
    if (!project.gmailThreadId) {
      setMessages([]);
      return;
    }
    setLoadingCache(true);
    try {
      setMessages(await loadProjectGmailMessages(project.id));
    } catch (error) {
      setWarning(error instanceof Error ? error.message : 'Saved Gmail messages could not be loaded.');
    } finally {
      setLoadingCache(false);
    }
  }, [project.gmailThreadId, project.id]);

  const loadAvailableLocalFiles = useCallback(async () => {
    if (!open || helperState !== 'connected') {
      setAvailableLocalFiles(null);
      setCheckingLocalFiles(false);
      return;
    }
    setCheckingLocalFiles(true);
    try {
      setAvailableLocalFiles(await getAvailableProjectFiles(project, helperClient, true));
    } catch {
      setAvailableLocalFiles(null);
    } finally {
      setCheckingLocalFiles(false);
    }
  }, [helperClient, helperState, open, project]);

  const refresh = useCallback(async (manual = false) => {
    if (!project.gmailThreadId || refreshing || !canUseGmail) return;
    setRefreshing(true);
    setWarning(null);
    try {
      const thread = await syncProjectGmailThread(project);
      onProjectSynced({
        gmailAccountEmail: thread.accountEmail,
        gmailThreadSubject: thread.subject,
        gmailMainContactEmail: thread.mainContactEmail,
        gmailLastSyncedAt: thread.syncedAt
      });
      await loadCached();
      if (manual) notify({ title: 'Correspondence refreshed', message: `${thread.messages.length} messages in the Main Gmail Thread.`, tone: 'success' });
    } catch (error) {
      setWarning(`Gmail could not be refreshed. Showing saved messages. ${error instanceof Error ? error.message : ''}`.trim());
    } finally {
      setRefreshing(false);
    }
  }, [canUseGmail, loadCached, notify, onProjectSynced, project, refreshing]);

  useEffect(() => {
    if (!open) return;
    void loadCached();
  }, [loadCached, open]);

  useEffect(() => {
    void loadAvailableLocalFiles();
    window.addEventListener('focus', loadAvailableLocalFiles);
    return () => window.removeEventListener('focus', loadAvailableLocalFiles);
  }, [loadAvailableLocalFiles]);

  useEffect(() => {
    if (!project.gmailThreadId || !canUseGmail || autoSyncedThread.current === project.gmailThreadId) return;
    autoSyncedThread.current = project.gmailThreadId;
    const timer = window.setTimeout(() => void refresh(false), 0);
    return () => window.clearTimeout(timer);
  }, [canUseGmail, project.gmailThreadId, refresh]);

  useEffect(() => {
    const handleSync = (event: Event) => {
      const detail = (event as CustomEvent<{ projectId?: string }>).detail;
      if (detail?.projectId === project.id) void loadCached();
    };
    window.addEventListener('hexforge:gmail-synced', handleSync);
    return () => window.removeEventListener('hexforge:gmail-synced', handleSync);
  }, [loadCached, project.id]);

  const downloadAttachment = async (attachment: GmailThreadMessage['attachments'][number]) => {
    const attachmentKey = `${attachment.messageId}-${attachment.partId}`;
    if (downloadingAttachment || helperState !== 'connected' || !canUseGmail) return;
    setDownloadingAttachment(attachmentKey);
    try {
      let prepared = await prepareGmailAttachmentDownload(project, helperClient, undefined, [attachment]);
      if (prepared.resolution.status === 'ambiguous') {
        const labels = prepared.resolution.candidates.map((candidate) => `${candidate.folderName} — ${candidate.workflowFolder.replaceAll('_', ' ')}`);
        const selection = await prompt({
          title: 'Choose the project folder',
          message: 'Several folders use this project priority. Choose the confirmed match before downloading attachments.',
          fields: [{ name: 'folder', label: 'Project folder', type: 'select', options: labels, required: true }],
          confirmLabel: 'Use this folder'
        });
        const selectedCandidate = prepared.resolution.candidates[labels.indexOf(selection?.folder || '')];
        if (!selectedCandidate) return;
        prepared = await prepareGmailAttachmentDownload(project, helperClient, selectedCandidate.candidateId, [attachment]);
      }
      if (prepared.resolution.status === 'ambiguous') {
        notify({ title: 'Attachments not downloaded', message: 'The selected folder could not be resolved. Try again.', tone: 'warning' });
        return;
      }
      if (prepared.resolution.status === 'not_found' || prepared.attachments.length === 0) {
        notify({ title: 'Attachment was not downloaded', message: 'The project folder could not be created or the attachment is already saved.', tone: 'info' });
        return;
      }
      const result = await downloadPreparedGmailAttachments(project, helperClient, prepared as PreparedGmailAttachmentDownload);
      await Promise.all([loadCached(), loadAvailableLocalFiles()]);
      notify({
        title: result.failed ? 'Attachment download completed with warnings' : 'Gmail attachment downloaded',
        message: `${result.saved} saved, ${result.skipped} skipped, ${result.renamed} safely renamed${result.failed ? `, ${result.failed} failed` : ''}.`,
        tone: result.failed ? 'warning' : 'success'
      });
    } catch (error) {
      notify({ title: 'Gmail attachments were not downloaded', message: error instanceof Error ? error.message : 'The local helper could not complete the download.', tone: 'warning' });
    } finally {
      setDownloadingAttachment(null);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/35 backdrop-blur-[2px] print:hidden" onClick={onClose}>
      <aside className="forge-drawer flex h-full w-full max-w-2xl flex-col" onClick={(event) => event.stopPropagation()} aria-label="Main Gmail Thread correspondence">
        <header className="border-b border-slate-300 bg-white/95 px-5 py-4 backdrop-blur">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">Main Gmail Thread</p>
              <h2 className="truncate text-lg font-black text-slate-950">{project.gmailThreadSubject || 'View Correspondence'}</h2>
              {project.gmailThreadId && <p className="mt-1 text-xs font-semibold text-slate-600">Main contact: {project.gmailMainContactEmail || 'Not detected'} · Last refresh: {project.gmailLastSyncedAt ? formatDateTime(project.gmailLastSyncedAt) : 'Not yet refreshed'}</p>}
            </div>
            <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close correspondence"><X size={18} /></Button>
          </div>
          {project.gmailThreadId && (
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="inline-flex" title={!canUseGmail ? GMAIL_THREAD_ACCOUNT_MISMATCH : undefined}>
                <Button variant="outline" size="sm" className="gap-2" onClick={() => void refresh(true)} disabled={refreshing || !canUseGmail}>
                  {refreshing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Refresh
                </Button>
              </span>
              <span className="inline-flex" title={!canUseGmail ? GMAIL_THREAD_ACCOUNT_MISMATCH : undefined}>
                <Button variant="outline" size="sm" className="gap-2" onClick={() => openGmailThread(project.gmailThreadId!)} disabled={!canUseGmail}>
                  <ExternalLink size={14} /> Open Thread in Gmail
                </Button>
              </span>
            </div>
          )}
        </header>
        <div className="flex-1 overflow-y-auto bg-slate-100 p-4 sm:p-5">
          {warning && <div className="mb-4 flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs font-semibold text-amber-900"><AlertTriangle size={15} className="mt-0.5 shrink-0" /><span>{warning}</span></div>}
          {!project.gmailThreadId ? (
            <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center">
              <Mail size={28} className="mx-auto text-slate-400" />
              <h3 className="mt-3 text-sm font-black text-slate-900">No Main Gmail Thread linked</h3>
              <p className="mt-1 text-xs font-semibold text-slate-600">Open Project Details to link a recent Gmail thread.</p>
            </div>
          ) : loadingCache && messages.length === 0 ? (
            <div className="flex min-h-48 items-center justify-center gap-2 text-sm font-bold text-slate-600"><Loader2 size={18} className="animate-spin" /> Loading saved messages…</div>
          ) : messages.length === 0 ? (
            <div className="rounded-lg border border-slate-300 bg-white p-8 text-center text-sm font-semibold text-slate-600">No cached messages yet. Use Refresh to retrieve the Main Gmail Thread.</div>
          ) : (
            <div className="space-y-4">
              {messages.map((message) => (
                <article key={message.id} className={`flex ${message.direction === 'outgoing' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[88%] rounded-lg border p-4 shadow-sm ${message.direction === 'outgoing' ? 'border-sky-300 bg-sky-50' : 'border-slate-300 bg-white'}`}>
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                      <p className="text-xs font-black text-slate-900">{message.senderName || message.senderEmail || (message.direction === 'outgoing' ? 'HexForge' : 'Unknown sender')}</p>
                      <time className="text-[10px] font-bold text-slate-500">{formatDateTime(message.messageDate)}</time>
                    </div>
                    {message.senderName && <p className="mt-0.5 text-[10px] font-semibold text-slate-500">{message.senderEmail}</p>}
                    <p className="mt-3 whitespace-pre-wrap break-words text-sm font-medium leading-relaxed text-slate-800">{message.body || '(No plain-text body)'}</p>
                    {message.attachments.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1.5 border-t border-slate-200 pt-3">
                        {message.attachments.map((attachment) => {
                          const attachmentKey = `${attachment.messageId}-${attachment.partId}`;
                          const downloadable = isSupportedGmailAttachment(attachment.filename);
                          const alreadySaved = isGmailAttachmentSavedLocally(attachment, availableLocalFiles);
                          return (
                            <span key={attachmentKey} className="forge-badge inline-flex items-center gap-1 px-2 py-1 text-[10px]">
                              <Paperclip size={11} /> {attachment.filename}
                              {downloadable && <span className="inline-flex" title={!canUseGmail ? GMAIL_THREAD_ACCOUNT_MISMATCH : alreadySaved ? 'Already saved to the project folder on this workstation.' : helperState !== 'connected' ? 'Connect the local helper to download this attachment.' : `Download ${attachment.filename}`}>
                                <Button variant="ghost" size="sm" className="-my-1 ml-1 h-6 gap-1 px-1.5 text-[10px]" onClick={() => void downloadAttachment(attachment)} disabled={Boolean(downloadingAttachment) || helperState !== 'connected' || checkingLocalFiles || alreadySaved || !canUseGmail}>
                                  {downloadingAttachment === attachmentKey || checkingLocalFiles ? <Loader2 size={11} className="animate-spin" /> : <Download size={11} />} {alreadySaved ? 'Saved' : 'Download'}
                                </Button>
                              </span>}
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
};
