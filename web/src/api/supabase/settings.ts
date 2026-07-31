import { supabase } from './client';

export type ConfigRow = {
  key: string;
  value: unknown;
};

export const getConfig = () => supabase
  .from('config')
  .select('key, value');

export const getConfigEntries = (keys: string[]) => supabase
  .from('config')
  .select('key, value')
  .in('key', keys);

export const saveConfigEntry = (key: string, value: unknown) => supabase
  .from('config')
  .upsert({ key, value });

export const saveConfigEntries = (entries: ConfigRow[]) => supabase
  .from('config')
  .upsert(entries);
