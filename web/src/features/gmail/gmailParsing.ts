import type { Project } from '@/types';
import { normalizeModuleCode } from '@/domain/moduleCode';
import type { GmailProjectSuggestions, GmailThreadSnapshot } from '@/api/google/gmail/types';
export {
  buildRecentPrintEmailQuery,
  buildUnreadPrintEmailQuery,
  getGmailMessageDirection,
  isSupportedGmailAttachment
} from '@/api/google/gmail/search';

const STUDENT_NUMBER_PATTERN = /(?<!\d)(\d{8})(?!\d)/g;
const LABELLED_NAME_PATTERN = /\b(?:student\s*name|full\s*name|name)\s*[:-]\s*([A-Za-z][A-Za-z .'-]{1,80})/i;
const MODULE_CODE_PATTERN = /(?<![A-Za-z0-9])([A-Za-z]{3})[ \t]?(\d{3})(?![A-Za-z0-9])/g;

export const formatModuleCode = (value: string): string => {
  return normalizeModuleCode(value) ?? value.trim();
};
export const findModuleCode = (values: string[]): string => {
  const matches = new Set<string>();
  values.forEach((value) => {
    for (const match of value.matchAll(MODULE_CODE_PATTERN)) {
      const normalizedCode = `${match[1]}${match[2]}`.toUpperCase();
      matches.add(formatModuleCode(normalizedCode));
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
  existingProjects: Project[]
): GmailProjectSuggestions => {
  const accountEmail = thread.accountEmail.toLowerCase();
  const externalMessages = thread.messages.filter((message) =>
    message.senderEmail.trim()
    && message.senderEmail.toLowerCase() !== accountEmail);
  const searchableValues = thread.messages.flatMap((message) => [
    message.subject,
    message.body,
    ...(message.senderEmail.toLowerCase() === accountEmail ? [] : [message.senderEmail]),
    ...message.recipientEmails.filter((email) => email.toLowerCase() !== accountEmail),
    ...message.attachments.map((attachment) => attachment.filename)
  ]);
  const contactStudentNumbers = findStudentNumbers([
    thread.mainContactEmail,
    ...externalMessages.map((message) => message.senderEmail)
  ]);
  const studentNumberCandidates = contactStudentNumbers.length === 1
    ? contactStudentNumbers
    : findStudentNumbers([thread.mainContactEmail, thread.subject, ...searchableValues]);
  const studentNumber = studentNumberCandidates.length === 1 ? studentNumberCandidates[0] : '';
  const email = thread.mainContactEmail;
  const labelledName = extractLabelledName([
    ...externalMessages.flatMap((message) => [message.body, message.subject]),
    ...thread.messages.flatMap((message) => [message.body, message.subject])
  ]);
  const displayName = externalMessages.map((message) => message.senderName.trim()).find(Boolean) || '';
  const matchingProject = existingProjects.find((project) =>
    (email && project.email?.trim().toLowerCase() === email.toLowerCase())
    || (studentNumber && project.studentNumber === studentNumber));
  const emailNameParts = email
    .split('@', 1)[0]
    .split(/[._-]+/)
    .filter((part) => /^[A-Za-z]{2,}$/.test(part));
  const inferredEmailName = emailNameParts.length >= 2
    ? emailNameParts.map((part) => `${part[0].toUpperCase()}${part.slice(1).toLowerCase()}`).join(' ')
    : '';

  return {
    studentNumber,
    studentNumberCandidates,
    studentName: labelledName || displayName || matchingProject?.studentName || inferredEmailName,
    email,
    moduleCode: findModuleCode(searchableValues)
  };
};
