import assert from 'node:assert/strict';
import test from 'node:test';
import type { GmailThreadListItem, GmailThreadMessage } from '@/api/google/gmail/types.ts';
import type { GmailInboxProject } from '@/api/supabase/gmailRecords.ts';
import { suggestedGmailProject } from '@/features/gmail/gmailProjectMatches.ts';

const message = (overrides: Partial<GmailThreadMessage> = {}): GmailThreadMessage => ({
  id: 'incoming', threadId: 'thread', senderName: 'Ada Lovelace', senderEmail: 'u12345678@tuks.co.za',
  recipientEmails: ['printing@example.com'], subject: '3D print', body: 'Please print this.',
  messageDate: '2026-10-08T21:55:00Z', direction: 'incoming', hasAttachments: false,
  messageIdHeader: '', referencesHeader: '', attachments: [], ...overrides
});
const item = (messages = [message()]): GmailThreadListItem => ({
  threadId: 'thread', messageId: messages[0].id, senderName: messages[0].senderName,
  senderEmail: messages[0].senderEmail, subject: '3D print', messageDate: messages.at(-1)!.messageDate,
  preview: '', attachmentFilenames: [], snapshot: { id: 'thread', accountEmail: 'printing@example.com',
    subject: '3D print', mainContactEmail: messages[0].senderEmail, messages, syncedAt: '2026-10-09T10:00:00Z' }
});
const project = (overrides: Partial<GmailInboxProject> = {}): GmailInboxProject => ({
  id: 'project', priorityNumber: 123, studentName: 'Ada Lovelace', studentNumber: '12345678',
  email: 'u12345678@tuks.co.za', createdAt: '2026-10-08T08:00:00Z', gmailThreadId: null,
  gmailAccountEmail: null, ...overrides
});

test('matches the student number on the preceding, same and following South African calendar day', () => {
  for (const createdAt of ['2026-10-06T22:00:00Z', '2026-10-08T21:59:00Z', '2026-10-09T21:59:00Z']) {
    const match = project({ createdAt, email: 'different@example.com', studentName: 'Different name' });
    assert.equal(suggestedGmailProject(item(), [match]), match);
  }
  for (const createdAt of ['2026-10-06T21:59:00Z', '2026-10-09T22:00:00Z', 'invalid']) {
    assert.equal(suggestedGmailProject(item(), [project({ createdAt })]), null);
  }
});

test('does not suggest repeat projects weeks apart or use a recent reply as the request date', () => {
  const thread = item([message(), message({ id: 'reply', messageDate: '2026-10-20T10:00:00Z' })]);
  assert.equal(suggestedGmailProject(thread, [project({ createdAt: '2026-10-20T08:00:00Z' })]), null);
  assert.equal(suggestedGmailProject(thread, [project()])?.id, 'project');
});

test('falls back to an exact contact email or complete name; conflicting numbers never match', () => {
  const thread = item([message({ senderEmail: 'ada@example.com' })]);
  const emailMatch = project({ email: ' ADA@EXAMPLE.com ', studentName: 'Other name' });
  assert.equal(suggestedGmailProject(thread, [emailMatch]), emailMatch);
  const nameMatch = project({ email: 'other@example.com', studentName: ' ADA   LOVELACE ' });
  assert.equal(suggestedGmailProject(thread, [nameMatch]), nameMatch);
  assert.equal(suggestedGmailProject(item(), [project({ studentNumber: '87654321' })]), null);
  assert.equal(suggestedGmailProject(item([message({ senderEmail: 'ada@example.com', senderName: 'Ada' })]),
    [project({ email: 'other@example.com', studentName: 'Ada' })]), null);
});

test('prefers a number match and suppresses ambiguous matches or multiple extracted numbers', () => {
  const exact = project();
  const nameOnly = project({ id: 'other', studentNumber: '', email: 'other@example.com' });
  assert.equal(suggestedGmailProject(item(), [nameOnly, exact]), exact);
  assert.equal(suggestedGmailProject(item(), [exact, project({ id: 'second' })]), null);
  const group = item([message({ senderEmail: 'ada@example.com', body: 'Student numbers: 12345678 and 87654321' })]);
  assert.equal(suggestedGmailProject(group, [project({ email: 'ada@example.com' })]), null);
});

test('never suggests replacing an existing thread, and sent-only requests have no suggestion', () => {
  assert.equal(suggestedGmailProject(item(), [project({ gmailThreadId: 'other-thread' })]), null);
  assert.equal(suggestedGmailProject(item([message({ senderEmail: 'printing@example.com', direction: 'outgoing' })]), [project()]), null);
});

test('a sent introduction followed by a student reply uses the first incoming date', () => {
  const thread = item([
    message({ id: 'sent', senderEmail: 'printing@example.com', direction: 'outgoing', messageDate: '2026-10-01T08:00:00Z' }),
    message()
  ]);
  assert.equal(suggestedGmailProject(thread, [project()])?.priorityNumber, 123);
});
