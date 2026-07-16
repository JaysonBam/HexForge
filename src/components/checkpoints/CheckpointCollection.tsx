import type { Project, Part } from '../../types';
import { useProjects } from '../../context/ProjectContext';
import { useSettings } from '../../context/SettingsContext';
import { useStaffSession } from '../../context/StaffSessionContext';
import { useState } from 'react';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { useFeedback } from '../ui/FeedbackProvider';
import { getMissingStaffMessage } from '../../utils/staffSessionUtils';
import { getStudentEmail, isCollectionBlocked } from '../../domain/operations';
import { createGmailDraft, GmailAuthError, requestGmailDraftAccess } from '../../utils/gmailDraftUtils';
import { renderEmailTemplate } from '../../domain/emailTemplates';
import { buildProjectQuoteAttachment } from '../../utils/projectQuoteAttachment';
import { copyRichTextToClipboard } from '../../utils/clipboardUtils';
import {
    getPartFilamentSource,
    isProvidedFilamentSource
} from '../../domain/filamentSource.ts';
import { Copy, CheckSquare } from 'lucide-react';
import gmailIcon from '../../assets/icons/gmail.svg';
import { useLocalHelper } from '../../local-files/LocalHelperContext';
import { syncCollectedProjectFolder } from '../../local-files/statusSync';

