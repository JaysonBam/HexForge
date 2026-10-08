import { useEffect, useSyncExternalStore } from 'react';
import { subscribeToAuthChanges } from '@/api/supabase/auth';
import { getGmailInboxState, subscribeGmailInbox, refreshGmailInbox, resetGmailInbox, gmailInboxRefreshIntervalMs } from './gmailInboxStore';

export const useGmailInbox = () => useSyncExternalStore(subscribeGmailInbox, getGmailInboxState);

// Mounted once for the signed-in workspace, including time spent away from Home.
export const useGmailInboxRefresh = () => {
  useEffect(() => {
    void refreshGmailInbox(true);
    const check = () => { void refreshGmailInbox(true); };
    const timer = window.setInterval(() => { void refreshGmailInbox(); }, gmailInboxRefreshIntervalMs);
    window.addEventListener('focus', check);
    const subscription = subscribeToAuthChanges((event) => {
      if (event === 'SIGNED_OUT') resetGmailInbox();
      else if (event === 'SIGNED_IN' || event === 'USER_UPDATED') check();
    });
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', check);
      subscription.unsubscribe();
    };
  }, []);
};
