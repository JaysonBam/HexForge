import { getAuthSession } from '@/api/supabase/auth';
import { GmailAuthError } from '@/api/google/gmail/client';
import { gmailCalendarYear } from '@/api/google/gmail/search';
import { invalidateRecentGmailThreads, listRecent3dPrintThreads } from '@/api/google/gmail/threads';
import type { GmailThreadListItem } from '@/api/google/gmail/types';
import { getHiddenGmailThreads, getLinkedProjectGmailThreads, type LinkedProjectGmailThread } from '@/api/supabase/gmailRecords';
import { onGmailInboxChange } from '@/lib/gmailInboxEvents';
import { buildLinkedGmailThreadKeys, gmailThreadKey, gmailThreadNeedsAction } from './linkedGmailThreads';

export const gmailInboxRefreshIntervalMs = 10 * 60 * 1000;
export type GmailInboxState = {
  year: number;
  checkId: number;
  status: 'loading' | 'ready' | 'auth' | 'error';
  isRefreshing: boolean;
  complete: boolean;
  detailsVerified: boolean;
  verified: boolean;
  checkedAt: string | null;
  error: string | null;
  items: GmailThreadListItem[];
  threadIds: string[];
  accountEmail: string;
  linked: LinkedProjectGmailThread[];
  hiddenKeys: Set<string>;
};
let nextCheckId = 0;
const emptyState = (): GmailInboxState => ({
  year: gmailCalendarYear(), checkId: nextCheckId, status: 'loading', isRefreshing: false, complete: false, detailsVerified: false,
  verified: false, checkedAt: null, error: null, items: [], threadIds: [],
  accountEmail: '', linked: [], hiddenKeys: new Set()
});
let state = emptyState();
let ownerKey = '';
let generation = 0;
let mutationVersion = 0;
let pending: Promise<void> | null = null;
const listeners = new Set<() => void>();
const publish = (updates: Partial<GmailInboxState>) => {
  state = { ...state, ...updates };
  listeners.forEach(listener => listener());
};
export const getGmailInboxState = () => state;
export const subscribeGmailInbox = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
export const resetGmailInbox = () => {
  generation++;
  invalidateRecentGmailThreads();
  ownerKey = '';
  pending = null;
  state = emptyState();
  listeners.forEach(listener => listener());
};
export const gmailInboxActionCount = (inbox: GmailInboxState) => {
  const linked = buildLinkedGmailThreadKeys(inbox.linked);
  const freshItems = new Map((inbox.detailsVerified ? inbox.items : [])
    .map(item => [gmailThreadKey(item.snapshot.accountEmail, item.threadId), item]));
  let count = 0;
  for (const id of inbox.threadIds) {
    const key = gmailThreadKey(inbox.accountEmail, id);
    const isLinked = linked.has(key);
    const hasUnread = freshItems.get(key)?.snapshot.hasUnread;
    // Keep checking until linked unread status is verified, rather than undercounting.
    if (isLinked && typeof hasUnread !== 'boolean') return null;
    if (gmailThreadNeedsAction(isLinked, inbox.hiddenKeys.has(key), hasUnread === true)) count++;
  }
  return count;
};

// Successful local writes update the same list immediately; failed writes never do.
onGmailInboxChange(change => {
  mutationVersion++;
  if (!state.accountEmail || state.year !== gmailCalendarYear()) return;
  const hiddenKeys = new Set(state.hiddenKeys);
  if (change.type === 'hidden') {
    if (change.accountEmail.trim().toLowerCase() !== state.accountEmail) return;
    const key = gmailThreadKey(change.accountEmail, change.threadId);
    if (change.hidden) hiddenKeys.add(key); else hiddenKeys.delete(key);
    publish({ hiddenKeys });
    return;
  }
  const previous = state.linked.find(link => link.id === change.projectId);
  const threadId = change.deleted ? null : change.threadId === undefined ? previous?.gmailThreadId : change.threadId;
  const accountEmail = change.accountEmail === undefined ? previous?.gmailAccountEmail : change.accountEmail;
  const linked = state.linked.filter(link => link.id !== change.projectId);
  if (threadId && accountEmail && state.threadIds.includes(threadId)
    && accountEmail.trim().toLowerCase() === state.accountEmail) {
    linked.push({ id: change.projectId, gmailThreadId: threadId, gmailAccountEmail: accountEmail,
      priorityNumber: change.priorityNumber ?? previous?.priorityNumber });
    hiddenKeys.delete(gmailThreadKey(accountEmail, threadId));
  }
  publish({ linked, hiddenKeys });
});

