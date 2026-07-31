import type { Part } from '@/types';
import { supabase } from './client';

export const createPartRecord = (projectId: string, part: Part) => supabase
  .from('parts')
  .insert([{ ...part, projectId }]);

export const createPartRecords = (parts: Array<Part & { projectId: string }>) => supabase
  .from('parts')
  .insert(parts);

export const updatePartRecord = (partId: string, updates: Partial<Part>) => supabase
  .from('parts')
  .update(updates)
  .eq('id', partId);

export const deletePartRecord = (partId: string) => supabase
  .from('parts')
  .delete()
  .eq('id', partId);

export const transitionPartRecord = (args: {
  projectId: string;
  partId: string;
  action: string;
  technicianName: string;
  machineName?: string;
  reason?: string;
}) => supabase.rpc('transition_part_status', {
  p_project_id: args.projectId,
  p_part_id: args.partId,
  p_action: args.action,
  p_technician_name: args.technicianName,
  p_machine_name: args.machineName ?? null,
  p_reason: args.reason ?? null
});
