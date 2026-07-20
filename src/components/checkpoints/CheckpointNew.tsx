import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Project } from '../../types';
import { useProjects } from '../../context/ProjectContext';
import { useSettings } from '../../context/SettingsContext';
import { Button } from '../ui/Button';
import { Card, CardContent, CardHeader } from '../ui/Card';
import { useFeedback } from '../ui/FeedbackProvider';
import { getStudentEmail, isValidEmail, isValidStudentNumber } from '../../domain/operations';
import {
  DEFAULT_FILAMENT_SOURCE,
  FILAMENT_SOURCE_VALUES,
  filamentSourceLabel,
  normalizeFilamentSource
} from '../../domain/filamentSource.ts';
import { GmailThreadPicker } from '../../gmail/GmailThreadPicker';
import { extractProjectSuggestions, isSupportedGmailAttachment } from '../../gmail/gmailParsing';
import { linkProjectGmailThread, unlinkProjectGmailThread } from '../../gmail/gmailProjectService';
import { downloadPreparedGmailAttachments, prepareGmailAttachmentDownload, type PreparedGmailAttachmentDownload } from '../../gmail/gmailAttachmentDownload';
import type { GmailThreadListItem } from '../../gmail/types';
import { openGmailThread } from '../../gmail/gmailUrls';
import { GMAIL_THREAD_ACCOUNT_MISMATCH, useProjectGmailThreadAccess } from '../../gmail/gmailThreadAccess';
import { useLocalHelper } from '../../local-files/LocalHelperContext';
import { ExternalLink, Mail, Paperclip, Unlink } from 'lucide-react';

const buildInitialEmail = (project?: Project) => project?.email || getStudentEmail(project?.studentNumber || '');

