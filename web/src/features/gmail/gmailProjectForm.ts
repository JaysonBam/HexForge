import { extractProjectSuggestions } from './gmailParsing';
import { normalizeFilamentSource } from '@/domain/filamentSource';
import type { Module } from '@/features/settings/context/SettingsContext';
import type { GmailThreadListItem } from '@/api/google/gmail/types';
import type { Project } from '@/types';

export const gmailProjectFormValues = (
  item: GmailThreadListItem,
  projects: Pick<Project, 'email' | 'studentNumber' | 'studentName' | 'course' | 'lecturer'>[],
  modules: Module[]
) => {
  const suggestions = extractProjectSuggestions(item.snapshot, projects);
  const module = modules.find(module => module.code.replace(/\s+/g, '').toUpperCase()
    === suggestions.moduleCode.replace(/\s+/g, '').toUpperCase());
  return {
    ...(suggestions.studentName ? { studentName: suggestions.studentName } : {}),
    studentNumber: suggestions.studentNumber,
    ...(suggestions.email ? { email: suggestions.email } : {}),
    ...(suggestions.moduleCode ? { course: suggestions.moduleCode } : {}),
    ...(module ? {
      lecturer: module.lecturer,
      needsPayment: !module.modulePayment,
      moduleOrLecturerPays: !!module.modulePayment,
      defaultFilamentSource: normalizeFilamentSource(module.defaultFilamentSource)
    } : {})
  };
};
