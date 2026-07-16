import { useState } from 'react';
import type { Project } from '../../types';
import { useProjects } from '../../context/ProjectContext';
import { useSettings } from '../../context/SettingsContext';
import { useStaffSession } from '../../context/StaffSessionContext';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { useFeedback } from '../ui/FeedbackProvider';
import { getMissingStaffMessage } from '../../utils/staffSessionUtils';
import { Play, Check, Undo2, AlertTriangle } from 'lucide-react';
import { PartSourceFileButton } from '../../local-files/PartSourceFileButton';
import { sourceFileName } from '../../local-files/sourceFileLink';

export const CheckpointPrinting = ({ project }: { project: Project }) => {
    const { transitionPartStatus, transitionProjectState, updatePart } = useProjects();
    const { printers, brands } = useSettings();
    const { activeStaffName, claimActiveStaffName } = useStaffSession();
    const { prompt, showMessage } = useFeedback();

    const [activeAction, setActiveAction] = useState<{ type: 'START' | 'FINISH' | 'FAIL', partId: string } | null>(null);
    const [selectedPrinter, setSelectedPrinter] = useState('');
    const [primaryBrand, setPrimaryBrand] = useState('');
    const [secondaryBrand, setSecondaryBrand] = useState('');
    const [failureReason, setFailureReason] = useState('');
    const [formErrors, setFormErrors] = useState<Record<string, string>>({});

    const openStart = (partId: string) => {
        const part = project.parts.find(p => p.id === partId);
        setActiveAction({ type: 'START', partId });
        setSelectedPrinter('');
        setPrimaryBrand(part?.primaryBrand || '');
        setSecondaryBrand(part?.secondaryBrand || '');
        setFormErrors({});
    };

    const openFinish = (partId: string) => {
        setActiveAction({ type: 'FINISH', partId });
        setFormErrors({});
    };

    const openFail = (partId: string) => {
        setActiveAction({ type: 'FAIL', partId });
        setFailureReason('');
        setFormErrors({});
    };

    const closeAction = () => {
        setActiveAction(null);
        setSelectedPrinter('');
        setPrimaryBrand('');
        setSecondaryBrand('');
        setFailureReason('');
        setFormErrors({});
    };

    const confirmAction = async () => {
        if (!activeAction) return;
        const { type: actionType, partId } = activeAction;

        const technicianName = claimActiveStaffName();
        if (!technicianName) {
            await showMessage({
                title: 'Staff member required',
                messages: [getMissingStaffMessage('recording a print action')],
                tone: 'warning'
            });
            return;
        }

        if (actionType === 'START') {
            const machineName = selectedPrinter.trim();
            const errors = {
                selectedPrinter: !machineName ? 'This field is required.' : ''
            };
            setFormErrors(errors);
            if (errors.selectedPrinter) return;

            closeAction();
            const result = await transitionPartStatus({
                projectId: project.id,
                partId,
                action: 'START_PRINT',
                technicianName,
                machineName
            });

            if (!result.ok) {
                await showMessage({ title: 'Print was not started', messages: result.errors, tone: 'error' });
                return;
            }

            if (result.warnings && result.warnings.length > 0) {
                await showMessage({ title: 'Started with warnings', messages: result.warnings, tone: 'warning' });
            }

            updatePart(project.id, partId, {
                primaryBrand,
                secondaryBrand: secondaryBrand || undefined
            });
        } else if (actionType === 'FINISH') {
            closeAction();
            const result = await transitionPartStatus({
                projectId: project.id,
                partId,
                action: 'FINISH_PRINT',
                technicianName
            });

            if (!result.ok) {
                await showMessage({ title: 'Print was not finished', messages: result.errors, tone: 'error' });
                return;
            }

            if (result.warnings && result.warnings.length > 0) {
                await showMessage({ title: 'Finished with warnings', messages: result.warnings, tone: 'warning' });
            }
        } else {
            const reason = failureReason.trim();
            const errors = {
                failureReason: !reason ? 'Please fill in a failure reason.' : ''
            };
            setFormErrors(errors);
            if (errors.failureReason) return;

            closeAction();
            const result = await transitionPartStatus({
                projectId: project.id,
                partId,
                action: 'FAIL_PRINT',
                technicianName,
                reason
            });

            if (!result.ok) {
                await showMessage({ title: 'Print was not failed', messages: result.errors, tone: 'error' });
                return;
            }

            if (result.warnings && result.warnings.length > 0) {
                await showMessage({ title: 'Failed with warnings', messages: result.warnings, tone: 'warning' });
            }
        }
    };

    const allCollectionReady =
        project.parts.length > 0 &&
        project.parts.every(p => ['PRINTED', 'POST_PROCESSING', 'COLLECTED'].includes(p.printStatus));

    const handleNextStage = async () => {
        if (!allCollectionReady) {
            await showMessage({
                title: 'Printing still in progress',
                messages: ['All parts must be printed or in post-processing before moving to collection.'],
                tone: 'warning'
            });
            return;
        }

        const technicianName = claimActiveStaffName();
        if (!technicianName) {
            await showMessage({
                title: 'Staff member required',
                messages: [getMissingStaffMessage('moving a project to collection')],
                tone: 'warning'
            });
            return;
        }

        const values = await prompt({
            title: 'Move to collection',
            message: 'Release this completed project to collection and record the final handover location.',
            confirmLabel: 'Move to Collection',
            fields: [
                { name: 'printLabel', label: 'Print label / location', defaultValue: project.printLabel || '', placeholder: 'Tray A1' }
            ]
        });
        const label = values?.printLabel.trim();

        const result = await transitionProjectState({
            projectId: project.id,
            action: 'MARK_READY_FOR_COLLECTION',
            technicianName,
            printLabel: label?.trim() || undefined
        });

        if (!result.ok) {
            await showMessage({ title: 'Cannot move to collection', messages: result.errors, tone: 'error' });
            return;
        }

        if (result.warnings && result.warnings.length > 0) {
            await showMessage({ title: 'Moved with warnings', messages: result.warnings, tone: 'warning' });
        }
    };

    const handleRequeue = async (partId: string) => {
        const technicianName = claimActiveStaffName();
        if (!technicianName) {
            await showMessage({
                title: 'Staff member required',
                messages: [getMissingStaffMessage('requeueing a part')],
                tone: 'warning'
            });
            return;
        }

        const values = await prompt({
            title: 'Requeue part',
            message: 'This returns the part to the production queue and records why.',
            confirmLabel: 'Requeue Part',
            fields: [
                { name: 'reason', label: 'Reason', type: 'textarea', required: true }
            ]
        });
        const reason = values?.reason.trim();
        if (!reason) return;

        const result = await transitionPartStatus({
            projectId: project.id,
            partId,
            action: 'REQUEUE_PART',
            technicianName,
            reason
        });

        if (!result.ok) {
            await showMessage({ title: 'Part was not requeued', messages: result.errors, tone: 'error' });
        }
    };

    const activePart = activeAction ? project.parts.find(p => p.id === activeAction.partId) : null;
    const queuedParts = project.parts.filter(p => ['READY', 'VERIFIED', 'FAILED', 'DRAFT'].includes(p.printStatus));
    const printingParts = project.parts.filter(p => p.printStatus === 'PRINTING');
    const printedParts = project.parts.filter(p => ['PRINTED', 'POST_PROCESSING', 'COLLECTED'].includes(p.printStatus));

    const getProductionLabel = (status: Project['parts'][number]['printStatus']) => {
        if (status === 'PRINTING') return 'Printing';
        if (status === 'PRINTED' || status === 'POST_PROCESSING' || status === 'COLLECTED') return 'Printed';
        return 'Queued';
    };

    const getRecentRunSummary = (part: Project['parts'][number]) => {
        const runs = part.printRuns || [];
        if (runs.length === 0) return 'No print attempts yet';

        const latest = runs[0];
        if (latest.outcome === 'FAILED') {
            const reason = latest.failure_reason?.trim();
            return reason
                ? `Latest: failed on ${latest.machine_name || 'unknown machine'} - ${reason}`
                : `Latest: failed on ${latest.machine_name || 'unknown machine'}`;
        }
        if (latest.outcome === 'PRINTED' || latest.finished_at) {
            return `Latest: printed on ${latest.machine_name || 'unknown machine'}`;
        }
        if (part.printStatus !== 'PRINTING') {
            return `Latest: removed from ${latest.machine_name || 'unknown machine'} before completion`;
        }
        return `Latest: in progress on ${latest.machine_name || 'unknown machine'}`;
    };

    const renderRunHistory = (part: Project['parts'][number]) => {
        const runs = part.printRuns || [];
        if (runs.length === 0) return null;

        return (
            <div className="mt-2 space-y-1 border-t border-slate-300 pt-2">
                {runs.map((run, idx) => {
                    const outcomeLabel = run.outcome || (run.failed_at ? 'FAILED' : run.finished_at ? 'PRINTED' : idx === 0 && part.printStatus !== 'PRINTING' ? 'REQUEUED' : 'IN_PROGRESS');
                    const failureReasonLabel = run.failure_reason?.trim();
                    return (
                        <div key={run.id} className="text-[11px] text-slate-500">
                            Attempt {runs.length - idx}: {outcomeLabel} - {run.machine_name || 'Unknown machine'}
                            {outcomeLabel === 'FAILED' && failureReasonLabel ? ` - ${failureReasonLabel}` : ''}
                        </div>
                    );
                })}
            </div>
        );
    };

    return (
        <div className="relative w-full space-y-6">
            {activeAction && (
                <div className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-[2px]">
                    <div className="flex min-h-full items-center justify-center p-4">
                        <div className="forge-modal w-full max-w-sm space-y-4 p-6">
                            <h3 className="border-b border-slate-300 pb-2 text-lg font-bold">
                                {activeAction.type === 'START' ? 'Start Print Job' : activeAction.type === 'FINISH' ? 'Finish Print Job' : 'Fail Print Job'}
                            </h3>

                            <div className="space-y-3">
                                {activeAction.type === 'START' && (
                                    <>
                                        <div>
                                            <label className="mb-1 block text-sm font-medium">Machine</label>
                                            <input
                                                type="text"
                                                className={`forge-command-input w-full p-2 ${formErrors.selectedPrinter ? 'border-rose-400 bg-rose-50' : ''}`}
                                                value={selectedPrinter}
                                                onChange={e => setSelectedPrinter(e.target.value)}
                                                list="printers-modal"
                                                placeholder="Type or choose a machine"
                                            />
                                            <datalist id="printers-modal">
                                                {printers.map(p => <option key={p} value={p} />)}
                                            </datalist>
                                            {formErrors.selectedPrinter && <p className="mt-1 text-xs font-semibold text-rose-600">{formErrors.selectedPrinter}</p>}
                                        </div>
                                        <div>
                                            <label className="mb-1 block text-sm font-medium">Primary Material Brand</label>
                                            <input
                                                type="text"
                                                className="forge-command-input w-full p-2"
                                                value={primaryBrand}
                                                list="brands-modal"
                                                onChange={(e) => setPrimaryBrand(e.target.value)}
                                                placeholder="E.g. Polymaker"
                                            />
                                            <datalist id="brands-modal">
                                                {brands.map(b => <option key={b} value={b} />)}
                                            </datalist>
                                        </div>
                                        {activePart?.secondaryMaterial && (
                                            <div>
                                                <label className="mb-1 block text-sm font-medium">Secondary Material Brand</label>
                                                <input
                                                    type="text"
                                                    className="forge-command-input w-full p-2"
                                                    value={secondaryBrand}
                                                    list="brands-modal"
                                                    onChange={(e) => setSecondaryBrand(e.target.value)}
                                                    placeholder="Brand name"
                                                />
                                            </div>
                                        )}
                                    </>
                                )}

                                {activeAction.type === 'FAIL' && (
                                    <div>
                                        <label className="mb-1 block text-sm font-medium">Failure Reason</label>
                                        <textarea
                                            className={`forge-command-input w-full p-2 ${formErrors.failureReason ? 'border-rose-400 bg-rose-50' : ''}`}
                                            value={failureReason}
                                            onChange={e => setFailureReason(e.target.value)}
                                            placeholder="What needs to be fixed before re-run?"
                                            rows={3}
                                        />
                                        {formErrors.failureReason && <p className="mt-1 text-xs font-semibold text-rose-600">{formErrors.failureReason}</p>}
                                    </div>
                                )}

                                <div>
                                    <div className={`rounded border p-2 text-sm ${activeStaffName ? 'border-slate-300 bg-slate-100 text-slate-800' : 'forge-alert-warm'}`}>
                                        {activeStaffName || 'Set the current staff member in the header before confirming this action.'}
                                    </div>
                                </div>
                            </div>

                            <div className="flex justify-end gap-2 pt-2">
                                <Button variant="outline" onClick={closeAction}>Cancel</Button>
                                <Button onClick={confirmAction}>Confirm</Button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-lg font-bold">Printing Dashboard</h2>
                    {allCollectionReady && (
                        <p className="mt-1 text-sm text-slate-600">
                            All parts are complete. Keep the project in production until you are ready to release it to collection.
                        </p>
                    )}
                </div>
                {allCollectionReady && (
                    <Button onClick={handleNextStage}>
                        Move to Collection
                    </Button>
                )}
            </div>

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
                <div className="forge-lane forge-lane-blue min-h-[400px] border p-4">
                    <h3 className="mb-4 flex items-center gap-2 font-bold text-slate-800">
                        QUEUED
                        <span className="forge-pill px-2 py-0.5 text-xs text-slate-800">
                            {queuedParts.length}
                        </span>
                    </h3>
                    <div className="space-y-3">
                        {queuedParts.map(part => (
                            <Card key={part.id} className="border-l-4 border-l-sky-500 p-3 shadow-sm">
                                <div className="flex gap-3">
                                    {part.imageUrl && (
                                        <img src={part.imageUrl} alt={part.partName} className="h-12 w-12 rounded border bg-white object-contain" />
                                    )}
                                    <div>
                                        <div className="font-medium">{part.partName}</div>
                                        {part.sourceFilePath && <div className="mt-1 truncate font-mono text-[11px] text-slate-600" title={part.sourceFilePath}>File: {sourceFileName(part.sourceFilePath)}</div>}
                                        {part.specialInstruction && part.specialInstruction.trim() !== '' && (
                                            <div className="mt-1 text-sm italic text-slate-700">Note: {part.specialInstruction}</div>
                                        )}
                                        <div className="mt-1 text-sm text-slate-700">
                                            {part.primaryMaterial}
                                            {part.secondaryMaterial ? ` + ${part.secondaryMaterial}` : ''} - {part.primaryEstimatedWeight}g
                                        </div>
                                        <div className="mt-1 text-xs text-slate-600">Status: {getProductionLabel(part.printStatus)}</div>
                                        <div className="mt-1 text-xs text-slate-600">{getRecentRunSummary(part)}</div>
                                        {renderRunHistory(part)}
                                    </div>
                                </div>
                                <div className="mt-3 flex gap-2">
                                    <PartSourceFileButton part={part} project={project} />
                                    <Button onClick={() => openStart(part.id)} size="sm" className="flex-1 gap-2">
                                        <Play size={14} /> Start
                                    </Button>
                                </div>
                            </Card>
                        ))}
                    </div>
                </div>

                <div className="forge-lane forge-lane-indigo min-h-[400px] border p-4">
                    <h3 className="mb-4 flex items-center gap-2 font-bold text-indigo-900">
                        PRINTING
                        <span className="forge-pill px-2 py-0.5 text-xs text-indigo-900">
                            {printingParts.length}
                        </span>
                    </h3>
                    <div className="space-y-3">
                        {printingParts.map(part => (
                            <Card key={part.id} className="border-l-4 border-l-indigo-500 p-3 shadow-sm">
                                <div className="flex gap-3">
                                    {part.imageUrl && (
                                        <img src={part.imageUrl} alt={part.partName} className="h-12 w-12 rounded border bg-white object-contain" />
                                    )}
                                    <div>
                                        <div className="font-medium">{part.partName}</div>
                                        {part.sourceFilePath && <div className="mt-1 truncate font-mono text-[11px] text-slate-600" title={part.sourceFilePath}>File: {sourceFileName(part.sourceFilePath)}</div>}
                                        {part.specialInstruction && part.specialInstruction.trim() !== '' && (
                                            <div className="mt-1 text-sm italic text-indigo-700">Note: {part.specialInstruction}</div>
                                        )}
                                        <div className="mt-1 text-sm font-mono text-indigo-700">On: {part.printerName}</div>
                                        <div className="mt-1 text-xs text-slate-600">Started by: {part.startedBy}</div>
                                        <div className="mt-1 text-xs text-slate-700">{getRecentRunSummary(part)}</div>
                                        {renderRunHistory(part)}
                                    </div>
                                </div>
                                <div className="mt-3 flex w-full gap-2">
                                    <PartSourceFileButton part={part} project={project} />
                                    <Button
                                        onClick={() => handleRequeue(part.id)}
                                        size="sm"
                                        variant="outline"
                                        title="Revert to queued"
                                        className="h-auto w-10 shrink-0 p-0 text-slate-600 hover:bg-slate-100"
                                    >
                                        <Undo2 size={14} />
                                    </Button>
                                    <Button onClick={() => openFail(part.id)} size="sm" variant="outline" className="gap-2 border-red-300 text-red-800 hover:bg-red-100">
                                        <AlertTriangle size={14} /> Fail
                                    </Button>
                                    <Button onClick={() => openFinish(part.id)} size="sm" variant="outline" className="flex-1 gap-2 hover:border-green-300 hover:bg-green-100 hover:text-green-800">
                                        <Check size={14} /> Finish
                                    </Button>
                                </div>
                            </Card>
                        ))}
                    </div>
                </div>

                <div className="forge-lane forge-lane-teal min-h-[400px] border p-4">
                    <h3 className="mb-4 flex items-center gap-2 font-bold text-teal-900">
                        PRINTED
                        <span className="forge-pill px-2 py-0.5 text-xs text-teal-900">
                            {printedParts.length}
                        </span>
                    </h3>
                    <div className="space-y-3">
                        {printedParts.map(part => (
                            <Card key={part.id} className="border-l-4 border-l-teal-600 bg-white p-3 shadow-sm">
                                <div className="flex gap-3">
                                    {part.imageUrl && (
                                        <img src={part.imageUrl} alt={part.partName} className="h-12 w-12 rounded border bg-white object-contain" />
                                    )}
                                    <div>
                                        <div className="font-medium text-slate-800">{part.partName}</div>
                                        {part.sourceFilePath && <div className="mt-1 truncate font-mono text-[11px] text-slate-600" title={part.sourceFilePath}>File: {sourceFileName(part.sourceFilePath)}</div>}
                                        {part.specialInstruction && part.specialInstruction.trim() !== '' && (
                                            <div className="mt-1 text-sm italic text-teal-700">Note: {part.specialInstruction}</div>
                                        )}
                                        <div className="mt-1 text-sm font-mono text-slate-700">On: {part.printerName}</div>
                                        <div className="mt-1 text-xs text-slate-600">Started by: {part.startedBy}</div>
                                        <div className="mt-1 text-xs text-slate-600">Removed by: {part.removedBy}</div>
                                        <div className="mt-1 text-xs text-slate-700">Status: {getProductionLabel(part.printStatus)}</div>
                                        <div className="mt-1 text-xs text-slate-700">{getRecentRunSummary(part)}</div>
                                        {renderRunHistory(part)}
                                    </div>
                                </div>
                                <div className="mt-3 flex justify-end gap-2">
                                    <PartSourceFileButton part={part} project={project} />
                                    {part.printStatus !== 'COLLECTED' && (
                                        <Button
                                            onClick={() => handleRequeue(part.id)}
                                            size="sm"
                                            variant="outline"
                                            title="Requeue this part"
                                            className="h-8 gap-2 px-2 py-1 text-slate-600 hover:bg-slate-100"
                                        >
                                            <Undo2 size={14} /> Requeue
                                        </Button>
                                    )}
                                </div>
                            </Card>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};