export const CheckpointNew = ({ project }: { project?: Project }) => {
  const navigate = useNavigate();
  const { addProject, updateProject, projects } = useProjects();
  const { modules, nextPriority, setNextPriority } = useSettings();
  const { confirm, notify, prompt, showMessage } = useFeedback();
  const { state: helperState, client: helperClient } = useLocalHelper();
  const { canUseGmail } = useProjectGmailThreadAccess(project || { gmailThreadId: null, gmailAccountEmail: null });

  const [formData, setFormData] = useState({
    studentName: project?.studentName || '',
    studentNumber: project?.studentNumber || '',
    email: buildInitialEmail(project),
    priorityNumber: project?.priorityNumber ?? nextPriority,
    course: project?.course || '',
    lecturer: project?.lecturer || '',
    needsPayment: project?.needsPayment ?? true,
    moduleOrLecturerPays: project?.moduleOrLecturerPays ?? false,
    defaultFilamentSource: normalizeFilamentSource(project?.defaultFilamentSource)
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [gmailPickerOpen, setGmailPickerOpen] = useState(false);
  const [selectedGmailThread, setSelectedGmailThread] = useState<GmailThreadListItem | null>(null);
  const [gmailLinking, setGmailLinking] = useState(false);
  const [saving, setSaving] = useState(false);

  const applySelectedThread = async (item: GmailThreadListItem) => {
    if (project) {
      if (project.gmailThreadId && project.gmailThreadId !== item.threadId) {
        const replace = await confirm({
          title: 'Replace Main Gmail Thread?',
          message: 'The cached correspondence for the current Main Gmail Thread will be removed.',
          messages: [project.gmailThreadSubject || project.gmailThreadId, `Replace with: ${item.subject}`],
          confirmLabel: 'Replace thread',
          cancelLabel: 'Keep current thread'
        });
        if (!replace) return;
      }
      setGmailLinking(true);
      try {
        if (project.gmailThreadId && project.gmailThreadId !== item.threadId) await unlinkProjectGmailThread(project.id);
        await linkProjectGmailThread(project.id, item.snapshot);
        updateProject(project.id, {
          gmailThreadId: item.snapshot.id,
          gmailAccountEmail: item.snapshot.accountEmail,
          gmailThreadSubject: item.snapshot.subject,
          gmailMainContactEmail: item.snapshot.mainContactEmail,
          gmailLastSyncedAt: item.snapshot.syncedAt
        });
        notify({ title: 'Main Gmail Thread linked', message: item.subject, tone: 'success' });
      } catch (error) {
        await showMessage({ title: 'Main Gmail Thread was not linked', messages: [error instanceof Error ? error.message : 'Unexpected Gmail linking error.'], tone: 'error' });
      } finally {
        setGmailLinking(false);
      }
      return;
    }

    const suggestions = extractProjectSuggestions(item.snapshot, projects, modules);
    const matchedModule = modules.find((module) =>
      module.code.replace(/\s+/g, '').toUpperCase() === suggestions.moduleCode.replace(/\s+/g, '').toUpperCase());
    setSelectedGmailThread(item);
    setFormData((previous) => ({
      ...previous,
      studentName: suggestions.studentName || previous.studentName,
      studentNumber: suggestions.studentNumber,
      email: suggestions.email || previous.email,
      ...(matchedModule ? {
        course: suggestions.moduleCode,
        lecturer: matchedModule.lecturer,
        needsPayment: !matchedModule.modulePayment,
        moduleOrLecturerPays: !!matchedModule.modulePayment,
        defaultFilamentSource: normalizeFilamentSource(matchedModule.defaultFilamentSource)
      } : {})
    }));
    setErrors({});
    if (suggestions.studentNumberCandidates.length > 1) {
      notify({
        title: 'Student number needs review',
        message: `Found multiple eight-digit numbers: ${suggestions.studentNumberCandidates.join(', ')}. No number was selected.`,
        tone: 'warning'
      });
    }
  };

  const unlinkThread = async () => {
    if (!project?.gmailThreadId || gmailLinking) return;
    const approved = await confirm({
      title: 'Unlink Main Gmail Thread?',
      message: 'Cached Gmail messages and attachment download records for this project will be removed. Gmail itself is not changed.',
      confirmLabel: 'Unlink thread',
      cancelLabel: 'Keep linked'
    });
    if (!approved) return;
    setGmailLinking(true);
    try {
      await unlinkProjectGmailThread(project.id);
      updateProject(project.id, {
        gmailThreadId: null,
        gmailAccountEmail: null,
        gmailThreadSubject: null,
        gmailMainContactEmail: null,
        gmailLastSyncedAt: null
      });
      notify({ title: 'Main Gmail Thread unlinked', message: 'The project is no longer linked to Gmail.', tone: 'success' });
    } catch (error) {
      await showMessage({ title: 'Main Gmail Thread was not unlinked', messages: [error instanceof Error ? error.message : 'Unexpected unlink error.'], tone: 'error' });
    } finally {
      setGmailLinking(false);
    }
  };

  const updateStudentNumber = (value: string) => {
    const sanitizedStudentNumber = value.replace(/\D/g, '').slice(0, 8);
    const previousSuggestedEmail = getStudentEmail(formData.studentNumber);
    const nextSuggestedEmail = getStudentEmail(sanitizedStudentNumber);
    const shouldRefreshEmail =
      !formData.email.trim() ||
      formData.email === previousSuggestedEmail;

    setFormData(prev => ({
      ...prev,
      studentNumber: sanitizedStudentNumber,
      email: shouldRefreshEmail ? nextSuggestedEmail : prev.email
    }));
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;

    if (name === 'studentNumber') {
      updateStudentNumber(value);
      return;
    }

    if (name === 'priorityNumber') {
      setFormData(prev => ({
        ...prev,
        priorityNumber: Math.max(1, Number.parseInt(value, 10) || 1)
      }));
      return;
    }

    if (name === 'course') {
      const matchedModule = modules.find(m => m.code === value);
      if (matchedModule) {
        setFormData(prev => ({
          ...prev,
          course: value,
          lecturer: matchedModule.lecturer,
          needsPayment: !matchedModule.modulePayment,
          moduleOrLecturerPays: !!matchedModule.modulePayment,
          defaultFilamentSource: normalizeFilamentSource(matchedModule.defaultFilamentSource)
        }));
        return;
      }
    }

    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSave = async () => {
    if (saving) return;
    const missing: string[] = [];
    const trimmedEmail = formData.email.trim();

    if (!formData.studentName.trim()) missing.push('Student name is required.');
    if (!formData.studentNumber.trim()) missing.push('Student number is required.');
    else if (!isValidStudentNumber(formData.studentNumber)) missing.push('Student number must be exactly 8 digits.');
    if (!trimmedEmail) missing.push('Email is required.');
    else if (!isValidEmail(trimmedEmail)) missing.push('Email address must be valid.');

    setErrors({
      studentName: !formData.studentName.trim() ? 'This field is required.' : '',
      studentNumber: !formData.studentNumber.trim()
        ? 'This field is required.'
        : !isValidStudentNumber(formData.studentNumber)
          ? 'Student number must be exactly 8 digits.'
          : '',
      email: !trimmedEmail
        ? 'This field is required.'
        : !isValidEmail(trimmedEmail)
          ? 'Enter a valid email address.'
          : '',
      priorityNumber: formData.priorityNumber < 1 ? 'Priority number must be at least 1.' : ''
    });

    if (missing.length > 0 || formData.priorityNumber < 1) {
      const messages = [...missing];
      if (formData.priorityNumber < 1) messages.push('Priority number must be at least 1.');

      await showMessage({
        title: 'Project details incomplete',
        messages,
        tone: 'warning'
      });
      return;
    }

    const payload = {
      ...formData,
      email: trimmedEmail,
      needsPayment: formData.moduleOrLecturerPays ? false : formData.needsPayment,
      defaultFilamentSource: normalizeFilamentSource(formData.defaultFilamentSource || DEFAULT_FILAMENT_SOURCE),
      ...(selectedGmailThread ? {
        gmailThreadId: selectedGmailThread.snapshot.id,
        gmailAccountEmail: selectedGmailThread.snapshot.accountEmail,
        gmailThreadSubject: selectedGmailThread.snapshot.subject,
        gmailMainContactEmail: selectedGmailThread.snapshot.mainContactEmail,
        gmailLastSyncedAt: selectedGmailThread.snapshot.syncedAt
      } : {})
    };

    if (project) {
      updateProject(project.id, payload);
      return;
    }

    setSaving(true);
    try {
      const newId = await addProject({
        ...payload,
        state: 'REVIEW'
      });
      if (!newId) {
        await showMessage({ title: 'Project was not created', messages: ['Supabase did not save the project. Review the synchronization warning and try again.'], tone: 'error' });
        return;
      }

      const createdProject: Project = {
        id: newId,
        ...payload,
        state: 'REVIEW',
        parts: [],
        createdAt: new Date().toISOString(),
        archived: false
      };

      let gmailCacheSaved = true;
      if (selectedGmailThread) {
        try {
          await linkProjectGmailThread(newId, selectedGmailThread.snapshot);
        } catch (error) {
          gmailCacheSaved = false;
          notify({
            title: 'Project created; Gmail cache needs attention',
            message: error instanceof Error ? error.message : 'The Main Gmail Thread was linked, but its cached messages were not saved.',
            tone: 'warning'
          });
        }
      }

      if (selectedGmailThread && gmailCacheSaved) {
        const supportedCount = selectedGmailThread.snapshot.messages.flatMap((message) => message.attachments)
          .filter((attachment) => isSupportedGmailAttachment(attachment.filename)).length;
        if (supportedCount > 0 && helperState !== 'connected') {
          notify({ title: 'Attachments not downloaded', message: 'The local helper is unavailable. Use View Correspondence on the main workstation to download the missing STL and 3MF files.', tone: 'warning' });
        } else if (supportedCount > 0) {
          try {
            let prepared = await prepareGmailAttachmentDownload(createdProject, helperClient);
            if (prepared.resolution.status === 'ambiguous') {
              const labels = prepared.resolution.candidates.map((candidate) => `${candidate.folderName} — ${candidate.workflowFolder.replaceAll('_', ' ')}`);
              const selection = await prompt({
                title: 'Choose the project folder',
                message: 'Several folders use this project priority. Choose the confirmed match before downloading attachments.',
                fields: [{ name: 'folder', label: 'Project folder', type: 'select', options: labels, required: true }],
                confirmLabel: 'Use this folder'
              });
              const selectedCandidate = prepared.resolution.candidates[labels.indexOf(selection?.folder || '')];
              if (selectedCandidate) prepared = await prepareGmailAttachmentDownload(createdProject, helperClient, selectedCandidate.candidateId);
            }
            if (prepared.resolution.status === 'ambiguous') {
              notify({ title: 'Attachments not downloaded', message: 'No project folder was selected. The files remain available for later download.', tone: 'warning' });
            } else if (prepared.resolution.status === 'not_found') {
              notify({ title: 'Attachments not downloaded', message: 'The project folder could not be found or created.', tone: 'warning' });
            } else if (prepared.attachments.length > 0 && 'projectKey' in prepared.resolution) {
              const shouldDownload = await confirm({
                title: 'Download Gmail attachments?',
                message: `Download ${prepared.attachments.length} supported ${prepared.attachments.length === 1 ? 'file' : 'files'} to ${prepared.resolution.folderName}?`,
                messages: prepared.attachments.map((attachment) => attachment.filename),
                tone: 'info',
                confirmLabel: 'Download files',
                cancelLabel: 'Download later'
              });
              if (shouldDownload) {
                const result = await downloadPreparedGmailAttachments(createdProject, helperClient, prepared as PreparedGmailAttachmentDownload);
                notify({
                  title: result.failed ? 'Attachment download completed with warnings' : 'Gmail attachments downloaded',
                  message: `${result.saved} saved, ${result.skipped} skipped, ${result.renamed} safely renamed${result.failed ? `, ${result.failed} failed` : ''}.`,
                  tone: result.failed ? 'warning' : 'success'
                });
              }
            }
          } catch (error) {
            notify({ title: 'Attachments not downloaded', message: error instanceof Error ? error.message : 'The local helper could not prepare the project folder.', tone: 'warning' });
          }
        }
      }

      setNextPriority(Math.max(nextPriority, formData.priorityNumber) + 1);
      navigate(`/project/${newId}`, { state: selectedGmailThread ? undefined : { autoCreateLocalFolderFor: newId } });
    } finally {
      setSaving(false);
    }
  };

  const inputBaseClassName = 'forge-command-input h-11 w-full px-3.5 text-sm font-semibold placeholder:text-slate-500';
  const defaultInputClassName = inputBaseClassName;
  const errorInputClassName = `${inputBaseClassName} border-rose-500 bg-rose-50 focus:border-rose-600 focus:ring-rose-200`;
  const sectionClassName = 'forge-panel space-y-5 p-5';

  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b border-slate-300 bg-gradient-to-r from-slate-100 via-white to-sky-50">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-2">
            <h2 className="text-2xl font-black tracking-tight text-slate-950">
              {project ? 'Project Details' : 'New Project Details'}
            </h2>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button onClick={handleSave} size="lg" className="min-w-[180px]" disabled={saving}>
            {saving ? 'Creating Project…' : project && project.state !== 'INTAKE' ? 'Save Details' : 'Create Project'}
          </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="forge-mechanical-lines space-y-8 bg-slate-100/70 p-5 md:p-6">
        <section className={sectionClassName}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-black text-slate-950">Main Gmail Thread</h3>
              <p className="mt-1 text-xs font-semibold text-slate-600">Optional. One Gmail conversation can be linked to this project.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {(selectedGmailThread || project?.gmailThreadId) && (
                <span className="inline-flex" title={!selectedGmailThread && !canUseGmail ? GMAIL_THREAD_ACCOUNT_MISMATCH : undefined}>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    onClick={() => openGmailThread(selectedGmailThread?.threadId || project!.gmailThreadId!)}
                    disabled={!selectedGmailThread && !canUseGmail}
                  >
                    <ExternalLink size={14} /> Open Thread in Gmail
                  </Button>
                </span>
              )}
              {project?.gmailThreadId && <Button variant="ghost" size="sm" className="gap-2 text-rose-700" onClick={() => void unlinkThread()} disabled={gmailLinking}><Unlink size={14} /> Unlink</Button>}
              <Button variant="outline" size="sm" className="gap-2" onClick={() => setGmailPickerOpen(true)} disabled={gmailLinking}>
                <Mail size={14} /> {project?.gmailThreadId ? 'Replace Main Gmail Thread' : selectedGmailThread ? 'Choose another thread' : project ? 'Link Main Gmail Thread' : 'Import from Gmail'}
              </Button>
            </div>
          </div>
          {(selectedGmailThread || project?.gmailThreadId) ? (
            <div className="rounded-lg border border-sky-300 bg-sky-50 p-4">
              <p className="text-xs font-black uppercase tracking-[0.12em] text-sky-800">Linked Main Gmail Thread</p>
              <p className="mt-1 text-sm font-black text-slate-950">{selectedGmailThread?.subject || project?.gmailThreadSubject || '(no subject)'}</p>
              <p className="mt-1 text-xs font-semibold text-slate-600">Main contact: {selectedGmailThread?.snapshot.mainContactEmail || project?.gmailMainContactEmail || 'Not detected'}</p>
              {selectedGmailThread && (() => {
                const filenames = selectedGmailThread.snapshot.messages.flatMap((message) => message.attachments)
                  .filter((attachment) => isSupportedGmailAttachment(attachment.filename)).map((attachment) => attachment.filename);
                return filenames.length > 0 ? <div className="mt-3 flex flex-wrap gap-1.5">{filenames.map((filename, index) => <span key={`${filename}-${index}`} className="forge-badge inline-flex items-center gap-1 px-2 py-1 text-[10px]"><Paperclip size={11} /> {filename}</span>)}</div> : <p className="mt-3 text-xs font-semibold text-slate-500">No STL or 3MF attachments found in this thread.</p>;
              })()}
            </div>
          ) : <p className="rounded-md border border-dashed border-slate-300 bg-white px-4 py-3 text-xs font-semibold text-slate-500">No Main Gmail Thread linked.</p>}
        </section>
        <section className={sectionClassName}>
          <div className="space-y-1">
            <h3 className="text-lg font-black text-slate-950">Student Information</h3>
          </div>

          <div className="grid gap-5 md:grid-cols-2">
            <div className="space-y-2">
              <label htmlFor="studentName" className="text-sm font-bold text-slate-800">Student Name</label>
              <input
                id="studentName"
                type="text"
                name="studentName"
                value={formData.studentName}
                onChange={handleChange}
                className={errors.studentName ? errorInputClassName : defaultInputClassName}
                placeholder="Enter full name"
              />
              {errors.studentName && <p className="text-xs font-semibold text-rose-600">{errors.studentName}</p>}
            </div>

            <div className="space-y-2">
              <label htmlFor="studentNumber" className="text-sm font-bold text-slate-800">Student Number</label>
              <input
                id="studentNumber"
                type="text"
                name="studentNumber"
                value={formData.studentNumber}
                onChange={(e) => {
                  handleChange(e);
                  setErrors(prev => ({ ...prev, studentNumber: '', email: '' }));
                }}
                className={errors.studentNumber ? errorInputClassName : defaultInputClassName}
                placeholder="12345678"
                inputMode="numeric"
                maxLength={8}
              />
              {errors.studentNumber && <p className="text-xs font-semibold text-rose-600">{errors.studentNumber}</p>}
            </div>
          </div>

          <div className="grid gap-5 md:grid-cols-[minmax(0,1.4fr)_minmax(220px,0.6fr)]">
            <div className="space-y-2">
              <label htmlFor="email" className="text-sm font-bold text-slate-800">Email Address</label>
              <input
                id="email"
                type="email"
                name="email"
                value={formData.email}
                onChange={(e) => {
                  handleChange(e);
                  setErrors(prev => ({ ...prev, email: '' }));
                }}
                className={errors.email ? errorInputClassName : defaultInputClassName}
                placeholder="student@example.com"
                autoComplete="email"
              />
              <p className="text-xs font-semibold text-slate-600">Will be auto-filled when student number is filled.</p>
              {errors.email && <p className="text-xs font-semibold text-rose-600">{errors.email}</p>}
            </div>

            <div className="space-y-2">
              <label htmlFor="priorityNumber" className="text-sm font-bold text-slate-800">Priority Number</label>
              <input
                id="priorityNumber"
                type="number"
                name="priorityNumber"
                min={1}
                value={formData.priorityNumber}
                onChange={(e) => {
                  handleChange(e);
                  setErrors(prev => ({ ...prev, priorityNumber: '' }));
                }}
                className={errors.priorityNumber ? errorInputClassName : defaultInputClassName}
              />
              <p className="text-xs font-semibold text-slate-600">Defaults to the next saved queue number, but stays editable.</p>
              {errors.priorityNumber && <p className="text-xs font-semibold text-rose-600">{errors.priorityNumber}</p>}
            </div>
          </div>
        </section>

        <section className={sectionClassName}>
          <div className="space-y-1">
            <h3 className="text-lg font-black text-slate-950">Academic Details</h3>
          </div>

          <div className="grid gap-5 lg:grid-cols-3">
            <div className="space-y-2">
              <label htmlFor="course" className="text-sm font-bold text-slate-800">Course</label>
              <input
                id="course"
                type="text"
                name="course"
                list="courseOptions"
                value={formData.course}
                onChange={handleChange}
                className={defaultInputClassName}
                placeholder="Select or type a module code"
              />
              <datalist id="courseOptions">
                {modules.map(m => (
                  <option key={m.id} value={m.code}>{m.lecturer}</option>
                ))}
              </datalist>
            </div>

            <div className="space-y-2">
              <label htmlFor="lecturer" className="text-sm font-bold text-slate-800">Lecturer</label>
              <input
                id="lecturer"
                type="text"
                name="lecturer"
                list="lecturerOptions"
                value={formData.lecturer}
                onChange={handleChange}
                className={defaultInputClassName}
                placeholder="Select or type a lecturer name"
              />
              <datalist id="lecturerOptions">
                {Array.from(new Set(modules.map(m => m.lecturer))).map(lecturer => (
                  <option key={lecturer} value={lecturer} />
                ))}
              </datalist>
            </div>

            <div className="space-y-2">
              <label htmlFor="defaultFilamentSource" className="text-sm font-bold text-slate-800">Default Filament Source</label>
              <select
                id="defaultFilamentSource"
                name="defaultFilamentSource"
                value={formData.defaultFilamentSource}
                onChange={(event) => setFormData(prev => ({
                  ...prev,
                  defaultFilamentSource: normalizeFilamentSource(event.target.value)
                }))}
                className={defaultInputClassName}
              >
                {FILAMENT_SOURCE_VALUES.map((source) => (
                  <option key={source} value={source}>{filamentSourceLabel(source)}</option>
                ))}
              </select>
            </div>
          </div>
        </section>

        <section className={sectionClassName}>
          <div className="space-y-1">
            <h3 className="text-lg font-black text-slate-950">Payment Detail</h3>
            <p className="text-sm font-semibold text-slate-700"></p>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <label className="flex cursor-pointer items-start justify-between gap-4 rounded-lg border border-slate-300 bg-slate-100 px-4 py-4 shadow-sm transition-colors hover:border-[color:var(--forge-gold-border)] hover:bg-sky-50">
              <div className="space-y-1">
                <span className="block text-sm font-bold text-slate-900">Module/Lecturer Pays</span>
              </div>
              <input
                type="checkbox"
                checked={formData.moduleOrLecturerPays}
                onChange={(e) => setFormData(prev => ({
                  ...prev,
                  moduleOrLecturerPays: e.target.checked,
                  needsPayment: e.target.checked ? false : prev.needsPayment
                }))}
                className="mt-1 h-4 w-4 rounded border-slate-400 text-sky-700"
              />
            </label>

            {!formData.moduleOrLecturerPays ? (
              <label className="flex cursor-pointer items-start justify-between gap-4 rounded-lg border border-slate-300 bg-white px-4 py-4 shadow-sm transition-colors hover:border-[color:var(--forge-gold-border)] hover:bg-sky-50">
                <div className="space-y-1">
                  <span className="block text-sm font-bold text-slate-900">Student payment required</span>
                </div>
                <input
                  type="checkbox"
                  checked={formData.needsPayment}
                  onChange={(e) => setFormData(prev => ({ ...prev, needsPayment: e.target.checked }))}
                  className="mt-1 h-4 w-4 rounded border-slate-400 text-sky-700"
                />
              </label>
            ) : (
              <div className="flex items-start rounded-lg border border-emerald-300 bg-emerald-100 px-4 py-4 text-sm text-emerald-950 shadow-sm">
                <div>
                  <p className="font-bold">Student payment disabled</p>
                </div>
              </div>
            )}
          </div>
        </section>
      </CardContent>
      <GmailThreadPicker open={gmailPickerOpen} onClose={() => setGmailPickerOpen(false)} onSelect={(item) => void applySelectedThread(item)} />
    </Card>
  );
};
