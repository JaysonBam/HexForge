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

const buildInitialEmail = (project?: Project) => project?.email || getStudentEmail(project?.studentNumber || '');

export const CheckpointNew = ({ project }: { project?: Project }) => {
  const navigate = useNavigate();
  const { addProject, updateProject } = useProjects();
  const { modules, nextPriority, setNextPriority } = useSettings();
  const { showMessage } = useFeedback();

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
      defaultFilamentSource: normalizeFilamentSource(formData.defaultFilamentSource || DEFAULT_FILAMENT_SOURCE)
    };

    if (project) {
      updateProject(project.id, payload);
      return;
    }

    const newId = addProject({
      ...payload,
      state: 'REVIEW'
    });

    setNextPriority(Math.max(nextPriority, formData.priorityNumber) + 1);
    navigate(`/project/${newId}`);
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
          <Button onClick={handleSave} size="lg" className="min-w-[180px]">
            {project && project.state !== 'INTAKE' ? 'Save Details' : 'Create Project'}
          </Button>
        </div>
      </CardHeader>

      <CardContent className="forge-mechanical-lines space-y-8 bg-slate-100/70 p-5 md:p-6">
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
    </Card>
  );
};
