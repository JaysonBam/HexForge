type InboxChange =
  | { type: 'hidden'; accountEmail: string; threadId: string; hidden: boolean }
  | { type: 'project'; projectId: string; threadId?: string | null; accountEmail?: string | null; priorityNumber?: number; deleted?: boolean };

const listeners = new Set<(change: InboxChange) => void>();
export const notifyGmailInboxChange = (change: InboxChange) => listeners.forEach(listener => listener(change));
export const onGmailInboxChange = (listener: (change: InboxChange) => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
