import type { GmailThreadListItem } from '@/api/google/gmail/types';
import type { LinkedProjectGmailThread } from '@/api/supabase/gmailRecords';

export const gmailThreadKey = (accountEmail: string, threadId: string) =>
  JSON.stringify([accountEmail.trim().toLowerCase(), threadId]);

export const buildLinkedGmailThreadKeys = (links: readonly LinkedProjectGmailThread[]) =>
  new Set(links.flatMap(link => link.gmailAccountEmail && link.gmailThreadId
    ? [gmailThreadKey(link.gmailAccountEmail, link.gmailThreadId)]
    : []));

export const gmailThreadHasIncomingMessage = (thread: GmailThreadListItem['snapshot']) =>
  thread.messages.some(message => message.direction === 'incoming' && message.senderEmail.trim()
    && message.senderEmail.trim().toLowerCase() !== thread.accountEmail.trim().toLowerCase());

export const gmailThreadNeedsAction = (linked: boolean, hidden: boolean, hasUnread: boolean, hasIncoming: boolean) =>
  hasIncoming && (linked ? hasUnread : !hidden);

export const visibleGmailThreads = (
  items: GmailThreadListItem[],
  linkedKeys: ReadonlySet<string> | null,
  hideLinked = true,
  hiddenKeys: ReadonlySet<string> | null = null,
  hideHidden = false
) => {
  if (!hideLinked && !hideHidden) return items;
  // Do not present linked threads as missed while the fresh link check is pending.
  if (!linkedKeys || (hideHidden && !hiddenKeys)) return [];
  return items.filter(item => {
    const key = gmailThreadKey(item.snapshot.accountEmail, item.threadId);
    // Linking wins if a cached hidden-list read overlaps a project update.
    if (linkedKeys.has(key)) return !hideLinked;
    return !hideHidden || !hiddenKeys?.has(key);
  });
};
