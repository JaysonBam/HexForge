import { useEffect, useRef, useState } from 'react';
import { NotebookPen } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { SidePanel } from '@/components/ui/SidePanel';
import type { Project } from '@/types';

export function ProjectNotesPanel({ project, onSave, onClose }: {
  project: Project;
  onSave: (notes: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(project.notes ?? '');
  const [savedNotes, setSavedNotes] = useState(project.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const dirty = draft !== savedNotes;

  useEffect(() => {
    if (!dirty) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', warnBeforeLeaving);
    return () => window.removeEventListener('beforeunload', warnBeforeLeaving);
  }, [dirty]);

  const save = async (closeAfterSave = false) => {
    if (saving) return;
    if (!dirty) {
      if (closeAfterSave) onClose();
      return;
    }
    setSaving(true);
    setError(false);
    try {
      if (await onSave(draft)) {
        setSavedNotes(draft);
        if (closeAfterSave) onClose();
      } else {
        setError(true);
      }
    } catch {
      setError(true);
    } finally {
      setSaving(false);
      inputRef.current?.focus();
    }
  };

  return (
    <SidePanel
      title="Project notes"
      subtitle={`${project.id} · ${project.studentName}`}
      icon={NotebookPen}
      onClose={() => void save(true)}
      closeLabel="Close notes"
      closeDisabled={saving}
      actions={(
        <Button size="sm" onClick={() => void save()} disabled={!dirty} loading={saving} loadingText="Saving…">
          Save
        </Button>
      )}
      footer={(
        <div className="shrink-0 border-t border-slate-200 bg-white px-5 py-3 text-xs text-slate-500" role="status" aria-live="polite">
          {error
            ? <span className="font-semibold text-rose-700">Notes could not be saved. Your text is still here. Try Save again.</span>
            : saving ? 'Saving notes…' : dirty ? 'Unsaved changes · Save or close this panel to save.' : 'All notes saved'}
        </div>
      )}
      onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.key === 's') {
          event.preventDefault();
          void save();
        }
      }}
    >
        <textarea
          ref={inputRef}
          autoFocus
          aria-label="Project notes"
          placeholder="Write notes about this project…"
          className="min-h-0 w-full flex-1 resize-none bg-white p-5 text-sm leading-7 text-slate-900 placeholder:text-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-300"
          value={draft}
          readOnly={saving}
          onChange={(event) => setDraft(event.target.value)}
        />
    </SidePanel>
  );
}
