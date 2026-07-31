import { useEffect, useState } from 'react';
import { getAuthSession, subscribeToAuthChanges } from '@/api/supabase/auth';
import type { Project } from '@/types';
import { canUseProjectGmailThread, GMAIL_THREAD_ACCOUNT_MISMATCH } from '@/features/gmail/gmailThreadOwnership';

export { GMAIL_THREAD_ACCOUNT_MISMATCH } from '@/features/gmail/gmailThreadOwnership';

export const assertProjectGmailThreadAccess = async (
  project: Pick<Project, 'gmailThreadId' | 'gmailAccountEmail'>
) => {
  const { data, error } = await getAuthSession();
  if (error) throw new Error(error.message);
  if (!canUseProjectGmailThread(project, data.session?.user.email)) {
    throw new Error(GMAIL_THREAD_ACCOUNT_MISMATCH);
  }
};

export const useProjectGmailThreadAccess = (
  project: Pick<Project, 'gmailThreadId' | 'gmailAccountEmail'>
) => {
  const [accountEmail, setAccountEmail] = useState<string | null>(null);
  const [resolved, setResolved] = useState(false);

  useEffect(() => {
    let active = true;
    void getAuthSession().then(({ data }) => {
      if (!active) return;
      setAccountEmail(data.session?.user.email || null);
      setResolved(true);
    });
    const subscription = subscribeToAuthChanges((_event, session) => {
      setAccountEmail(session?.user.email || null);
      setResolved(true);
    });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  return {
    canUseGmail: resolved && canUseProjectGmailThread(project, accountEmail),
    resolved
  };
};
