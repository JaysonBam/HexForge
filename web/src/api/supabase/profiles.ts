import { supabase } from './client';

export type ProfileRecord = {
  id?: string | null;
  email?: string | null;
  full_name?: string | null;
  profile_url?: string | null;
  status?: string | null;
};

export const getProfileByEmail = (email: string) => supabase
  .from('profiles')
  .select('*')
  .eq('email', email)
  .maybeSingle<ProfileRecord>();

export const getProfileAvatarByEmail = (email: string) => supabase
  .from('profiles')
  .select('profile_url')
  .eq('email', email)
  .maybeSingle<{ profile_url?: string | null }>();

export const updateProfileByEmail = (email: string, updates: Partial<ProfileRecord>) => supabase
  .from('profiles')
  .update(updates)
  .eq('email', email);