// Dashboard, import and the timer all join this one request. No separate unread cache.
export const refreshGmailInbox = async (onlyIfStale = false): Promise<void> => {
  const { data } = await getAuthSession();
  const user = data.session?.user;
  const nextOwner = user ? `${user.id}:${user.email?.trim().toLowerCase()}:${gmailCalendarYear()}` : '';
  if (nextOwner !== ownerKey) { resetGmailInbox(); ownerKey = nextOwner; }
  if (!user) { publish({ status: 'auth', error: 'Sign in to check Gmail.' }); return; }
  if (pending) return pending;
  if (onlyIfStale && state.verified && state.status === 'ready' && state.checkedAt
    && Date.now() - new Date(state.checkedAt).getTime() < gmailInboxRefreshIntervalMs) return;
  const currentGeneration = generation;
  let active = true;
  const valid = () => active && generation === currentGeneration && state.year === gmailCalendarYear();
  publish({ checkId: ++nextCheckId, isRefreshing: true, verified: false, detailsVerified: false, complete: false, error: null });
  const run = async () => {
    let membership: { ids: string[]; accountEmail: string } | null = null;
    let metadata: [LinkedProjectGmailThread[], LinkedProjectGmailThread[]] | null = null;
    let metadataVersion = -1;
    const exposeMembership = () => {
      if (!valid() || !membership || !metadata || metadataVersion !== mutationVersion) return;
      const keys = new Set(membership.ids.map(id => gmailThreadKey(membership!.accountEmail, id)));
      publish({ verified: true, status: 'ready', threadIds: membership.ids, accountEmail: membership.accountEmail,
        linked: metadata[0].filter(link => link.gmailAccountEmail && link.gmailThreadId
          && keys.has(gmailThreadKey(link.gmailAccountEmail, link.gmailThreadId))),
        hiddenKeys: new Set([...buildLinkedGmailThreadKeys(metadata[1])].filter(key => keys.has(key))),
        checkedAt: new Date().toISOString() });
    };
    try {
      const readMetadata = async () => {
        do {
          metadataVersion = mutationVersion;
          metadata = await Promise.all([getLinkedProjectGmailThreads(), getHiddenGmailThreads()]);
        } while (valid() && metadataVersion !== mutationVersion);
        exposeMembership();
      };
      const metadataRequest = readMetadata();
      const [items] = await Promise.all([
        listRecent3dPrintThreads({
          onMembership: (ids, accountEmail) => { membership = { ids, accountEmail }; exposeMembership(); },
          onProgress: items => { if (valid()) publish({ items, detailsVerified: true }); }
        }),
        metadataRequest
      ]);
      if (valid() && metadataVersion !== mutationVersion) await readMetadata();
      if (valid()) publish({ items, detailsVerified: true, isRefreshing: false, complete: true, status: 'ready' });
    } catch (error) {
      if (valid()) publish({ status: error instanceof GmailAuthError ? 'auth' : 'error',
        error: error instanceof Error ? error.message : 'Gmail could not be checked.',
        verified: false, items: [], isRefreshing: false });
    } finally {
      active = false;
    }
  };
  pending = run();
  const request = pending;
  await request;
  if (pending === request) pending = null;
};
