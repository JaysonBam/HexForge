import { useState, useEffect } from 'react';
import { ChevronDown, ChevronUp, FileCheck2, Trash2 } from 'lucide-react';
import type { Part } from '../../types';
import { useSettings } from '../../context/SettingsContext';
import { useProjects } from '../../context/ProjectContext';
import { useStaffSession } from '../../context/StaffSessionContext';
import { Button } from '../ui/Button';
import { useFeedback } from '../ui/FeedbackProvider';
import {
    canClearPartVerification,
    getVisibleCheckedBy,
    isPartVerifiedForReview
} from '../../domain/partVerification';
import {
    FILAMENT_SOURCE_VALUES,
    filamentSourceLabel,
    getPartFilamentSource,
    isProvidedFilamentSource
} from '../../domain/filamentSource.ts';
import { sourceFileName } from '../../local-files/sourceFileLink';

interface PartItemProps {
    part: Part;
    projectId: string;
}

export const PartItem = ({ part, projectId }: PartItemProps) => {
    const { updatePart, deletePart, transitionPartStatus } = useProjects();
    const { getFilamentPrice, filaments, providedFilamentPricePerGram } = useSettings();
    const { claimActiveStaffName } = useStaffSession();
    const { confirm, showMessage } = useFeedback();
    const [expanded, setExpanded] = useState(part.expanded ?? false);
    const [verificationError, setVerificationError] = useState('');
    const isVerifiedForReview = isPartVerifiedForReview(part);
    const visibleCheckedBy = getVisibleCheckedBy(part);
    const showClearVerification = canClearPartVerification(part);

    const materialOptions = Array.from(new Set(filaments.map(f => f.type)));
    const primaryFilamentSource = getPartFilamentSource(part.primaryFilamentSource, part.primaryOwnFilament);
    const secondaryFilamentSource = getPartFilamentSource(part.secondaryFilamentSource, part.secondaryOwnFilament);

    // Auto-calculate service cost when weight/material/filament source changes
    useEffect(() => {
        let costPrimary = 0;
        let costSecondary = 0;
        
        const effectivePrimaryWeight = part.primaryEstimatedWeight || 0;
        if (isProvidedFilamentSource(primaryFilamentSource)) {
            costPrimary = effectivePrimaryWeight * providedFilamentPricePerGram;
        } else {
            const pricePerGram = getFilamentPrice(part.primaryMaterial);        
            costPrimary = effectivePrimaryWeight * pricePerGram;
        }

        const effectiveSecondaryWeight = part.secondaryEstimatedWeight || 0;
        if (part.secondaryMaterial && effectiveSecondaryWeight > 0) {
            if (isProvidedFilamentSource(secondaryFilamentSource)) {
                costSecondary = effectiveSecondaryWeight * providedFilamentPricePerGram;
            } else {
                const pricePerGramSecondary = getFilamentPrice(part.secondaryMaterial);
                costSecondary = effectiveSecondaryWeight * pricePerGramSecondary;   
            }
        }

        const calculatedPrimary = parseFloat(costPrimary.toFixed(2));
        const calculatedSecondary = parseFloat(costSecondary.toFixed(2));

        // Only update if value actually changed to prevent loops
        if (
            Math.abs(calculatedPrimary - (part.primaryServiceCost || 0)) > 0.01 ||
            Math.abs(calculatedSecondary - (part.secondaryServiceCost || 0)) > 0.01
        ) {
            updatePart(projectId, part.id, {
                primaryServiceCost: calculatedPrimary,
                secondaryServiceCost: calculatedSecondary
            });
        }
    }, [part.primaryEstimatedWeight, part.primaryWeight, part.primaryMaterial, primaryFilamentSource, getFilamentPrice, part.primaryServiceCost, part.id, projectId, updatePart, part.secondaryMaterial, part.secondaryWeight, part.secondaryEstimatedWeight, secondaryFilamentSource, part.secondaryServiceCost, providedFilamentPricePerGram]);

    // Local Service Costs for Headers
    const primaryEffectiveWeight = part.primaryEstimatedWeight || 0;
    const primaryServiceCostLocal = isProvidedFilamentSource(primaryFilamentSource)
        ? primaryEffectiveWeight * providedFilamentPricePerGram
        : primaryEffectiveWeight * getFilamentPrice(part.primaryMaterial);

    const secondaryEffectiveWeight = part.secondaryEstimatedWeight || 0;
    const secondaryServiceCostLocal = isProvidedFilamentSource(secondaryFilamentSource)
        ? secondaryEffectiveWeight * providedFilamentPricePerGram
        : secondaryEffectiveWeight * getFilamentPrice(part.secondaryMaterial || "");

    const handleChange = (field: keyof Part, value: unknown) => {
        updatePart(projectId, part.id, { [field]: value });
    };

    const totalServiceCost = (part.primaryServiceCost || 0) + (part.secondaryServiceCost || 0);

    const handleVerifyPart = async () => {
        const technician = claimActiveStaffName();
        if (!technician) {
            setVerificationError('Select the staff member in the header');
            return;
        }

        setVerificationError('');
        const result = await transitionPartStatus({
            projectId,
            partId: part.id,
            action: 'VERIFY_PART',
            technicianName: technician
        });
        if (!result.ok) {
            setVerificationError(result.errors[0] || 'Part was not verified.');
            await showMessage({ title: 'Part was not verified', messages: result.errors, tone: 'error' });
        }
    };

    const handleUnverifyPart = async () => {
        const technician = claimActiveStaffName();
        if (!technician) {
            return;
        }

        setVerificationError('');
        const result = await transitionPartStatus({
            projectId,
            partId: part.id,
            action: 'UNVERIFY_PART',
            technicianName: technician
        });
        if (!result.ok) {
            setVerificationError(result.errors[0] || 'Part was not unverified.');
            await showMessage({ title: 'Part was not unverified', messages: result.errors, tone: 'error' });
        }
    };

    const handleDeletePart = async () => {
        const shouldDelete = await confirm({
            title: 'Delete part',
            message: `Delete ${part.partName || 'this part'} from the project?`,
            confirmLabel: 'Delete Part',
            tone: 'error'
        });
        if (shouldDelete) deletePart(projectId, part.id);
    };

    return (
        <div className="forge-card overflow-hidden transition-all">
            {/* Header / Summary */}
            <div 
                className="flex cursor-pointer items-center justify-between bg-slate-100/90 p-4 transition hover:bg-sky-50"
                onClick={() => setExpanded(!expanded)}
            >
                <div className="flex items-center gap-3">
                    <button className="text-slate-500">
                        {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                    </button>
                    {part.imageUrl && (
                        <img 
                            src={part.imageUrl} 
                            alt={part.partName} 
                            className="h-10 w-10 rounded border border-slate-300 bg-white object-contain shadow-sm" 
                        />
                    )}
                    <span className="font-bold text-slate-800">#{part.partNumber}</span>
                    <span className="font-medium text-slate-950">{part.partName}</span>
                    {part.sourceFilePath && (
                        <span className="forge-badge inline-flex max-w-52 items-center gap-1 px-2 py-0.5 text-xs text-slate-700" title={part.sourceFilePath}>
                            <FileCheck2 size={12} className="shrink-0" />
                            <span className="truncate">{sourceFileName(part.sourceFilePath)}</span>
                        </span>
                    )}
                    {isVerifiedForReview ? (
                        <span className="forge-badge forge-badge-green px-2 py-0.5 text-xs">
                            Verified
                        </span>
                    ) : (
                        <span className="forge-badge forge-badge-gold px-2 py-0.5 text-xs">
                            Unverified
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-6 text-sm text-slate-700">
                    <span>{(part.primaryEstimatedWeight || 0) + (part.secondaryEstimatedWeight || 0)}g</span>
                    <span className="font-bold text-slate-950">R {totalServiceCost.toFixed(2)}</span>
                </div>
            </div>

            {/* Expanded Details */}
            {expanded && (
                <div className="border-t border-slate-300 bg-white p-5">
                    {/* Top Section */}
                    <div className="part-detail-top">
                        <div className="flex min-w-0 items-start gap-5">
                            {part.imageUrl ? (
                                <img
                                    src={part.imageUrl}
                                    alt={part.partName}
                                    className="h-24 w-24 flex-none rounded border border-slate-300 bg-slate-100 object-contain shadow-sm"
                                />
                            ) : (
                                <div className="flex h-24 w-24 flex-none items-center justify-center rounded border border-slate-300 bg-slate-100 p-2 text-center text-xs text-slate-500">
                                    No Image
                                </div>
                            )}
                            <div className="min-w-0 flex-1">
                                <input
                                    type="text"
                                    className="mb-4 w-full truncate border-b border-slate-300 bg-transparent pb-1 text-xl font-bold text-slate-900 focus:border-sky-600 focus:outline-none"
                                    value={part.partName}
                                    placeholder="Part Name"
                                    onChange={(e) => handleChange('partName', e.target.value)}
                                />
                                
                                <div className="flex flex-wrap items-end gap-6">
                                    <div className="flex flex-col border-b border-transparent">
                                        <span className="mb-1 text-[10px] font-bold uppercase tracking-widest text-slate-500">Service Cost</span>
                                        <span className="text-xl font-extrabold text-slate-950">
                                            R {totalServiceCost.toFixed(2)}
                                        </span>
                                    </div>

                                    <div className="flex flex-col">
                                        <span className="mb-1 text-[10px] font-bold uppercase tracking-widest text-slate-500">Print Time</span>
                                        <input
                                            type="text"
                                            className="w-24 border-b border-slate-300 bg-transparent py-0.5 text-base font-medium focus:border-sky-600 focus:outline-none"
                                            value={part.printingTime || ''}
                                            placeholder="0h 0m"
                                            onChange={(e) => handleChange('printingTime', e.target.value)}
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="min-w-0">
                            <label className="mb-2 flex text-[10px] font-bold uppercase tracking-widest text-slate-500">Special Instructions</label>
                            <textarea
                                className="forge-command-input h-[6.25rem] w-full resize-y p-3 text-sm"
                                value={part.specialInstruction || ''}
                                onChange={(e) => handleChange('specialInstruction', e.target.value)}
                                placeholder=""
                            />
                        </div>
                    </div>

                    {/* Material Boxes */}
                    <div className="part-material-grid">
                        {/* Primary Material Box */}
                        <div className="part-material-card relative overflow-hidden rounded-lg border border-sky-300 bg-sky-100/70 p-4 shadow-sm">
                            <div className="absolute left-0 top-0 h-full w-1 bg-sky-500"></div>
                            <div className="mb-4 flex items-center justify-between border-b border-sky-300 pb-3">
                                <h4 className="text-sm font-bold uppercase tracking-wider text-sky-900">Primary Material</h4>
                                <div className="forge-badge forge-badge-blue px-3 py-1 text-xs" title="Service Cost for this Material">
                                    R {primaryServiceCostLocal.toFixed(2)}
                                </div>
                            </div>
                            
                            <div className="part-material-field-grid">
                                <div className="part-material-field">
                                    <label className="part-material-label">Material Type</label>
                                    <select
                                        className="part-material-control focus:border-sky-600"
                                        value={part.primaryMaterial || ''}
                                        onChange={(e) => handleChange('primaryMaterial', e.target.value)}
                                    >
                                        <option value="">-- Select --</option>
                                        {materialOptions.map(m => (
                                            <option key={m} value={m}>{m}</option>
                                        ))}
                                    </select>
                                </div>

                                <div className="part-material-field">
                                    <label htmlFor={`source-${part.id}`} className="part-material-label">Filament Source</label>
                                    <select
                                        id={`source-${part.id}`}
                                        className="part-material-control focus:border-sky-600"
                                        value={primaryFilamentSource}
                                        onChange={(e) => handleChange('primaryFilamentSource', e.target.value)}
                                    >
                                        {FILAMENT_SOURCE_VALUES.map((source) => (
                                            <option key={source} value={source}>{filamentSourceLabel(source)}</option>
                                        ))}
                                    </select>
                                </div>

                                <div className="part-material-field">
                                    <label className="part-material-label">Actual Weight (g)</label>
                                    <input
                                        type="number"
                                        className="part-material-control focus:border-sky-600"
                                        value={part.primaryWeight || ''}
                                        onChange={(e) => handleChange('primaryWeight', parseFloat(e.target.value) || 0)}
                                    />
                                </div>

                                <div className="part-material-field">
                                    <label className="part-material-label">Est. Weight (g)</label>
                                    <input
                                        type="number"
                                        className="part-material-control focus:border-sky-600"
                                        value={part.primaryEstimatedWeight || ''}
                                        onChange={(e) => handleChange('primaryEstimatedWeight', parseFloat(e.target.value) || 0)}
                                    />
                                </div>

                                <div className="part-material-field">
                                    <label className="part-material-label">Length (m)</label>
                                    <input
                                        type="number"
                                        className="part-material-control focus:border-sky-600"
                                        value={part.primaryLength || ''}
                                        onChange={(e) => handleChange('primaryLength', parseFloat(e.target.value) || 0)}
                                    />
                                </div>

                                <div className="part-material-field">
                                    <label className="part-material-label">Cost (R)</label>
                                    <input
                                        type="number"
                                        className="part-material-control focus:border-sky-600"
                                        value={part.primaryMaterialCost || ''}
                                        onChange={(e) => handleChange('primaryMaterialCost', parseFloat(e.target.value) || 0)}
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Secondary Material Box */}
                        {part.secondaryMaterial && (

                        <div className="part-material-card relative overflow-hidden rounded-lg border border-pink-300 bg-pink-100/60 p-4 shadow-sm">
                            <div className="absolute left-0 top-0 h-full w-1 bg-pink-500"></div>
                            <div className="mb-4 flex items-center justify-between border-b border-pink-300 pb-3">
                                <h4 className="text-sm font-bold uppercase tracking-wider text-pink-900">Secondary Material</h4>
                                <div className="forge-badge forge-badge-pink px-3 py-1 text-xs" title="Service Cost for this Material">
                                    R {secondaryServiceCostLocal.toFixed(2)}
                                </div>
                            </div>

                            <div className="part-material-field-grid">
                                <div className="part-material-field">
                                    <label className="part-material-label">Material Type</label>
                                    <select
                                        className="part-material-control focus:border-pink-600"
                                        value={part.secondaryMaterial || ''}
                                        onChange={(e) => handleChange('secondaryMaterial', e.target.value)}
                                    >
                                        <option value="">-- None --</option>
                                        {materialOptions.map(m => (
                                            <option key={m} value={m}>{m}</option>
                                        ))}
                                    </select>
                                </div>

                                <div className="part-material-field">
                                    <label className="part-material-label">Length (m)</label>
                                    <input
                                        type="number"
                                        className="part-material-control focus:border-pink-600"
                                        value={part.secondaryLength || ''}
                                        onChange={(e) => handleChange('secondaryLength', parseFloat(e.target.value) || 0)}
                                    />
                                </div>

                                <div className="part-material-field">
                                    <label htmlFor={`source2-${part.id}`} className="part-material-label">Filament Source</label>
                                    <select
                                        id={`source2-${part.id}`}
                                        className="part-material-control focus:border-pink-600"
                                        value={secondaryFilamentSource}
                                        onChange={(e) => handleChange('secondaryFilamentSource', e.target.value)}
                                    >
                                        {FILAMENT_SOURCE_VALUES.map((source) => (
                                            <option key={source} value={source}>{filamentSourceLabel(source)}</option>
                                        ))}
                                    </select>
                                </div>

                                <div className="part-material-field">
                                    <label className="part-material-label">Actual Weight (g)</label>
                                    <input
                                        type="number"
                                        className="part-material-control focus:border-pink-600"
                                        value={part.secondaryWeight || ''}
                                        onChange={(e) => handleChange('secondaryWeight', parseFloat(e.target.value) || 0)}
                                    />
                                </div>

                                <div className="part-material-field">
                                    <label className="part-material-label">Est. Weight (g)</label>
                                    <input
                                        type="number"
                                        className="part-material-control focus:border-pink-600"
                                        value={part.secondaryEstimatedWeight || ''}
                                        onChange={(e) => handleChange('secondaryEstimatedWeight', parseFloat(e.target.value) || 0)}
                                    />
                                </div>

                                <div className="part-material-field">
                                    <label className="part-material-label">Cost (R)</label>
                                    <input
                                        type="number"
                                        className="part-material-control focus:border-pink-600"
                                        value={part.secondaryMaterialCost || ''}
                                        onChange={(e) => handleChange('secondaryMaterialCost', parseFloat(e.target.value) || 0)}
                                    />
                                </div>
                            </div>
                        </div>
                        )}
                    </div>

                    <div className="flex items-center justify-between border-t border-slate-300 pt-4">
                        <div className="flex-1 max-w-xs">
                            <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Checked By</label>
                            <div className={`w-full border-b py-1.5 text-sm font-medium ${verificationError ? 'border-rose-400 text-rose-700' : 'border-slate-300 text-slate-700'}`}>
                                {visibleCheckedBy || (isVerifiedForReview ? 'Verification staff name missing' : 'Select the staff member in the header')}
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            {showClearVerification ? (
                                <Button variant="outline" size="sm" onClick={handleUnverifyPart} className="rounded-lg py-1.5">
                                    Clear Verification
                                </Button>
                            ) : (
                                <Button size="sm" onClick={handleVerifyPart} className="rounded-lg py-1.5">
                                    Verify Part
                                </Button>
                            )}
                            <Button variant="destructive" size="sm" onClick={handleDeletePart} className="flex items-center gap-2 rounded-lg py-1.5">
                                <Trash2 size={16} /> Delete Part
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
