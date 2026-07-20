import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import type { Project } from '../types';
import { canUseProjectGmailThread, GMAIL_THREAD_ACCOUNT_MISMATCH } from './gmailThreadOwnership';

export { GMAIL_THREAD_ACCOUNT_MISMATCH } from './gmailThreadOwnership';

export const assertProjectGmailThreadAccess = async (
  project: Pick<Project, 'gmailThreadId' | 'gmailAccountEmail'>
) => {
  const { data, error } = await supabase.auth.getSession();
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
    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setAccountEmail(data.session?.user.email || null);
      setResolved(true);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
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
