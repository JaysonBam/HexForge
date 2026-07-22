import type { Project, Part } from '../../types';
import { useProjects } from '../../context/ProjectContext';
import { useSettings } from '../../context/SettingsContext';
import { useStaffActionName } from '../../hooks/useStaffActionName';
import { compareQuoteSnapshot } from '../../domain/quoteState';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '../ui/Button';
import { useFeedback } from '../ui/FeedbackProvider';
import { getStudentEmail } from '../../domain/operations';
import { createGmailDraft, GmailAuthError, requestGmailDraftAccess } from '../../utils/gmailDraftUtils';
import { createQuotePdfBytes, loadQuoteLogoImage } from '../../utils/quotePdfUtils';
import { renderEmailTemplate } from '../../domain/emailTemplates';
import { buildProjectQuoteAttachment } from '../../utils/projectQuoteAttachment';
import { copyRichTextToClipboard } from '../../utils/clipboardUtils';
import {
  getPartFilamentSource,
  isProvidedFilamentSource
} from '../../domain/filamentSource.ts';
import { Archive, CheckCircle, Copy } from 'lucide-react';
import gmailIcon from '../../assets/icons/gmail.svg';
import { QuoteCostSummary } from './QuoteCostSummary';
import { GmailReplyComposer } from '../../gmail/GmailReplyComposer';
import {
  buildQuoteViews,
  formatCurrency,
  formatLineMaterialLabel,
  formatLineWeight
} from './quoteCostSummaryModel';

