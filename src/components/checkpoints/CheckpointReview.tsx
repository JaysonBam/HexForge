import { useCallback, useEffect, useRef, useState } from 'react';
import type { Project } from '../../types';
import { useProjects } from '../../context/ProjectContext';
import { useSettings } from '../../context/SettingsContext';
import { useStaffActionName } from '../../hooks/useStaffActionName';
import { PartItem } from './PartItem';
import { Upload, Plus, ArrowRight, Loader2 } from 'lucide-react';
import { Button } from '../ui/Button';
import { useFeedback } from '../ui/FeedbackProvider';
import { uploadThumbnailFromBlobUrl } from '../../utils/storageUtils';
import { isPartVerifiedForReview } from '../../domain/partVerification';
import { analyzeProjectFiles } from '../../local-files/projectFileImport';

type CheckpointReviewProps = {
  project: Project;
  onAdvanceFromLockedReview?: () => void;
};

const hasDraggedFiles = (event: DragEvent) => {
  return Boolean(event.dataTransfer && Array.from(event.dataTransfer.types).includes('Files'));
};

export const CheckpointReview = ({ project, onAdvanceFromLockedReview }: CheckpointReviewProps) => {
  const { transitionProjectState, addExtractedParts, addPart } = useProjects();
  const { getFilamentPrice } = useSettings();
  const { requestStaffName } = useStaffActionName();
  const { notify, prompt, showMessage } = useFeedback();
  const [loading, setLoading] = useState(false);
  const [advancing, setAdvancing] = useState(false);
  const [isDragActive, setIsDragActive] = useState(false);
  const dragDepth = useRef(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Parse Bambu Studio 3mf config

  const processFiles = useCallback(async (newFiles: FileList | File[]) => {
    setLoading(true);

    try {
      const { parts, errors } = await analyzeProjectFiles({
        files: Array.from(newFiles),
        startPartNumber: project.parts.length + 1,
        getFilamentPrice,
        uploadThumbnail: uploadThumbnailFromBlobUrl
      });
      if (parts.length > 0) await addExtractedParts(project.id, parts);

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
    if (advancing) return;
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

    const technicianName = await requestStaffName('completing review');
    if (!technicianName) return;

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

    setAdvancing(true);
    const result = await transitionProjectState({
      projectId: project.id,
      action: 'COMPLETE_REVIEW',
      technicianName
    });
    setAdvancing(false);

    if (!result.ok) {
      await showMessage({ title: 'Cannot move to quote', messages: result.errors, tone: 'error' });
      return;
    }

    if (result.warnings && result.warnings.length > 0) {
      await showMessage({ title: 'Moved with warnings', messages: result.warnings, tone: 'warning' });
    } else {
      notify({ title: 'Review complete', message: 'Project moved to Quote.', tone: 'success' });
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
        <Button
          onClick={handleFinishReview}
          disabled={project.parts.length === 0 || project.parts.some((part) => !isPartVerifiedForReview(part))}
          loading={advancing}
          loadingText="Moving to Quote…"
          title={project.parts.length === 0 ? 'Add at least one part first.' : project.parts.some((part) => !isPartVerifiedForReview(part)) ? 'Verify every part first.' : undefined}
        >
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
