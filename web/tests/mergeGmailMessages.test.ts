import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeGmailMessages } from '../src/features/gmail/mergeGmailMessages.ts';
import type { GmailThreadMessage } from '../src/api/google/gmail/types.ts';

test('live email contents preserve attachment save statuses by message and MIME part', () => {
  const live = [{ id: 'new', body: 'fresh', attachments: [{ messageId: 'm', partId: '1', filename: 'fresh.stl' }, { messageId: 'different', partId: '1', filename: 'other.stl' }] }] as GmailThreadMessage[];
  const cached = [{ attachments: [{ messageId: 'm', partId: '1', downloadStatus: 'renamed', savedFilename: 'fresh (2).stl' }] }] as GmailThreadMessage[];
  const result = mergeGmailMessages(live, cached);
  assert.equal(result[0].body, 'fresh');
  assert.equal(result[0].attachments[0].downloadStatus, 'renamed');
  assert.equal(result[0].attachments[0].savedFilename, 'fresh (2).stl');
  assert.equal(result[0].attachments[1].downloadStatus, undefined);
  assert.equal(live[0].attachments[0].downloadStatus, undefined);
});
