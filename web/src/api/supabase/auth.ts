import type { AuthChangeEvent, AuthError, Session } from '@supabase/supabase-js';
import { supabase } from './client';

export const getAuthSession = () => supabase.auth.getSession();

export const getAuthUser = () => supabase.auth.getUser();

export const signOut = () => supabase.auth.signOut();

export const subscribeToAuthChanges = (
  callback: (event: AuthChangeEvent, session: Session | null) => void
) => supabase.auth.onAuthStateChange(callback).data.subscription;

export const signInWithGoogleOAuth = (options: {
  redirectTo: string;
  scopes: string;
  queryParams: Record<string, string>;
}) => supabase.auth.signInWithOAuth({
  provider: 'google',
  options
});

type OAuthSessionResult = {
  data?: unknown;
  error?: AuthError | Error | null;
};

export const completeOAuthSessionFromCurrentUrl = async (): Promise<OAuthSessionResult> => {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const auth = supabase.auth as unknown as {
    exchangeCodeForSession?: (code: string) => Promise<OAuthSessionResult>;
    getSessionFromUrl?: (options: { storeSession: boolean }) => Promise<OAuthSessionResult>;
    setSession?: (tokens: { access_token: string; refresh_token: string | null }) => Promise<OAuthSessionResult>;
  };

  if (code && typeof auth.exchangeCodeForSession === 'function') {
    return auth.exchangeCodeForSession.call(supabase.auth, code);
  }

  if (typeof auth.getSessionFromUrl === 'function') {
    return auth.getSessionFromUrl.call(supabase.auth, { storeSession: true });
  }

  try {
    const hash = window.location.hash || window.location.search || '';
    const tokenParams = new URLSearchParams(hash.replace(/^#/, ''));
    const accessToken = tokenParams.get('access_token');
    const refreshToken = tokenParams.get('refresh_token');

    if (accessToken && typeof auth.setSession === 'function') {
      return auth.setSession.call(supabase.auth, {
        access_token: accessToken,
        refresh_token: refreshToken
      });
    }

    return supabase.auth.getSession();
  } catch (error) {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }
};
