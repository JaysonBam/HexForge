import { useCallback, useEffect, useRef, useState } from 'react';
import type { Project, Part } from '../../types';
import { useProjects } from '../../context/ProjectContext';
import { useSettings } from '../../context/SettingsContext';
import { useStaffSession } from '../../context/StaffSessionContext';
import { PartItem } from './PartItem';
import { Upload, Plus, ArrowRight, Loader2 } from 'lucide-react';
import { Button } from '../ui/Button';
import { useFeedback } from '../ui/FeedbackProvider';
import { getMissingStaffMessage } from '../../utils/staffSessionUtils';
import JSZip from 'jszip';
import { parseBambu } from '../../lib/slicer-parsers/parsers/BambuParser';
import { parseUltimaker } from '../../lib/slicer-parsers/parsers/UltimakerParser';
import { uploadThumbnailFromBlobUrl } from '../../utils/storageUtils';
import { isPartVerifiedForReview } from '../../domain/partVerification';

type CheckpointReviewProps = {
  project: Project;
  onAdvanceFromLockedReview?: () => void;
};

type ParsedMaterial = {
  type?: string;
  brand?: string;
  weight?: number;
  cost?: number;
  length?: number;
};

type ParsedSlicerPart = {
  name?: string;
  printingTime: number;
  imageUrl?: string;
  materials?: ParsedMaterial[];
};

const hasDraggedFiles = (event: DragEvent) => {
  return Boolean(event.dataTransfer && Array.from(event.dataTransfer.types).includes('Files'));
};

