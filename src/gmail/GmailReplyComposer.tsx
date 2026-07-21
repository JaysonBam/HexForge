import { useRef, useState } from 'react';
import { Loader2, Send, X } from 'lucide-react';
import type { Project } from '../types';
import { Button } from '../components/ui/Button';
import { useFeedback } from '../components/ui/FeedbackProvider';
import { RichEmailEditor } from '../components/settings/RichEmailEditor';
import gmailIcon from '../assets/icons/gmail.svg';
import { GmailAuthError, requestGmailDraftAccess, type GmailAttachment } from '../utils/gmailDraftUtils';
import { sendProjectGmailReply } from './gmailProjectService';
import { GMAIL_THREAD_ACCOUNT_MISMATCH, useProjectGmailThreadAccess } from './gmailThreadAccess';

export const GmailReplyComposer = ({
  project,
  initialBody,
  initialHtmlBody,
  getAttachments,
  disabled = false
}: {
  project: Project;
  initialBody: string;
  initialHtmlBody: string;
  getAttachments?: () => Promise<GmailAttachment[]>;
  disabled?: boolean;
}) => {
  const { confirm, notify, showMessage } = useFeedback();
  const { canUseGmail } = useProjectGmailThreadAccess(project);
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState(initialBody);
  const [htmlBody, setHtmlBody] = useState(initialHtmlBody);
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);

  const show = () => {
    setBody(initialBody);
    setHtmlBody(initialHtmlBody);
    setOpen(true);
  };

  const send = async () => {
    if (sendingRef.current || !body.trim()) return;
    sendingRef.current = true;
    setSending(true);
    try {
      await sendProjectGmailReply(project, {
        subject: project.gmailThreadSubject || '(no subject)',
        body: body.trim(),
        htmlBody,
        attachments: getAttachments ? await getAttachments() : []
      });
      setOpen(false);
      notify({ title: 'Reply sent', message: 'The message was sent into the Main Gmail Thread.', tone: 'success' });
    } catch (error) {
      if (error instanceof GmailAuthError) {
        const reconnect = await confirm({
          title: 'Gmail access needed',
          message: 'Grant Gmail access to send this reply.',
          messages: [error.message],
          confirmLabel: 'Grant Gmail Access'
        });
        if (reconnect) await requestGmailDraftAccess();
      } else {
        await showMessage({ title: 'Reply was not sent', messages: [error instanceof Error ? error.message : 'Unexpected Gmail send error.'], tone: 'error' });
      }
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  return (
    <>
      <span className="inline-flex" title={!canUseGmail ? GMAIL_THREAD_ACCOUNT_MISMATCH : undefined}>
        <Button variant="success" onClick={show} size="sm" className="gap-2 px-3.5" disabled={disabled || sending || !canUseGmail}>
          <img src={gmailIcon} alt="" className="h-4 w-4" /> Send Reply
        </Button>
      </span>
      {open && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-[2px]" onClick={() => !sending && setOpen(false)}>
          <section className="forge-drawer max-h-[92vh] w-full max-w-4xl overflow-hidden rounded-lg" role="dialog" aria-modal="true" aria-labelledby="gmail-reply-title" onClick={(event) => event.stopPropagation()}>
            <header className="flex items-start justify-between gap-4 border-b border-slate-300 bg-white px-5 py-4">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">Main Gmail Thread</p>
                <h2 id="gmail-reply-title" className="text-lg font-black text-slate-950">Preview and send reply</h2>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setOpen(false)} disabled={sending} aria-label="Close reply preview"><X size={18} /></Button>
            </header>
            <div className="max-h-[calc(92vh-9rem)] space-y-4 overflow-y-auto bg-slate-100 p-5">
              <div className="grid gap-3 rounded-lg border border-slate-300 bg-white p-4 text-xs">
                <p><span className="font-black text-slate-500">To:</span> <span className="font-semibold text-slate-900">{project.gmailMainContactEmail || project.email}</span></p>
                <p><span className="font-black text-slate-500">Subject:</span> <span className="font-semibold text-slate-900">{project.gmailThreadSubject || '(no subject)'}</span></p>
              </div>
              <div>
                <p className="mb-2 text-sm font-bold text-slate-800">Reply</p>
                <RichEmailEditor
                  value={htmlBody}
                  onChange={(nextHtml) => {
                    setHtmlBody(nextHtml);
                    const document = new DOMParser().parseFromString(nextHtml, 'text/html');
                    setBody((document.body.textContent || '').replace(/\u00a0/g, ' ').trim());
                  }}
                  allowImages={false}
                  allowTokens={false}
                />
              </div>
              <p className="text-xs font-semibold text-slate-600">The thread is refreshed once before sending. This reply stays in Gmail and is cached in project correspondence.</p>
            </div>
            <footer className="flex justify-end gap-2 border-t border-slate-300 bg-white px-5 py-4">
              <Button variant="ghost" onClick={() => setOpen(false)} disabled={sending}>Cancel</Button>
              <Button variant="success" className="gap-2" onClick={() => void send()} disabled={sending || !body.trim()}>
                {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />} {sending ? 'Sending…' : 'Send Reply'}
              </Button>
            </footer>
          </section>
        </div>
      )}
    </>
  );
};
