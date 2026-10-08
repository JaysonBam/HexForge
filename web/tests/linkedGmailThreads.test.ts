import assert from 'node:assert/strict';
import test from 'node:test';
import type { GmailThreadListItem } from '@/api/google/gmail/types.ts';
import { buildLinkedGmailThreadKeys, gmailThreadNeedsAction, visibleGmailThreads } from '@/features/gmail/linkedGmailThreads.ts';

const item = (threadId: string, accountEmail = 'printing@example.com'): GmailThreadListItem => ({
  threadId, messageId: `message-${threadId}`, senderName: 'Student', senderEmail: 'student@example.com',
  subject: 'Print request', messageDate: '2026-10-08T08:00:00Z', preview: 'Please print this.',
  attachmentFilenames: ['model.stl'],
  snapshot: { id: threadId, accountEmail, subject: 'Print request', mainContactEmail: 'student@example.com',
    messages: [], syncedAt: '2026-10-08T08:00:00Z' }
});

test('default filter hides linked threads while retaining newest-first order and cached snapshots', () => {
  const items = [item('newest'), item('linked'), item('older')];
  const keys = buildLinkedGmailThreadKeys([{ gmailThreadId: 'linked', gmailAccountEmail: 'Printing@Example.com' }]);
  const visible = visibleGmailThreads(items, keys);
  assert.deepEqual(visible.map(row => row.threadId), ['newest', 'older']);
  assert.equal(visible[0], items[0]);
  assert.equal(visible[1].snapshot, items[2].snapshot);
  assert.equal(visibleGmailThreads(items, keys, false), items);
  assert.equal(items.length, 3);
});

test('link identity is scoped to the Gmail account and ignores incomplete/unlinked records', () => {
  const items = [item('shared'), item('shared', 'manager@example.com'), item('unlinked')];
  const keys = buildLinkedGmailThreadKeys([
    { gmailThreadId: 'shared', gmailAccountEmail: ' printing@EXAMPLE.com ' },
    { gmailThreadId: 'shared', gmailAccountEmail: 'printing@example.com' },
    { gmailThreadId: 'unlinked', gmailAccountEmail: null },
    { gmailThreadId: null, gmailAccountEmail: 'printing@example.com' }
  ]);
  assert.equal(keys.size, 1);
  assert.deepEqual(visibleGmailThreads(items, keys), items.slice(1));
});

test('unknown link status cannot flash linked threads as missed; show-all still works', () => {
  const items = [item('linked')];
  assert.deepEqual(visibleGmailThreads(items, null), []);
  assert.equal(visibleGmailThreads(items, null, false), items);
  assert.deepEqual(visibleGmailThreads(items, new Set()), items);
});

test('filter works within the original fifty threads and never drops data when switched off', () => {
  const items = Array.from({ length: 50 }, (_, index) => item(`thread-${50 - index}`));
  const keys = buildLinkedGmailThreadKeys(items.map(row => ({
    gmailThreadId: row.threadId, gmailAccountEmail: row.snapshot.accountEmail
  })));
  assert.deepEqual(visibleGmailThreads(items, keys), []);
  assert.equal(visibleGmailThreads(items, keys, false), items);
  assert.equal(items[0].threadId, 'thread-50');
});

test('linked and hidden filters are independent, and linked status wins over a stale hide entry', () => {
  const items = [item('linked'), item('hidden'), item('missed')];
  const keys = (ids: string[]) => buildLinkedGmailThreadKeys(ids.map(gmailThreadId => ({ gmailThreadId, gmailAccountEmail: 'printing@example.com' })));
  const linked = keys(['linked']);
  const hidden = keys(['hidden', 'linked']);
  assert.deepEqual(visibleGmailThreads(items, linked, true, hidden, true), [items[2]]);
  assert.deepEqual(visibleGmailThreads(items, linked, false, hidden, true), [items[0], items[2]]);
  assert.deepEqual(visibleGmailThreads(items, linked, true, hidden, false), [items[1], items[2]]);
  assert.equal(visibleGmailThreads(items, linked, false, hidden, false), items);
});

test('hidden filtering waits for fresh membership; turning both filters off always shows cached rows', () => {
  const items = [item('hidden')];
  assert.deepEqual(visibleGmailThreads(items, new Set(), true, null, true), []);
  assert.deepEqual(visibleGmailThreads(items, null, false, new Set(), true), []);
  assert.equal(visibleGmailThreads(items, null, false, null, false), items);
});

test('linked unread mail needs action; hidden mail stays excluded and import filters are unchanged', () => {
  assert.equal(gmailThreadNeedsAction(true, false, true), true);
  assert.equal(gmailThreadNeedsAction(true, true, true), true);
  assert.equal(gmailThreadNeedsAction(true, false, false), false);
  assert.equal(gmailThreadNeedsAction(false, false, false), true);
  assert.equal(gmailThreadNeedsAction(false, true, true), false);
  const linkedUnread = item('linked');
  linkedUnread.snapshot.hasUnread = true;
  const linked = buildLinkedGmailThreadKeys([{ gmailThreadId: 'linked', gmailAccountEmail: 'printing@example.com' }]);
  assert.deepEqual(visibleGmailThreads([linkedUnread], linked), []);
});
