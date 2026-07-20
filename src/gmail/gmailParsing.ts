import type { Project } from '../types';
import type { GmailProjectSuggestions, GmailThreadSnapshot } from './types';

const STUDENT_NUMBER_PATTERN = /(?<!\d)(\d{8})(?!\d)/g;
const LABELLED_NAME_PATTERN = /\b(?:student\s*name|full\s*name|name)\s*[:-]\s*([A-Za-z][A-Za-z .'-]{1,80})/i;
const MODULE_CODE_PATTERN = /(?<![A-Za-z0-9])([A-Za-z]{3})[ \t]?(\d{3})(?![A-Za-z0-9])/g;

const normalizeModuleCode = (value: string) => value.replace(/\s+/g, '').toUpperCase();
export const formatModuleCode = (value: string): string => {
  const normalized = normalizeModuleCode(value);
  return /^[A-Z]{3}\d{3}$/.test(normalized) ? `${normalized.slice(0, 3)} ${normalized.slice(3)}` : value.trim();
};

export const findSavedModuleCode = (
  values: string[],
  savedModules: Array<{ code: string }>
): string => {
  const savedCodes = new Set(savedModules.map((module) => normalizeModuleCode(module.code)));
  const matches = new Set<string>();
  values.forEach((value) => {
    for (const match of value.matchAll(MODULE_CODE_PATTERN)) {
      const normalizedCode = `${match[1]}${match[2]}`.toUpperCase();
      if (savedCodes.has(normalizedCode)) matches.add(formatModuleCode(normalizedCode));
    }
  });
  return matches.size === 1 ? [...matches][0] : '';
};

export const findStudentNumbers = (values: string[]): string[] => {
  const matches = new Set<string>();
  values.forEach((value) => {
    for (const match of value.matchAll(STUDENT_NUMBER_PATTERN)) matches.add(match[1]);
  });
  return [...matches];
};

const cleanLabelledName = (value: string) => value
  .split(/\r?\n|\s{2,}|[,;|]/, 1)[0]
  .trim()
  .replace(/[.:-]+$/, '')
  .trim();

export const extractLabelledName = (values: string[]): string => {
  for (const value of values) {
    const match = value.match(LABELLED_NAME_PATTERN);
    if (match) return cleanLabelledName(match[1]);
  }
  return '';
};

export const extractProjectSuggestions = (
  thread: GmailThreadSnapshot,
  existingProjects: Project[],
  savedModules: Array<{ code: string }> = []
): GmailProjectSuggestions => {
  const externalMessages = thread.messages.filter((message) => message.senderEmail.toLowerCase() !== thread.accountEmail.toLowerCase());
  const accountEmail = thread.accountEmail.toLowerCase();
  const searchableValues = thread.messages.flatMap((message) => [
    message.subject,
    message.body,
    ...(message.senderEmail.toLowerCase() === accountEmail ? [] : [message.senderEmail]),
    ...message.recipientEmails.filter((email) => email.toLowerCase() !== accountEmail),
    ...message.attachments.map((attachment) => attachment.filename)
  ]);
  const studentNumberCandidates = findStudentNumbers(searchableValues);
  const studentNumber = studentNumberCandidates.length === 1 ? studentNumberCandidates[0] : '';
  const email = thread.mainContactEmail;
  const labelledName = extractLabelledName(thread.messages.flatMap((message) => [message.body, message.subject]));
  const displayName = externalMessages.map((message) => message.senderName.trim()).find(Boolean) || '';
  const matchingProject = existingProjects.find((project) =>
    (email && project.email?.trim().toLowerCase() === email.toLowerCase())
    || (studentNumber && project.studentNumber === studentNumber));

  return {
    studentNumber,
    studentNumberCandidates,
    studentName: labelledName || displayName || matchingProject?.studentName || '',
    email,
    moduleCode: findSavedModuleCode(searchableValues, savedModules)
  };
};

export const isSupportedGmailAttachment = (filename: string): boolean => /\.(stl|3mf|zip)$/i.test(filename.trim());

export const buildRecentPrintEmailQuery = (term: string): string => {
  const searchTerm = /\s/.test(term) ? `"${term}"` : term;
  return `newer_than:30d ${searchTerm}`;
};

export const buildUnreadPrintEmailQuery = (term: string): string => {
  const searchTerm = /\s/.test(term) ? `"${term}"` : term;
  return `newer_than:90d is:unread ${searchTerm}`;
};

export const getGmailMessageDirection = (
  senderEmail: string,
  accountEmail: string,
  hasSentLabel = false
): 'incoming' | 'outgoing' =>
  hasSentLabel || senderEmail.trim().toLowerCase() === accountEmail.trim().toLowerCase() ? 'outgoing' : 'incoming';
