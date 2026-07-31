import assert from 'node:assert/strict';
import test from 'node:test';
import type { LocalProjectFile } from '@hexforge/windows-helper/contracts';
import {
  buildRecentPrintEmailQuery,
  buildUnreadPrintEmailQuery,
  extractProjectSuggestions,
  findModuleCode,
  findStudentNumbers,
  getGmailMessageDirection,
  isSupportedGmailAttachment
} from '@/features/gmail/gmailParsing.ts';
import { stripQuotedReplyContent } from '@/api/google/gmail/decoding.ts';
import { getGmailThreadUrl } from '@/api/google/gmail/urls.ts';
import { canUseProjectGmailThread, GMAIL_THREAD_ACCOUNT_MISMATCH } from '@/features/gmail/gmailThreadOwnership.ts';
import { isGmailAttachmentDownloadEligible, isGmailAttachmentSavedLocally } from '@/features/gmail/gmailAttachmentAvailability.ts';
import type { GmailThreadSnapshot } from '@/api/google/gmail/types.ts';
import type { Project } from '@/types/index.ts';
import { isValidModuleCode, normalizeModuleCode } from '@/domain/moduleCode.ts';

const baseThread = (body: string, overrides: Partial<GmailThreadSnapshot> = {}): GmailThreadSnapshot => ({
  id: 'thread-1',
  accountEmail: 'printing@example.com',
  subject: '3D print request 12345678',
  mainContactEmail: 'student@example.com',
  syncedAt: '2026-07-18T10:00:00.000Z',
  messages: [{
    id: 'message-1',
    threadId: 'thread-1',
    senderName: 'Student Display Name',
    senderEmail: 'student@example.com',
    recipientEmails: ['printing@example.com'],
    subject: '3D print request 12345678',
    body,
    messageDate: '2026-07-18T09:00:00.000Z',
    direction: 'incoming',
    hasAttachments: true,
    messageIdHeader: '<message-1@example.com>',
    referencesHeader: '',
    attachments: [{ messageId: 'message-1', attachmentId: 'attachment-1', partId: '1', filename: 'MODEL.STL', mimeType: 'application/octet-stream', size: 4 }]
  }],
  ...overrides
});
test('recent print Gmail query includes read and unread messages', () => {
  const query = buildRecentPrintEmailQuery('3d print');
  assert.equal(query, 'newer_than:30d "3d print"');
  assert.doesNotMatch(query, /is:unread/i);
});
test('dashboard Gmail query finds unread messages in print threads from the last three months', () => {
  const query = buildUnreadPrintEmailQuery('3d print');
  assert.equal(query, 'newer_than:90d is:unread -from:linkedin.com "3d print"');
});

test('project Gmail links use the working primary-account thread route', () => {
  assert.equal(getGmailThreadUrl('19fc3bf2c9c0f31'), 'https://mail.google.com/mail/u/0/#all/19fc3bf2c9c0f31');
});

test('linked Gmail actions are available only to the account that linked the thread', () => {
  const project = { gmailThreadId: 'thread-1', gmailAccountEmail: 'Printing@Example.com' };
  assert.equal(canUseProjectGmailThread(project, 'printing@example.com'), true);
  assert.equal(canUseProjectGmailThread(project, 'other@example.com'), false);
  assert.equal(canUseProjectGmailThread({ ...project, gmailAccountEmail: null }, 'printing@example.com'), false);
  assert.equal(canUseProjectGmailThread({ gmailThreadId: null, gmailAccountEmail: null }, 'other@example.com'), true);
  assert.equal(GMAIL_THREAD_ACCOUNT_MISMATCH, 'This thread is not linked to your Gmail account.');
});

test('student extraction fills one standalone eight-digit number and labelled name', () => {
  const suggestions = extractProjectSuggestions(baseThread('Name: Ada Lovelace\nStudent number: 12345678'), []);
  assert.equal(suggestions.studentNumber, '12345678');
  assert.deepEqual(suggestions.studentNumberCandidates, ['12345678']);
  assert.equal(suggestions.studentName, 'Ada Lovelace');
  assert.equal(suggestions.email, 'student@example.com');
});

test('student extraction does not guess when multiple eight-digit numbers exist', () => {
  const thread = baseThread('Student number may be 12345678 or 87654321', { subject: 'Print request' });
  thread.messages[0].subject = 'Print request';
  const suggestions = extractProjectSuggestions(thread, []);
  assert.equal(suggestions.studentNumber, '');
  assert.deepEqual(suggestions.studentNumberCandidates.sort(), ['12345678', '87654321']);
});

test('student number matching is standalone and checks filenames and email addresses', () => {
  assert.deepEqual(findStudentNumbers(['u12345678@tuks.co.za', 'job-87654321.3mf', 'x123456789y']).sort(), ['12345678', '87654321']);
});

test('student extraction prioritizes the external Tuks address over unrelated thread numbers', () => {
  const thread = baseThread('Please print two copies for room 87654321.');
  thread.mainContactEmail = 'u12345678@tuks.co.za';
  thread.messages[0].senderEmail = 'u12345678@tuks.co.za';
  thread.messages[0].subject = 'Print request';
  const suggestions = extractProjectSuggestions(thread, []);
  assert.equal(suggestions.studentNumber, '12345678');
  assert.deepEqual(suggestions.studentNumberCandidates, ['12345678']);
});

test('student extraction uses a readable external email name when Gmail has no display name', () => {
  const thread = baseThread('Please print the attached model.');
  thread.mainContactEmail = 'ada.lovelace@example.com';
  thread.messages[0].senderEmail = 'ada.lovelace@example.com';
  thread.messages[0].senderName = '';
  thread.messages[0].subject = 'Print request';
  const suggestions = extractProjectSuggestions(thread, []);
  assert.equal(suggestions.studentName, 'Ada Lovelace');
});

