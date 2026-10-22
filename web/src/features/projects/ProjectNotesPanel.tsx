import { useEffect, useRef, useState } from 'react';
import { NotebookPen } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { SidePanel } from '@/components/ui/SidePanel';
import { useProjects } from '@/features/projects/context/ProjectContext';
import type { Project } from '@/types';

export function ProjectNotesPanel({ project, onClose }: {
  project: Project;
  onClose: () => void;
}) {
  const { saveProjectNotes } = useProjects();
  const [draft, setDraft] = useState(project.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const dirty = draft !== (project.notes ?? '');

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    input.scrollTop = input.scrollHeight;
  }, []);

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
    const saved = await saveProjectNotes(project.id, draft);
    setSaving(false);
    setError(!saved);
    if (saved && closeAfterSave) onClose();
    else inputRef.current?.focus();
  };

  return (
    <SidePanel
      title="Project notes"
      subtitle={`${project.id} · ${project.studentName}`}
      status={error ? 'Save failed' : saving ? 'Saving…' : dirty ? 'Unsaved' : 'Saved'}
      icon={NotebookPen}
      onClose={() => void save(true)}
      closeLabel="Close notes"
      closeDisabled={saving}
      actions={(
        <Button size="sm" onClick={() => void save()} disabled={!dirty} loading={saving} loadingText="Saving…">
          Save
        </Button>
      )}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-4 p-5">
        {error && (
          <div role="alert" className="rounded-md border border-rose-300 dark:border-rose-800 bg-rose-100 dark:bg-rose-950/55 p-4 text-sm font-bold text-rose-900 dark:text-rose-200">
            Notes could not be saved. Your text is still here. Try Save again.
          </div>
        )}
        <Card className="flex min-h-0 flex-1 overflow-hidden">
          <textarea
            ref={inputRef}
            aria-label="Project notes"
            placeholder="Write notes about this project…"
            className="min-h-0 w-full flex-1 resize-none rounded-lg bg-white dark:bg-[var(--forge-panel)] p-5 text-sm font-medium leading-relaxed text-slate-800 dark:text-slate-200 placeholder:text-slate-400 dark:placeholder:text-slate-400 focus:outline-none"
            value={draft}
            readOnly={saving}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key === 's') {
                event.preventDefault();
                void save();
              }
            }}
          />
        </Card>
      </div>
    </SidePanel>
  );
}