export const CheckpointCollection = ({ project }: { project: Project }) => {
    const { updateProject, transitionPartStatus } = useProjects();
    const {
        getFilamentPrice,
        filaments,
        providedFilamentPricePerGram,
        emailTemplates,
        emailSignature,
        refreshEmailSettings
    } = useSettings();
    const { activeStaffName, claimActiveStaffName } = useStaffSession();
    const { confirm, notify, showMessage } = useFeedback();
    const { state: localHelperState, client: localHelperClient } = useLocalHelper();
    const [isOpeningGmail, setIsOpeningGmail] = useState(false);
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
    const displayedReceiptTotal = project.quoteSnapshot ? Number(project.quoteSnapshot.total_cost || 0) : liveTotalCost;

    const printableCollectionParts = project.parts.filter(
        p => p.printStatus === 'PRINTED' || p.printStatus === 'POST_PROCESSING' || p.printStatus === 'COLLECTED'
    );
    const isPaymentBlocked = isCollectionBlocked(project);

    const syncCollectedFolder = () => {
        if (localHelperState !== 'connected') return;
        void syncCollectedProjectFolder(localHelperClient, project).then((result) => {
            if (result.warning) {
                notify({ title: 'Project collected; folder unchanged', message: result.warning, tone: 'warning' });
            }
        });
    };

    const collectPart = async (partId: string) => {
        if (isPaymentBlocked) {
            await showMessage({
                title: 'Collection blocked',
                messages: ['This project still requires payment. Save the receipt number in the collection panel before collecting any parts.'],
                tone: 'warning'
            });
            return;
        }

        const name = claimActiveStaffName();
        if (!name) {
            await showMessage({
                title: 'Staff member required',
                messages: [getMissingStaffMessage('collecting a part')],
                tone: 'warning'
            });
            return;
        }

        const result = await transitionPartStatus({
            projectId: project.id,
            partId,
            action: 'COLLECT_PART',
            technicianName: name
        });

        if (!result.ok) {
            await showMessage({ title: 'Part was not collected', messages: result.errors, tone: 'error' });
            return;
        }

        const closesProject = project.parts.every((part) => part.id === partId || part.printStatus === 'COLLECTED');
        if (closesProject) syncCollectedFolder();

    };

    const collectAll = async () => {
        if (isPaymentBlocked) {
            await showMessage({
                title: 'Collection blocked',
                messages: ['This project still requires payment. Save the receipt number in the collection panel before collecting any parts.'],
                tone: 'warning'
            });
            return;
        }

        const staffName = claimActiveStaffName();
        if (!staffName) {
            await showMessage({
                title: 'Staff member required',
                messages: [getMissingStaffMessage('collecting parts')],
                tone: 'warning'
            });
            return;
        }

        let allSucceeded = true;
        for (const part of printableCollectionParts) {
            if (part.printStatus !== 'COLLECTED') {
                const result = await transitionPartStatus({
                    projectId: project.id,
                    partId: part.id,
                    action: 'COLLECT_PART',
                    technicianName: staffName.trim()
                });
                if (!result.ok) {
                    allSucceeded = false;
                    await showMessage({ title: 'Collection stopped', messages: result.errors, tone: 'error' });
                    break;
                }
            }
        }
        if (allSucceeded && printableCollectionParts.length === project.parts.length) syncCollectedFolder();
    };

    const collectionEmailTemplateKey = isPaymentBlocked ? 'collection_payment_reminder' : 'collection_ready';
    const communicationEmail = renderEmailTemplate({
        templates: emailTemplates,
        signature: emailSignature,
        templateKey: collectionEmailTemplateKey,
        project,
        suppressSignature: true
    });
    const emailContent = communicationEmail.plainBody;

    const copyToClipboard = async () => {
        await copyRichTextToClipboard(emailContent, communicationEmail.htmlBody);
        notify({ message: 'Email content copied to clipboard.', tone: 'success' });
    };

    const sendEmail = async () => {
        if (isOpeningGmail) return;
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
            return;
        }

        try {
            const latestEmailSettings = await refreshEmailSettings();
            const emailForDraft = renderEmailTemplate({
                templates: latestEmailSettings.emailTemplates,
                signature: latestEmailSettings.emailSignature,
                templateKey: collectionEmailTemplateKey,
                project
            });

            const draft = await createGmailDraft({
                to: studentEmail,
                subject: emailForDraft.subject,
                body: emailForDraft.plainBody,
                htmlBody: emailForDraft.htmlBody,
                attachments: emailForDraft.attachQuote
                    ? [await buildProjectQuoteAttachment(project, getFilamentPrice, filaments, providedFilamentPricePerGram)]
                    : []
            });
            window.open(draft.url, '_blank', 'noopener,noreferrer');
        } catch (error) {
            if (error instanceof GmailAuthError) {
                const shouldReconnect = await confirm({
                    title: 'Gmail access needed',
                    message: 'To create Gmail drafts, sign in with Google again and approve Gmail draft access.',
                    messages: [error.message],
                    confirmLabel: 'Grant Gmail Access'
                });
                if (shouldReconnect) await requestGmailDraftAccess();
                return;
            }

            await showMessage({
                title: 'Gmail draft was not created',
                messages: [error instanceof Error ? error.message : 'Unexpected Gmail API error.'],
                tone: 'error'
            });
        } finally {
            setIsOpeningGmail(false);
        }
    };

    return (
        <Card className="w-full p-6">
            <div className="mb-4 flex items-center justify-between">
                <h2 className="text-2xl font-bold">Collection</h2>
                {printableCollectionParts.length > 0 && printableCollectionParts.some(p => p.printStatus !== 'COLLECTED') && (
                    <Button
                        onClick={collectAll}
                        size="sm"
                        className="gap-2 bg-teal-700 text-white hover:bg-teal-800"
                        disabled={isPaymentBlocked}
                        title={isPaymentBlocked ? 'Enter the receipt number before collecting.' : undefined}
                    >
                        <CheckSquare className="w-4 h-4" /> Collect All Uncollected
                    </Button>
                )}
            </div>

            <div className="forge-panel-muted mb-6 p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div className="flex items-center gap-2 rounded-md border border-sky-300 bg-sky-100 py-1 pl-3 pr-1 shadow-sm">
                        <span className="text-sm font-semibold text-sky-900">Print Label:</span>
                        <input
                            type="text"
                            value={project.printLabel || ''}
                            onChange={(e) => updateProject(project.id, { printLabel: e.target.value })}
                            placeholder="E.g. Tray A1"
                            className="forge-command-input w-32 px-2 py-1 text-sm text-sky-950"
                        />
                    </div>

                    <div className="text-sm font-semibold text-slate-700">
                        Collection total: R {displayedReceiptTotal.toFixed(2)}
                    </div>

                    <div className="flex flex-col items-end gap-2">
                        {project.needsPayment && !project.moduleOrLecturerPays && (
                            <div className="flex flex-col items-start gap-1">
                                <label className="text-xs font-bold uppercase tracking-[0.12em] text-slate-600">
                                    Receipt Number
                                </label>
                                <input
                                    type="text"
                                    value={project.receiptNumber || ''}
                                    onChange={(e) => updateProject(project.id, { receiptNumber: e.target.value })}
                                    placeholder="Enter receipt number"
                                    className={`w-52 rounded-md border px-3 py-2 text-sm font-medium focus:outline-none focus:ring-1 ${
                                        isPaymentBlocked
                                            ? 'border-rose-300 bg-rose-50 text-rose-900 focus:border-rose-500 focus:ring-rose-500'
                                            : 'forge-command-input text-slate-900'
                                    }`}
                                />
                            </div>
                        )}

                        {isPaymentBlocked && (
                            <div className="rounded border border-red-300 bg-red-100 px-2 py-1 text-xs font-semibold text-red-800">
                                Enter the receipt number before collection can proceed.
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <div className="forge-panel-muted mt-8 mb-6 p-4">
                <div className="mb-4 flex items-center justify-between">
                    <h3 className="text-lg font-semibold text-slate-900">Communication</h3>
                    <div className="flex flex-wrap justify-end gap-2">
                        <Button
                            variant="success"
                            onClick={sendEmail}
                            size="sm"
                            className="gap-2 px-3.5"
                            disabled={isOpeningGmail}
                        >
                            <img src={gmailIcon} alt="" className="h-4 w-4" />
                            {isOpeningGmail ? 'Opening in Gmail...' : 'Open in Gmail'}
                        </Button>
                    </div>
                </div>

                <div className="space-y-4">
                    <div className="relative">
                        <textarea
                            className="forge-command-input h-40 w-full p-3 pr-20 text-sm font-medium leading-relaxed text-slate-700"
                            value={emailContent}
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
                        >
                            <Copy className="h-4 w-4" />
                        </Button>
                    </div>
                </div>
            </div>

            {printableCollectionParts.length === 0 ? (
                <div className="forge-empty px-4 py-8 text-center text-slate-700">No printed parts to collect yet.</div>
            ) : (
                <div className="space-y-3">
                    {printableCollectionParts.map(part => (
                        <Card key={part.id} className={`flex items-center justify-between p-3 ${part.printStatus === 'COLLECTED' ? 'border-teal-300 bg-teal-100/80 opacity-80' : ''}`}>
                            <div className="flex items-center gap-4">
                                {part.imageUrl && (
                                    <img src={part.imageUrl} alt={part.partName} className="h-16 w-16 rounded border bg-white object-contain" />
                                )}
                                <div>
                                    <div className="font-medium">{part.partName}</div>
                                    {part.specialInstruction && part.specialInstruction.trim() !== '' && (
                                        <div className="text-sm italic text-slate-700">Note: {part.specialInstruction}</div>
                                    )}
                                    <div className="mt-1 text-xs text-slate-600">
                                        Removed by: {part.removedBy}
                                    </div>
                                    <div className="mt-1 text-xs text-slate-600">Status: {part.printStatus}</div>
                                </div>
                            </div>

                            <div className="w-64 flex-shrink-0">
                                {part.printStatus !== 'COLLECTED' ? (
                                    <>
                                        <div className="flex gap-2">
                                            <div className={`flex-1 rounded border px-3 py-2 text-sm font-medium ${activeStaffName ? 'border-slate-300 bg-slate-100 text-slate-800' : 'forge-alert-warm'}`}>
                                                {activeStaffName || 'Set the current staff member in the header.'}
                                            </div>
                                            <Button
                                                onClick={() => collectPart(part.id)}
                                                size="sm"
                                                className="bg-teal-700 text-white hover:bg-teal-800"
                                                disabled={isPaymentBlocked}
                                                title={isPaymentBlocked ? 'Enter the receipt number before collecting.' : undefined}
                                            >
                                                Collect
                                            </Button>
                                        </div>
                                    </>
                                ) : (
                                    <div className="text-sm font-medium text-teal-900">Assisted by: {part.collectedBy}</div>
                                )}
                            </div>
                        </Card>
                    ))}
                </div>
            )}
        </Card>
    );
};