test('module extraction accepts spaced or combined codes without requiring a saved module', () => {
  assert.equal(findModuleCode(['Please print this for EMK310.']), 'EMK 310');
  assert.equal(findModuleCode(['Module: mtr 420']), 'MTR 420');
  assert.equal(findModuleCode(['Unknown ABC123']), 'ABC 123');
  assert.equal(findModuleCode(['Module: MRN 422']), 'MRN 422');
  assert.equal(findModuleCode(['Module: MRN422']), 'MRN 422');
  assert.equal(findModuleCode(['EMK310 and MTR 420']), '');
});

test('front-end module codes normalize to three letters, one space, and three numbers', () => {
  assert.equal(normalizeModuleCode('MRN422'), 'MRN 422');
  assert.equal(normalizeModuleCode('MRN 422'), 'MRN 422');
  assert.equal(normalizeModuleCode('mrn422'), 'MRN 422');
  assert.equal(isValidModuleCode('MRN 422'), true);
  assert.equal(isValidModuleCode('MR 422'), false);
  assert.equal(isValidModuleCode('MRN 42'), false);
  assert.equal(isValidModuleCode('422 MRN'), false);
  assert.equal(isValidModuleCode('MRN-422'), false);
});

test('Gmail suggestions include a saved module found anywhere in the thread', () => {
  const thread = baseThread('Please print this for emk 310.');
  assert.equal(extractProjectSuggestions(thread, []).moduleCode, 'EMK 310');
});

test('Gmail suggestions retain an unsaved module code for manual lecturer entry', () => {
  const spaced = baseThread('Module: MRN 422');
  assert.equal(extractProjectSuggestions(spaced, [], []).moduleCode, 'MRN 422');

  const combined = baseThread('Module: MRN422');
  assert.equal(extractProjectSuggestions(combined, [], []).moduleCode, 'MRN 422');
});

test('name falls back from sender display name to an existing project record', () => {
  const projects = [{ studentName: 'Existing Student', studentNumber: '12345678', email: 'student@example.com' }] as Project[];
  const withDisplay = extractProjectSuggestions(baseThread('Please print this.'), projects);
  assert.equal(withDisplay.studentName, 'Student Display Name');
  const withoutDisplayThread = baseThread('Please print this.');
  withoutDisplayThread.messages[0].senderName = '';
  const fromRecord = extractProjectSuggestions(withoutDisplayThread, projects);
  assert.equal(fromRecord.studentName, 'Existing Student');
});

test('Gmail directions and supported attachment extensions are case-insensitive', () => {
  assert.equal(getGmailMessageDirection('printing@example.com', 'PRINTING@example.com'), 'outgoing');
  assert.equal(getGmailMessageDirection('printing-alias@example.com', 'printing@example.com', true), 'outgoing');
  assert.equal(getGmailMessageDirection('student@example.com', 'printing@example.com'), 'incoming');
  assert.equal(isSupportedGmailAttachment('part.STL'), true);
  assert.equal(isSupportedGmailAttachment('assembly.3Mf'), true);
  assert.equal(isSupportedGmailAttachment('source-files.ZIP'), true);
  assert.equal(isSupportedGmailAttachment('drawing.step'), false);
  assert.equal(isSupportedGmailAttachment('notes.pdf'), false);
});

test('downloaded Gmail attachments are available again when missing from the current workstation', () => {
  const attachment = {
    messageId: 'message-1',
    attachmentId: 'attachment-1',
    partId: '1',
    filename: 'part.STL',
    mimeType: 'application/octet-stream',
    size: 4,
    downloadStatus: 'downloaded' as const,
    savedFilename: 'part (2).STL'
  };
  const savedFile = { relativePath: 'part (2).STL' } as LocalProjectFile;

  assert.equal(isGmailAttachmentSavedLocally(attachment, [savedFile]), true);
  assert.equal(isGmailAttachmentSavedLocally(attachment, []), false);
  assert.equal(isGmailAttachmentDownloadEligible(attachment), false);
  assert.equal(isGmailAttachmentDownloadEligible(attachment, true), true);
});

test('Gmail reply cache removes quoted thread history before it is persisted', () => {
  const body = `Good day,\n\nI will send the updated files tomorrow.\n\nOn Wed, 15 Jul 2026 at 15:16, Mining Industry Study Centre <upstudycentre@gmail.com> wrote:\n> Good day Hope,\n> Please indicate how you would like to proceed.`;
  assert.equal(stripQuotedReplyContent(body), 'Good day,\n\nI will send the updated files tomorrow.');
});

test('Gmail reply cache removes standard signature blocks before it is persisted', () => {
  const body = `I would like to obtain the 3D print before 24 June and accept the quotation.\n\nKind regards,\n\nBongani Thompson\nBEng Electronic Engineering Student\nCell: +27 71 823 4498\n\n-- \nThis message and attachments are subject to a disclaimer.`;
  assert.equal(stripQuotedReplyContent(body), 'I would like to obtain the 3D print before 24 June and accept the quotation.');
});

test('Gmail reply cache preserves ambiguous thanks and unseparated closing text', () => {
  assert.equal(
    stripQuotedReplyContent('Thanks,\n\nPlease also print two copies.'),
    'Thanks,\n\nPlease also print two copies.'
  );
  assert.equal(
    stripQuotedReplyContent('Please print two copies.\nKind regards,\nPlease let me know if that is possible.'),
    'Please print two copies.\nKind regards,\nPlease let me know if that is possible.'
  );
});
