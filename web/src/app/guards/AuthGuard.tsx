import { useEffect, useState, type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { subscribeToAuthChanges } from '@/api/supabase/auth';
import { clearGoogleProviderTokens } from '@/api/google/gmail/client';
import { resetGmailInbox } from '@/features/gmail/gmailInboxStore';
import { clearReadSnapshots } from '@/lib/persistentReads';

export function AuthGuard({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);

  useEffect(() => {
    clearGoogleProviderTokens();
    const subscription = subscribeToAuthChanges((_event, session) => {
      setAuthenticated(Boolean(session));
      setLoading(false);
      if (!session) {
        resetGmailInbox();
        clearGoogleProviderTokens();
        void clearReadSnapshots();
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  if (loading) return null;

  if (!authenticated) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}
