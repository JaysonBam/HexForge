import { supabase } from './client';

export const getRecentProjectAuditEvents = (projectId: string) => supabase
  .from('audit_events')
  .select('id,created_at,technician_name,action_type,from_project_state,to_project_state,from_part_status,to_part_status,reason,override_note')
  .eq('project_id', projectId)
  .order('created_at', { ascending: false })
  .limit(50);
