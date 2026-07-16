-- Bookings-only collection release boundary. The core HexForge transitions are
-- intentionally reused unchanged so workflow and audit behavior remain canonical.
create or replace function public.release_project_to_collection_from_bookings(
  p_project_id text,
  p_technician_name text,
  p_print_label text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project public.projects%rowtype;
  v_total_parts integer := 0;
  v_completed_parts integer := 0;
  v_technician_name text;
begin
  v_technician_name := nullif(trim(coalesce(p_technician_name, '')), '');
  if v_technician_name is null then
    return jsonb_build_object('ok', false, 'errors', jsonb_build_array('Technician name is required.'));
  end if;

  select * into v_project
  from public.projects
  where id = upper(trim(p_project_id))
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'errors', jsonb_build_array('Project not found.'));
  end if;

  if v_project.state <> 'IN_PRODUCTION' then
    return jsonb_build_object('ok', false, 'errors', jsonb_build_array(format('Only in-production projects can be released from bookings (current: %s).', v_project.state)));
  end if;

  perform 1 from public.parts where "projectId" = v_project.id order by id for update;
  select
    count(*)::integer,
    count(*) filter (where "printStatus" in ('PRINTED', 'POST_PROCESSING', 'COLLECTED'))::integer
  into v_total_parts, v_completed_parts
  from public.parts
  where "projectId" = v_project.id;

  if v_total_parts = 0 then
    return jsonb_build_object('ok', false, 'errors', jsonb_build_array('Cannot release a project without parts.'));
  end if;
  if v_completed_parts <> v_total_parts then
    return jsonb_build_object('ok', false, 'errors', jsonb_build_array(format('%s of %s parts are complete. Finish every part before moving the project to the help desk.', v_completed_parts, v_total_parts)));
  end if;

  return public.transition_project_state(
    p_project_id => v_project.id,
    p_action => 'MARK_READY_FOR_COLLECTION',
    p_technician_name => v_technician_name,
    p_print_label => nullif(trim(coalesce(p_print_label, '')), '')
  );
end;
$$;

revoke all on function public.release_project_to_collection_from_bookings(text, text, text) from public;
grant execute on function public.release_project_to_collection_from_bookings(text, text, text) to service_role;