export const CheckpointReview = ({ project, onAdvanceFromLockedReview }: CheckpointReviewProps) => {
  const { transitionProjectState, addExtractedParts, addPart } = useProjects();
  const { getFilamentPrice } = useSettings();
  const { claimActiveStaffName } = useStaffSession();
  const { prompt, showMessage } = useFeedback();
  const [loading, setLoading] = useState(false);
  const [isDragActive, setIsDragActive] = useState(false);
  const dragDepth = useRef(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Parse Bambu Studio 3mf config

  const processFiles = useCallback(async (newFiles: FileList | File[]) => {
    setLoading(true);

    const extractedParts: Partial<Part>[] = [];
    const errors: string[] = [];

    try {
      let partCounter = project.parts.length + 1;
      for (let i = 0; i < newFiles.length; i++) {
        const uploadedFile = newFiles[i];
        
        let parsedParts: ParsedSlicerPart[] = [];
        
        const isBambu = uploadedFile.name.endsWith('.gcode.3mf');
        const isUltimaker = uploadedFile.name.endsWith('.ufp');
        const isStandard3mf = uploadedFile.name.endsWith('.3mf') && !isBambu;
        
        // We handle primarily our known extensions here based on the requirement workflow
        if (isBambu || isStandard3mf || isUltimaker) {
          try {
              const zip = new JSZip();
              const zipContent = await zip.loadAsync(uploadedFile);
              
              if (isBambu || isStandard3mf) {
                 const bareFilename = uploadedFile.name.replace(/(\.gcode\.3mf|\.3mf)$/i, '');
                 parsedParts = await parseBambu(zipContent, partCounter, bareFilename) as ParsedSlicerPart[];
              } else if (isUltimaker) {
                 parsedParts = await parseUltimaker(zipContent, partCounter) as ParsedSlicerPart[];
              }

              if (!parsedParts || parsedParts.length === 0) {
                 errors.push(`File ${uploadedFile.name} was parsed but no printable parts were found.`);
              }
              
              // Now map them into our Project's Parts shape
              for (const p of parsedParts) {
                 partCounter++;
                 
                 let uploadedImageUrl: string | undefined = undefined;
                 if (p.imageUrl) {
                     uploadedImageUrl = await uploadThumbnailFromBlobUrl(p.imageUrl) || p.imageUrl;
                 }

                 // Primary and secondary material mapping
                 const materials = p.materials || [];
                 const m1 = materials[0];
                 const m2 = materials[1];
                 
                 const m1Weight = m1?.weight || 0;
                   const m2Weight = m2?.weight || 0;
                   const primaryPriceForCost = m1?.type ? getFilamentPrice(m1.type) : 0;
                   const serviceCostPrimary = Math.round(m1Weight) * primaryPriceForCost;
                   
                   const secondaryPriceForCost = m2?.type ? getFilamentPrice(m2.type) : 0;
                   const serviceCostSecondary = m2 ? (Math.round(m2Weight) * secondaryPriceForCost) : 0;

                   const hours = Math.floor(p.printingTime / 3600);
                   const mins = Math.floor((p.printingTime % 3600) / 60);
                   const timeString = `${hours}h ${mins}m`;

                   const m1Cost = m1?.cost || 0;
                   const m2Cost = m2?.cost || 0;
                   const m1Length = m1?.length || 0;
                   const m2Length = m2?.length || 0;

                   extractedParts.push({
                       partName: p.name || uploadedFile.name,
                       primaryMaterialCost: parseFloat(m1Cost.toFixed(2)),
                       primaryServiceCost: parseFloat(serviceCostPrimary.toFixed(2)),
                       primaryEstimatedWeight: Math.round(m1Weight),
                       primaryWeight: parseFloat(m1Weight.toFixed(2)),
                       printingTime: timeString,
                       primaryLength: parseFloat(m1Length.toFixed(2)),
                       secondaryLength: parseFloat(m2Length.toFixed(2)),

                       primaryMaterial: m1?.type || '',
                       primaryBrand: m1?.brand || '',

                       secondaryMaterial: m2?.type || undefined,
                       secondaryBrand: m2?.brand || undefined,

                       imageUrl: uploadedImageUrl,
                       materials: p.materials,

                       secondaryEstimatedWeight: Math.round(m2Weight),
                       secondaryWeight: parseFloat(m2Weight.toFixed(2)),
                       secondaryServiceCost: parseFloat(serviceCostSecondary.toFixed(2)),
                       secondaryMaterialCost: parseFloat(m2Cost.toFixed(2)),
                       printStatus: 'DRAFT'
                   });
              }
          } catch (fileErr) {
             console.error(fileErr);
             errors.push(`Failed to analyze ${uploadedFile.name}. It might be corrupted or unsupported.`);
          }
        } else {
             errors.push(`File ${uploadedFile.name} is not a supported format (.3mf, .gcode.3mf, .ufp).`);
        }
      }

      if (extractedParts.length > 0) {
        addExtractedParts(project.id, extractedParts);
      }

      if (errors.length > 0) {
        await showMessage({
          title: 'Some files need attention',
          messages: errors,
          tone: 'warning'
        });
      }

    } catch (err) {
      await showMessage({
        title: 'File analysis failed',
        messages: [err instanceof Error ? err.message : 'Failed to parse one or more files.'],
        tone: 'error'
      });
    } finally {
      setLoading(false);
    }
  }, [addExtractedParts, getFilamentPrice, project.id, project.parts.length, showMessage]);

  const handleFinishReview = async () => {
    if (project.parts.length === 0) {
      await showMessage({ title: 'No parts yet', messages: ['Add at least one printable part before moving to quote.'], tone: 'warning' });
      return;
    }

    const unverifiedParts = project.parts.filter((part) => !isPartVerifiedForReview(part));
    if (unverifiedParts.length > 0) {
        await showMessage({
          title: 'Parts still need verification',
          messages: ['Please verify all parts before completing this step.'],
          tone: 'warning'
        });
        return;
    }

    const technicianName = claimActiveStaffName();
    if (!technicianName) {
      await showMessage({
        title: 'Staff member required',
        messages: [getMissingStaffMessage('completing review')],
        tone: 'warning'
      });
      return;
    }

    if (project.state !== 'INTAKE' && project.state !== 'REVIEW') {
      const reasonResult = await prompt({
        title: 'Reopen review',
        message: `Project is currently ${project.state}. Record why review is being reopened.`,
        confirmLabel: 'Reopen Review',
        fields: [
          { name: 'reason', label: 'Reason', type: 'textarea', required: true }
        ]
      });
      const reason = reasonResult?.reason.trim();
      if (!reason) return;

      const reopenResult = await transitionProjectState({
        projectId: project.id,
        action: 'REOPEN_REVIEW',
        technicianName,
        reason
      });

      if (!reopenResult.ok) {
        await showMessage({ title: 'Review cannot be reopened', messages: reopenResult.errors, tone: 'error' });
        return;
      }

      if (reopenResult.warnings && reopenResult.warnings.length > 0) {
        await showMessage({ title: 'Reopened with warnings', messages: reopenResult.warnings, tone: 'warning' });
      }
    }

    const result = await transitionProjectState({
      projectId: project.id,
      action: 'COMPLETE_REVIEW',
      technicianName
    });

    if (!result.ok) {
      await showMessage({ title: 'Cannot move to quote', messages: result.errors, tone: 'error' });
      return;
    }

    if (result.warnings && result.warnings.length > 0) {
      await showMessage({ title: 'Moved with warnings', messages: result.warnings, tone: 'warning' });
    }
    onAdvanceFromLockedReview?.();
  };

  const handleManualAdd = () => {
    addPart(project.id);
  };

  useEffect(() => {
    const handleDocumentDragEnter = (event: DragEvent) => {
      if (!hasDraggedFiles(event)) return;
      event.preventDefault();
      dragDepth.current += 1;
      setIsDragActive(true);
    };

    const handleDocumentDragOver = (event: DragEvent) => {
      if (!hasDraggedFiles(event)) return;
      event.preventDefault();
      event.dataTransfer!.dropEffect = 'copy';
      setIsDragActive(true);
    };

    const handleDocumentDragLeave = (event: DragEvent) => {
      if (!hasDraggedFiles(event)) return;
      event.preventDefault();
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) {
        setIsDragActive(false);
      }
    };

    const handleDocumentDrop = (event: DragEvent) => {
      if (!hasDraggedFiles(event)) return;
      event.preventDefault();
      dragDepth.current = 0;
      setIsDragActive(false);

      if (event.dataTransfer && event.dataTransfer.files.length > 0 && !loading) {
        void processFiles(Array.from(event.dataTransfer.files));
      }
    };

    document.addEventListener('dragenter', handleDocumentDragEnter);
    document.addEventListener('dragover', handleDocumentDragOver);
    document.addEventListener('dragleave', handleDocumentDragLeave);
    document.addEventListener('drop', handleDocumentDrop);

    return () => {
      document.removeEventListener('dragenter', handleDocumentDragEnter);
      document.removeEventListener('dragover', handleDocumentDragOver);
      document.removeEventListener('dragleave', handleDocumentDragLeave);
      document.removeEventListener('drop', handleDocumentDrop);
      dragDepth.current = 0;
    };
  }, [loading, processFiles]);

  return (
    <div className="relative space-y-5">
      <input
        ref={fileInputRef}
        type="file"
        id="gcode-upload"
        className="hidden"
        accept=".3mf,.gcode.3mf,.ufp"
        multiple
        onChange={(e) => {
          if (e.currentTarget.files) {
            const selectedFiles = Array.from(e.currentTarget.files);
            e.currentTarget.value = '';
            void processFiles(selectedFiles);
          }
        }}
      />

      {isDragActive && (
        <div
          className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4 py-6 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="drop-pages-title"
        >
          <div className="forge-modal flex min-h-52 w-full max-w-xl flex-col items-center justify-center border-2 border-dashed border-sky-300 p-10 text-center shadow-2xl">
            <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-lg border border-sky-300 bg-sky-100 shadow-sm">
              <Upload className="h-8 w-8 text-sky-600" />
            </div>
            <h2 id="drop-pages-title" className="text-3xl font-black text-slate-950">
              Drop Pages
            </h2>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="text-lg font-semibold text-slate-950">
            Parts List ({project.parts.length})
          </h3>
          <Button onClick={() => fileInputRef.current?.click()} disabled={loading}>
            {loading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Upload className="mr-2 h-4 w-4" />
            )}
            Add Files
          </Button>
          <Button variant="outline" onClick={handleManualAdd}>
            <Plus className="mr-2 h-4 w-4" />
            Add Manual Parts
          </Button>
        </div>
        <Button onClick={handleFinishReview} disabled={project.parts.length === 0}>
          Move to Quote
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>

      <div className="flex flex-col gap-4">
        {project.parts.length === 0 ? (
          <div className="forge-empty p-12 text-center text-slate-600">
            No parts added yet. Use Add Files or drag files onto this page to get started.
          </div>
        ) : (
          project.parts.map((part) => (
            <PartItem key={part.id} part={part} projectId={project.id} />
          ))
        )}
      </div>
    </div>
  );
};
