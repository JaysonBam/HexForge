import { useEffect, useRef, useState } from 'react';
import { NotebookPen, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
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
  const [opener] = useState(() => document.activeElement);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const dirty = draft !== savedNotes;

  useEffect(() => {
    return () => { if (opener instanceof HTMLElement) opener.focus(); };
  }, [opener]);

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
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-950/35 backdrop-blur-[2px] print:hidden"
      onClick={() => void save(true)}
      onKeyDown={(event) => {
        if (event.key === 'Tab') {
          const controls = event.currentTarget.querySelectorAll<HTMLButtonElement | HTMLTextAreaElement>('button:not(:disabled), textarea');
          const first = controls[0];
          const last = controls[controls.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
          if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
        if (event.key === 'Escape' || ((event.ctrlKey || event.metaKey) && event.key === 's')) {
          event.preventDefault();
          void save(event.key === 'Escape');
        }
      }}
    >
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-notes-title"
        className="forge-drawer flex h-full w-full max-w-xl flex-col"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-center gap-3 border-b border-slate-300 bg-white px-5 py-4">
          <NotebookPen size={20} className="shrink-0 text-slate-600" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <h2 id="project-notes-title" className="text-lg font-black text-slate-950">Project notes</h2>
            <p className="truncate text-xs text-slate-500">{project.id} · {project.studentName}</p>
          </div>
          <Button size="sm" onClick={() => void save()} disabled={!dirty} loading={saving} loadingText="Saving…">
            Save
          </Button>
          <Button variant="ghost" size="icon" disabled={saving} onClick={() => void save(true)} aria-label="Close notes">
            <X size={18} />
          </Button>
        </div>
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
        <div className="shrink-0 border-t border-slate-200 bg-white px-5 py-3 text-xs text-slate-500" role="status" aria-live="polite">
          {error
            ? <span className="font-semibold text-rose-700">Notes could not be saved. Your text is still here. Try Save again.</span>
            : saving ? 'Saving notes…' : dirty ? 'Unsaved changes · Save or close this panel to save.' : 'All notes saved'}
        </div>
      </aside>
    </div>
  );
}
