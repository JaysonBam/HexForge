import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import { saveProjectAttachment } from '../helper/src/main/attachmentWriter.ts';
import {
  buildRecentPrintEmailQuery,
  buildUnreadPrintEmailQuery,
  extractProjectSuggestions,
  findSavedModuleCode,
  findStudentNumbers,
  getGmailMessageDirection,
  isSupportedGmailAttachment
} from '../src/gmail/gmailParsing.ts';
import { stripQuotedReplyContent } from '../src/gmail/gmailBody.ts';
import { getGmailThreadUrl } from '../src/gmail/gmailUrls.ts';
import { canUseProjectGmailThread, GMAIL_THREAD_ACCOUNT_MISMATCH } from '../src/gmail/gmailThreadOwnership.ts';
import type { GmailThreadSnapshot } from '../src/gmail/types.ts';
import type { Project } from '../src/types/index.ts';

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
  assert.equal(query, 'newer_than:90d is:unread "3d print"');
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

test('module extraction accepts spaced or combined codes and only returns a saved module', () => {
  const modules = [{ code: 'EMK 310' }, { code: 'MTR420' }];
  assert.equal(findSavedModuleCode(['Please print this for EMK310.'], modules), 'EMK 310');
  assert.equal(findSavedModuleCode(['Module: mtr 420'], modules), 'MTR 420');
  assert.equal(findSavedModuleCode(['Unknown ABC123'], modules), '');
  assert.equal(findSavedModuleCode(['EMK310 and MTR 420'], modules), '');
});

test('Gmail suggestions include a saved module found anywhere in the thread', () => {
  const thread = baseThread('Please print this for emk 310.');
  assert.equal(extractProjectSuggestions(thread, [], [{ code: 'EMK310' }]).moduleCode, 'EMK 310');
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

test('helper saves supported Gmail attachments, skips exact duplicates, and safely renames conflicts', async () => {
  const projectFolder = await mkdtemp(path.join(os.tmpdir(), 'hexforge-gmail-files-'));
  try {
    const firstBytes = Buffer.from('solid model');
    const first = await saveProjectAttachment({
      projectFolderPath: projectFolder,
      projectFolderName: 'P42 Test u12345678 - TBC',
      filename: 'part.STL',
      expectedSize: firstBytes.byteLength,
      stream: Readable.from(firstBytes)
    });
    assert.equal(first.status, 'saved');
    assert.equal((await readFile(path.join(projectFolder, 'part.STL'))).toString(), 'solid model');

    const duplicate = await saveProjectAttachment({
      projectFolderPath: projectFolder,
      projectFolderName: 'P42 Test u12345678 - TBC',
      filename: 'part.STL',
      expectedSize: firstBytes.byteLength,
      stream: Readable.from(firstBytes)
    });
    assert.equal(duplicate.status, 'skipped');

    const differentBytes = Buffer.from('different model bytes');
    const conflict = await saveProjectAttachment({
      projectFolderPath: projectFolder,
      projectFolderName: 'P42 Test u12345678 - TBC',
      filename: 'part.STL',
      expectedSize: differentBytes.byteLength,
      stream: Readable.from(differentBytes)
    });
    assert.equal(conflict.status, 'renamed');
    assert.equal(conflict.filename, 'part (2).STL');
    assert.equal((await readFile(path.join(projectFolder, 'part.STL'))).toString(), 'solid model');
    assert.equal((await readFile(path.join(projectFolder, 'part (2).STL'))).toString(), 'different model bytes');

    await assert.rejects(() => saveProjectAttachment({
      projectFolderPath: projectFolder,
      projectFolderName: 'P42 Test u12345678 - TBC',
      filename: 'notes.pdf',
      expectedSize: 3,
      stream: Readable.from(Buffer.from('pdf'))
    }), /UNSUPPORTED_ATTACHMENT/);
  } finally {
    await rm(projectFolder, { recursive: true, force: true });
  }
});
