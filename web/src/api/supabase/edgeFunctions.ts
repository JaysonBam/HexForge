export type GmailConnectionPayload = {
  connected?: boolean;
  account_email?: string | null;
  scopes?: string[];
  authorization_url?: string;
  error?: string;
  error_description?: string;
};

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

const authenticatedFunctionFetch = async (
  functionName: string,
  init: RequestInit = {}
) => {
  const { data, error } = await getAuthSession();
  if (error || !data.session?.access_token) {
    throw new Error('An active HexForge session is required.');
  }

  return fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${data.session.access_token}`,
      apikey: supabaseAnonKey,
      'Content-Type': 'application/json'
    }
  });
};

export const beginGmailConnection = async (returnPath: string) => {
  const response = await authenticatedFunctionFetch('gmail-connection', {
    method: 'POST',
    body: JSON.stringify({ return_path: returnPath })
  });
  const payload = await response.json().catch(() => ({})) as GmailConnectionPayload;
  return { response, payload };
};

export const getGmailConnection = async () => {
  const response = await authenticatedFunctionFetch('gmail-connection');
  const payload = await response.json().catch(() => ({})) as GmailConnectionPayload;
  return { response, payload };
};

export const disconnectGmailConnection = () =>
  authenticatedFunctionFetch('gmail-connection', { method: 'DELETE' });

export const invokeGmailProxy = (path: string, init: RequestInit = {}) =>
  authenticatedFunctionFetch(`gmail-proxy?path=${encodeURIComponent(path)}`, init);
import { getAuthSession } from './auth';