export const CheckpointConfirmation = ({ project, onAdvanceToProduction }: { project: Project; onAdvanceToProduction?: () => void }) => {
  const { updateProject, transitionProjectState } = useProjects();
  const {
    getFilamentPrice,
    filaments,
    providedFilamentPricePerGram,
    emailTemplates,
    emailSignature,
    refreshEmailSettings
  } = useSettings();
  const { requestStaffName } = useStaffActionName();
  const { confirm, notify, prompt, showMessage } = useFeedback();
  const [isOpeningGmail, setIsOpeningGmail] = useState(false);
  const [pendingAction, setPendingAction] = useState<'quote' | 'printing' | 'archive' | null>(null);
  // Derive individual costs based on latest price settings
  const getPrimaryCost = (part: Part) => {
    const weight = part.primaryEstimatedWeight || 0;
    const source = getPartFilamentSource(part.primaryFilamentSource, part.primaryOwnFilament);
    return isProvidedFilamentSource(source)
      ? weight * providedFilamentPricePerGram
      : weight * getFilamentPrice(part.primaryMaterial);
  };

  const getSecondaryCost = (part: Part) => {
    if (!part.secondaryMaterial) return 0;
    const weight = part.secondaryEstimatedWeight || 0;
    const source = getPartFilamentSource(part.secondaryFilamentSource, part.secondaryOwnFilament);
    return isProvidedFilamentSource(source)
      ? weight * providedFilamentPricePerGram
      : weight * getFilamentPrice(part.secondaryMaterial);
  };

  const liveTotalCost = project.parts.reduce((sum, p) => sum + getPrimaryCost(p) + getSecondaryCost(p), 0);
  const issuedSnapshot = project.quoteSnapshot;
  const quoteComparison = compareQuoteSnapshot(project, issuedSnapshot, getPrimaryCost, getSecondaryCost);
  const quoteActionMode = quoteComparison.status === 'no_quote' ? 'initial' : 'update';
  const quoteActionButtonLabel = quoteComparison.status === 'no_quote'
    ? 'Issue Initial Quote'
    : quoteComparison.status === 'outdated'
      ? 'Update Quote From Draft'
      : 'Issued Quote Up To Date';
  const snapshots = (project.quoteSnapshots || [])
    .slice()
    .sort((left, right) => left.snapshot_version - right.snapshot_version);
  const issuedSnapshots = snapshots.filter((snapshot) => snapshot.status === 'ISSUED');
  const currentIssuedSnapshot = issuedSnapshot || issuedSnapshots[issuedSnapshots.length - 1];
  const currentIssuedVersion = currentIssuedSnapshot?.snapshot_version ?? null;
  const previousSnapshots = snapshots.filter((snapshot) => snapshot.snapshot_version !== currentIssuedVersion);
  const [selectedQuoteViewId, setSelectedQuoteViewId] = useState<string>(
    currentIssuedSnapshot ? `snapshot-${currentIssuedSnapshot.snapshot_version}` : 'draft-current'
  );
  const draftLineSummary = quoteComparison.currentLineSummary;
  const draftTotalCost = quoteComparison.currentTotalCost || liveTotalCost;
  const quoteViews = useMemo(() => buildQuoteViews({
    previousSnapshots,
    currentIssuedSnapshot,
    quoteStatus: quoteComparison.status,
    draftTotalCost,
    draftLineSummary
  }), [currentIssuedSnapshot, draftLineSummary, draftTotalCost, previousSnapshots, quoteComparison.status]);
  const selectedQuoteView = quoteViews.find((view) => view.id === selectedQuoteViewId) ?? quoteViews[0];
  const showQuoteViewSelect = quoteViews.length > 1 && (previousSnapshots.length > 0 || quoteComparison.status === 'outdated');
  const quoteIsIssued = quoteComparison.hasSnapshot;
  const quotePdfLines = (currentIssuedSnapshot?.line_summary || []).map((line) => ({
    partName: line.part_name,
    materials: line.materials.map(formatLineMaterialLabel),
    weights: line.materials.map((material) => formatLineWeight(material.grams)),
    costs: line.materials.map((material) => formatCurrency(Number(material.cost || 0)))
  }));

  useEffect(() => {
    if (quoteViews.length === 0) return;
    if (!quoteViews.some((view) => view.id === selectedQuoteViewId)) {
      setSelectedQuoteViewId(currentIssuedSnapshot ? `snapshot-${currentIssuedSnapshot.snapshot_version}` : quoteViews[0].id);
    }
  }, [currentIssuedSnapshot, quoteViews, selectedQuoteViewId]);
  const studentNeedsToPay =
    project.needsPayment &&
    !project.moduleOrLecturerPays &&
    !(project.paymentOverrideNote && project.paymentOverrideNote.trim() !== '');
  const unverifiedParts = project.parts.filter(
    part => !['VERIFIED', 'READY', 'PRINTING', 'PRINTED', 'POST_PROCESSING', 'COLLECTED'].includes(part.printStatus)
  );

  const validateQuoteActions = async () => {
    if (project.parts.length === 0) {
      await showMessage({ title: 'No parts to quote', messages: ['Add and verify at least one part before continuing.'], tone: 'warning' });
      return false;
    }

    if (unverifiedParts.length > 0) {
      await showMessage({ title: 'Parts still need verification', messages: ['Please verify all parts before continuing.'], tone: 'warning' });
      return false;
    }

    return true;
  };

  const handleIssueQuote = async () => {
    if (pendingAction) return;
    if (!(await validateQuoteActions())) return;

    const technicianName = await requestStaffName('issuing this quote');
    if (!technicianName) return;

    setPendingAction('quote');
    const result = await transitionProjectState({
      projectId: project.id,
      action: 'ISSUE_QUOTE',
      technicianName
    });
    setPendingAction(null);

    if (!result.ok) {
      await showMessage({
        title: quoteActionMode === 'initial' ? 'Initial quote was not created' : 'Quote was not updated',
        messages: result.errors,
        tone: 'error'
      });
      return;
    }

    if (result.warnings && result.warnings.length > 0) {
      await showMessage({
        title: quoteActionMode === 'initial' ? 'Initial quote created with warnings' : 'Quote updated with warnings',
        messages: result.warnings,
        tone: 'warning'
      });
    } else {
      notify({ title: quoteActionMode === 'initial' ? 'Initial quote created' : 'Quote updated', message: 'The issued pricing snapshot is now up to date.', tone: 'success' });
    }
  };

  const handleMoveToPrinting = async () => {
    if (pendingAction) return;
    if (!(await validateQuoteActions())) return;

    if (!quoteComparison.hasSnapshot) {
      await showMessage({
        title: 'Initial quote required',
        messages: ['Make an initial quote before confirming production.'],
        tone: 'warning'
      });
      return;
    }

    const technicianName = await requestStaffName('starting production');
    if (!technicianName) return;

    const paymentHandled =
      !project.needsPayment ||
      (project.receiptNumber && project.receiptNumber.trim() !== '') ||
      project.moduleOrLecturerPays ||
      (project.paymentOverrideNote && project.paymentOverrideNote.trim() !== '');

    const resultValues = paymentHandled
      ? null
      : await prompt({
          title: 'Payment override required',
          message: 'Payment is not cleared. Record an emergency override note before releasing this project.',
          confirmLabel: 'Confirm Quote and Start Printing',
          tone: 'warning',
          fields: [
            { name: 'overrideNote', label: 'Override note', type: 'textarea' as const, required: true }
          ]
        });
    const overrideNote = resultValues?.overrideNote?.trim();
    if (!paymentHandled && !overrideNote) return;

    setPendingAction('printing');
    const result = await transitionProjectState({
      projectId: project.id,
      action: 'MOVE_TO_PRINTING',
      technicianName,
      overrideNote
    });
    setPendingAction(null);

    if (!result.ok) {
      await showMessage({ title: 'Cannot move to printing', messages: result.errors, tone: 'error' });
      return;
    }

    if (result.warnings && result.warnings.length > 0) {
      await showMessage({ title: 'Moved with warnings', messages: result.warnings, tone: 'warning' });
    } else {
      notify({ title: 'Production started', message: 'Project moved to Production.', tone: 'success' });
    }
    onAdvanceToProduction?.();
  };

  const handleArchive = async () => {
    if (pendingAction) return;
    const shouldCancel = await confirm({
      title: 'Cancel project',
      message: 'This keeps the record but removes it from the active workflow.',
      confirmLabel: 'Cancel Project',
      tone: 'error'
    });
    if (!shouldCancel) return;

    const technicianName = await requestStaffName('cancelling this project');
    if (!technicianName) return;

    const resultValues = await prompt({
      title: 'Cancellation details',
      confirmLabel: 'Record Cancellation',
      fields: [
        { name: 'reason', label: 'Reason', type: 'textarea', required: true }
      ]
    });
    const reason = resultValues?.reason.trim();
    if (!reason) return;

    setPendingAction('archive');
    const result = await transitionProjectState({
      projectId: project.id,
      action: 'CANCEL_PROJECT',
      technicianName,
      reason
    });
    setPendingAction(null);

    if (!result.ok) {
      await showMessage({ title: 'Project was not cancelled', messages: result.errors, tone: 'error' });
      return;
    }

    if (result.warnings && result.warnings.length > 0) {
      await showMessage({ title: 'Cancelled with warnings', messages: result.warnings, tone: 'warning' });
    } else {
      notify({ title: 'Project archived', message: 'The project was removed from the active workflow.', tone: 'success' });
    }
  };

  const getQuotePdfFilename = () => `MISC-quote-${project.priorityNumber}-${project.studentNumber}.pdf`;

  const buildQuotePdfBytes = async () => createQuotePdfBytes({
    project,
    totalCost: Number(currentIssuedSnapshot?.total_cost || 0),
    lines: quotePdfLines,
    filaments,
    providedFilamentPricePerGram,
    logo: await loadQuoteLogoImage()
  });

  const downloadQuotePdf = async () => {
    if (!quoteIsIssued || !currentIssuedSnapshot) {
      await showMessage({
        title: 'Initial quote required',
        messages: ['Issue the initial quote before downloading an official quote PDF.'],
        tone: 'warning'
      });
      return;
    }

    try {
      const bytes = await buildQuotePdfBytes();
      const pdfBuffer = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(pdfBuffer).set(bytes);
      const blob = new Blob([pdfBuffer], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = getQuotePdfFilename();
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      await showMessage({
        title: 'Quote PDF was not downloaded',
        messages: [error instanceof Error ? error.message : 'Unexpected PDF generation error.'],
        tone: 'error'
      });
    }
  };

  const quoteEmailTemplateKey = studentNeedsToPay ? 'quote_payment_required' : 'quote_no_payment_required';
  const communicationEmail = renderEmailTemplate({
    templates: emailTemplates,
    signature: emailSignature,
    templateKey: quoteEmailTemplateKey,
    project,
    suppressSignature: true
  });
  const replyEmail = renderEmailTemplate({
    templates: emailTemplates,
    signature: emailSignature,
    templateKey: quoteEmailTemplateKey,
    project
  });
  const emailContent = communicationEmail.plainBody;
  const displayedEmailContent = quoteIsIssued
    ? emailContent
    : 'Issue an initial quote before preparing student communication.';

  const copyToClipboard = async () => {
    if (!quoteIsIssued) {
      await showMessage({
        title: 'Initial quote required',
        messages: ['Issue the initial quote before copying student communication.'],
        tone: 'warning'
      });
      return;
    }

    await copyRichTextToClipboard(emailContent, communicationEmail.htmlBody);
    notify({ message: 'Email content copied to clipboard.', tone: 'success' });
  };

  const getQuotePdfAttachment = async () => buildProjectQuoteAttachment(
    project,
    getFilamentPrice,
    filaments,
    providedFilamentPricePerGram
  );

  const createAndOpenDraft = async (subject: string, body: string, htmlBody: string, attachQuote: boolean) => {
    if (isOpeningGmail) return false;
    setIsOpeningGmail(true);
    const studentEmail = project.email?.trim() || getStudentEmail(project.studentNumber);
    if (!studentEmail) {
      try {
        await showMessage({
          title: 'Cannot prepare email',
          messages: ['Student number must be exactly 8 digits before a Tuks email address can be generated.'],
          tone: 'warning'
        });
      } finally {
        setIsOpeningGmail(false);
      }
      return false;
    }

    try {
      const draft = await createGmailDraft({
        to: studentEmail,
        subject,
        body,
        htmlBody,
        attachments: attachQuote ? [await getQuotePdfAttachment()] : []
      });
      window.open(draft.url, '_blank', 'noopener,noreferrer');
      return true;
    } catch (error) {
      if (error instanceof GmailAuthError) {
        const shouldReconnect = await confirm({
          title: 'Gmail access needed',
          message: 'To create Gmail drafts with attachments, sign in with Google again and approve Gmail draft access.',
          messages: [error.message],
          confirmLabel: 'Grant Gmail Access'
        });
        if (shouldReconnect) await requestGmailDraftAccess();
        return false;
      }

      await showMessage({
        title: 'Gmail draft was not created',
        messages: [error instanceof Error ? error.message : 'Unexpected Gmail API error.'],
        tone: 'error'
      });
      return false;
    } finally {
      setIsOpeningGmail(false);
    }
  };

  const sendEmail = async () => {
    if (!quoteIsIssued) {
      await showMessage({
        title: 'Initial quote required',
        messages: ['Issue the initial quote before opening student communication.'],
        tone: 'warning'
      });
      return;
    }

    const latestEmailSettings = await refreshEmailSettings();
    const emailForDraft = renderEmailTemplate({
      templates: latestEmailSettings.emailTemplates,
      signature: latestEmailSettings.emailSignature,
      templateKey: quoteEmailTemplateKey,
      project
    });

    await createAndOpenDraft(
      emailForDraft.subject,
      emailForDraft.plainBody,
      emailForDraft.htmlBody,
      emailForDraft.attachQuote
    );
  };

  const quoteStatusTitle = quoteComparison.status === 'no_quote'
    ? 'No quote issued yet'
    : quoteComparison.status === 'up_to_date'
      ? 'Issued quote up to date'
      : 'Issued quote outdated';
  const quoteStatusBody = quoteComparison.status === 'no_quote'
    ? 'Make an initial quote to lock the current pricing snapshot.'
    : quoteComparison.status === 'up_to_date'
      ? 'The latest issued quote matches the current project data.'
      : 'The latest issued quote no longer matches the current project data. You can still continue to printing, or update the quote first if you want the snapshot to match.';
  const quoteStatusTotal = quoteComparison.status === 'no_quote'
    ? `Current total: ${formatCurrency(liveTotalCost)}`
    : quoteComparison.status === 'up_to_date'
      ? `Issued total: ${formatCurrency(quoteComparison.issuedTotalCost)}`
      : `Issued total: ${formatCurrency(quoteComparison.issuedTotalCost)} | Current total: ${formatCurrency(quoteComparison.currentTotalCost)}`;
  const productionReadinessBody = quoteComparison.status === 'no_quote'
    ? 'You need an initial quote before production can be confirmed.'
    : quoteComparison.status === 'outdated'
      ? 'The latest issued quote is outdated, but you can still continue to printing. Update it first if you want the snapshot to match the current project data.'
      : 'The latest issued quote is current. If payment is not cleared, confirmation will require an emergency override note.';

  return (
    <div className="w-full space-y-6">
        <QuoteCostSummary
          quoteViews={quoteViews}
          selectedQuoteView={selectedQuoteView}
          selectedQuoteViewId={selectedQuoteViewId}
          setSelectedQuoteViewId={setSelectedQuoteViewId}
          showQuoteViewSelect={showQuoteViewSelect}
          quoteIsIssued={quoteIsIssued}
          quoteStatus={quoteComparison.status}
          currentIssuedVersion={currentIssuedVersion}
          downloadQuotePdf={downloadQuotePdf}
        />

        <section className="forge-panel p-5">
            <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
                <div>
                    <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-600">Payment Management</p>
                    <h3 className="mt-1 text-xl font-black text-slate-950">Quote, receipt and payment controls</h3>
                </div>
                <Button
                    className="gap-2"
                    variant="outline"
                    onClick={handleIssueQuote}
                    disabled={project.parts.length === 0 || unverifiedParts.length > 0 || quoteComparison.status === 'up_to_date' || pendingAction !== null}
                    loading={pendingAction === 'quote'}
                    loadingText={quoteActionMode === 'initial' ? 'Creating Quote…' : 'Updating Quote…'}
                    title={quoteComparison.status === 'outdated' ? 'Supersede the current issued quote with updated draft values.' : undefined}
                >
                    <CheckCircle className="w-5 h-5" /> {quoteActionButtonLabel}
                </Button>
            </div>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]">
                <div className="space-y-4">
                    <div className="forge-panel-muted px-4 py-3">
                        <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-600">Quote Status</p>
                        <h4 className="mt-1 text-lg font-black text-slate-950">{quoteStatusTitle}</h4>
                        <p className="mt-2 text-sm font-semibold text-slate-700">{quoteStatusBody}</p>
                        <div className="mt-3 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700">
                            {quoteStatusTotal}
                        </div>
                        {quoteComparison.status === 'outdated' && (
                            <p className="mt-3 text-sm font-semibold text-amber-800">
                                Updating will replace current issued v{currentIssuedSnapshot?.snapshot_version} with the updated draft values shown in the cost summary selector.
                            </p>
                        )}
                        {quoteComparison.status === 'outdated' && quoteComparison.differences.length > 0 && (
                          <div className="forge-alert-warm mt-4 rounded-md px-3 py-3 text-sm">
                            <p className="font-bold">What changed</p>
                            <ul className="mt-2 list-disc space-y-1 pl-5">
                              {quoteComparison.differences.map((difference, index) => (
                                <li key={`${index}-${difference}`}>{difference}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                    </div>

                    <div>
                        <label className="mb-1 block text-sm font-medium text-slate-800">Payment Note (internal)</label>
                        <textarea
                            value={project.paymentNote || ''}
                            onChange={(e) => updateProject(project.id, { paymentNote: e.target.value })}
                            placeholder="Optional context about who pays or where payment is tracked."
                            className="forge-command-input min-h-[92px] w-full px-3 py-2 text-sm"
                        />
                    </div>
                </div>

                <div className="space-y-4">
                    <div className="forge-panel-muted p-4">
                        <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-600">Payment Record</p>
                        <p className="mt-1 text-sm font-semibold text-slate-700">
                            {project.moduleOrLecturerPays
                                ? 'Covered by module/lecturer.'
                                : project.needsPayment
                                    ? 'Receipt number confirms the payment record for this project.'
                                    : 'No student payment required.'}
                        </p>
                        {project.needsPayment && !project.moduleOrLecturerPays && (
                            <div className="mt-3">
                                <label className="mb-1 block text-sm font-bold text-slate-800">Receipt Number</label>
                                <input
                                    type="text"
                                    value={project.receiptNumber || ''}
                                    onChange={(e) => updateProject(project.id, { receiptNumber: e.target.value })}
                                    placeholder="Enter receipt number"
                                    className="forge-command-input w-full px-3 py-2 text-sm font-medium"
                                />
                                {!project.receiptNumber?.trim() && (
                                    <p className="mt-1 text-xs font-semibold text-rose-600">Receipt number confirms payment before printing.</p>
                                )}
                            </div>
                        )}
                    </div>

                    {project.needsPayment && !project.moduleOrLecturerPays && (
                        <div>
                            <label className="mb-1 block text-sm font-medium text-slate-800">Payment Override Note</label>
                            <textarea
                                value={project.paymentOverrideNote || ''}
                                onChange={(e) => updateProject(project.id, { paymentOverrideNote: e.target.value })}
                                placeholder="Optional approved exception if printing may start before payment is cleared."
                                className="forge-command-input min-h-[92px] w-full px-3 py-2 text-sm"
                            />
                        </div>
                    )}
                </div>
            </div>
        </section>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
            <div className="forge-panel-muted p-4">
                <div className="mb-4 flex items-center justify-between gap-3">
                    <h3 className="text-lg font-semibold text-slate-900">Communication</h3>
                    {project.gmailThreadId ? (
                      <GmailReplyComposer
                        project={project}
                        initialBody={replyEmail.plainBody}
                        initialHtmlBody={replyEmail.htmlBody}
                        getAttachments={replyEmail.attachQuote ? async () => [await getQuotePdfAttachment()] : undefined}
                        disabled={!quoteIsIssued}
                      />
                    ) : (
                      <Button
                          variant="success"
                          onClick={sendEmail}
                          size="sm"
                          className="gap-2 px-3.5"
                          disabled={!quoteIsIssued}
                          loading={isOpeningGmail}
                          loadingText="Opening Gmail…"
                          title={!quoteIsIssued ? 'Issue the initial quote before opening communication.' : undefined}
                      >
                          <img src={gmailIcon} alt="" className="h-4 w-4" />
                          Open in Gmail
                      </Button>
                    )}
                </div>
                
                <div className="relative">
                    <textarea 
                        className="forge-command-input h-48 w-full p-3 pr-20 text-sm leading-relaxed"
                        value={displayedEmailContent}
                        readOnly
                    />
                    <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={copyToClipboard}
                        className="absolute right-5 top-2.5 h-8 w-8 rounded-full border-slate-300 bg-white text-slate-700 shadow-sm hover:bg-slate-100"
                        aria-label="Copy email to clipboard"
                        title="Copy email to clipboard"
                        disabled={!quoteIsIssued}
                    >
                        <Copy className="h-4 w-4" />
                    </Button>
                </div>
            </div>

            <div className="rounded-lg border border-teal-300 bg-teal-100 p-5 shadow-sm">
                <p className="text-xs font-black uppercase tracking-[0.14em] text-teal-800">Ready for Production</p>
                <h3 className="mt-1 text-lg font-black text-teal-950">Confirm Quote and Start Printing</h3>
                <p className="mt-2 text-sm font-semibold text-teal-900">
                    {productionReadinessBody}
                </p>
                <Button
                    className="mt-4 w-full gap-2"
                    variant="success"
                    onClick={handleMoveToPrinting}
                    title={!quoteComparison.hasSnapshot ? 'Issue the initial quote before moving to printing.' : undefined}
                    disabled={project.parts.length === 0 || unverifiedParts.length > 0 || !quoteComparison.hasSnapshot || pendingAction !== null}
                    loading={pendingAction === 'printing'}
                    loadingText="Starting Production…"
                >
                    <CheckCircle className="w-5 h-5" /> Confirm Quote and Start Printing
                </Button>
                {!quoteComparison.hasSnapshot && (
                  <p className="mt-2 text-xs font-semibold text-teal-800">
                    Download, communication, and production unlock after the first quote is issued.
                  </p>
                )}
            </div>
        </div>

        <div className="border-t border-slate-300 pt-4">
            <Button variant="outline" className="gap-2 border-rose-300 text-rose-800 hover:bg-rose-100" onClick={handleArchive} disabled={pendingAction !== null} loading={pendingAction === 'archive'} loadingText="Archiving…">
                <Archive className="w-4 h-4" /> Cancel / Archive Project
            </Button>
        </div>
    </div>
  );
};
