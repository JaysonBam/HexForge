-- Collect every requested part as one transaction so a failed batch never leaves
-- the collection desk with a partially-updated project.
alter table public.parts
add column if not exists "collectedByStudentNumber" text;

create or replace function public.collect_project_parts(
  p_project_id text,
  p_part_ids uuid[],
  p_technician_name text,
  p_collected_by_student_number text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project public.projects%rowtype;
  v_part public.parts%rowtype;
  v_part_ids uuid[];
  v_technician_name text;
  v_student_number text;
  v_requested_count integer := 0;
  v_total_parts integer := 0;
  v_collected_parts integer := 0;
  v_collection_ready_parts integer := 0;
  v_project_to_state public.project_state;
  v_project_from_state public.project_state;
  v_uncollectable_parts text[];
begin
  v_technician_name := nullif(trim(coalesce(p_technician_name, '')), '');
  v_student_number := nullif(trim(coalesce(p_collected_by_student_number, '')), '');

  if v_technician_name is null then
    return jsonb_build_object('ok', false, 'errors', jsonb_build_array('Technician name is required.'));
  end if;

  if v_student_number is null or v_student_number !~ '^\d{8}$' then
    return jsonb_build_object('ok', false, 'errors', jsonb_build_array('Enter the eight-digit student number of the person collecting.'));
  end if;

  if coalesce(cardinality(p_part_ids), 0) = 0 then
    return jsonb_build_object('ok', false, 'errors', jsonb_build_array('Select at least one part to collect.'));
  end if;

  select array_agg(distinct part_id order by part_id)
  into v_part_ids
  from unnest(p_part_ids) as requested(part_id);

  if cardinality(v_part_ids) <> cardinality(p_part_ids) then
    return jsonb_build_object('ok', false, 'errors', jsonb_build_array('A part was selected more than once.'));
  end if;

  select *
  into v_project
  from public.projects
  where id = upper(trim(p_project_id))
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'errors', jsonb_build_array('Project not found.'));
  end if;

  if coalesce(v_project."needsPayment", true) = true
     and nullif(trim(coalesce(v_project."receiptNumber", '')), '') is null then
    return jsonb_build_object('ok', false, 'errors', jsonb_build_array('Receipt number is required before collection when payment is required.'));
  end if;

  select count(*)::integer
  into v_requested_count
  from public.parts
  where "projectId" = v_project.id
    and id = any(v_part_ids);

  if v_requested_count <> cardinality(v_part_ids) then
    return jsonb_build_object('ok', false, 'errors', jsonb_build_array('One or more selected parts do not belong to this project.'));
  end if;

  perform 1
  from public.parts
  where "projectId" = v_project.id
    and id = any(v_part_ids)
  order by id
  for update;

  select array_agg(format('Part %s is %s.', "partNumber", "printStatus") order by "partNumber")
  into v_uncollectable_parts
  from public.parts
  where "projectId" = v_project.id
    and id = any(v_part_ids)
    and "printStatus" not in ('PRINTED', 'POST_PROCESSING');

  if coalesce(cardinality(v_uncollectable_parts), 0) > 0 then
    return jsonb_build_object('ok', false, 'errors', to_jsonb(v_uncollectable_parts));
  end if;

  perform set_config('app.transition_rpc', 'on', true);

  for v_part in
    select *
    from public.parts
    where "projectId" = v_project.id
      and id = any(v_part_ids)
    order by "partNumber", id
  loop
    update public.parts
    set
      "printStatus" = 'COLLECTED',
      "collectedBy" = v_technician_name,
      "collectedByStudentNumber" = v_student_number
    where id = v_part.id;

    perform public.append_audit_event(
      p_action_type => 'COLLECT_PART',
      p_technician_name => v_technician_name,
      p_project_id => v_project.id,
      p_part_id => v_part.id,
      p_from_project_state => null,
      p_to_project_state => null,
      p_from_part_status => v_part."printStatus",
      p_to_part_status => 'COLLECTED',
      p_reason => null,
      p_override_note => null,
      p_payload => jsonb_build_object('collected_by_student_number', v_student_number)
    );
  end loop;

  select
    count(*)::integer,
    count(*) filter (where "printStatus" = 'COLLECTED')::integer,
    count(*) filter (where "printStatus" in ('PRINTED', 'POST_PROCESSING', 'COLLECTED'))::integer
  into v_total_parts, v_collected_parts, v_collection_ready_parts
  from public.parts
  where "projectId" = v_project.id;

  v_project_to_state := v_project.state;
  if v_total_parts > 0 and v_collected_parts = v_total_parts then
    v_project_to_state := 'CLOSED';
  elsif v_collected_parts > 0 and v_collected_parts < v_total_parts then
    v_project_to_state := 'PARTIALLY_COLLECTED';
  elsif v_project.state = 'READY_FOR_COLLECTION' and v_collection_ready_parts < v_total_parts then
    v_project_to_state := 'IN_PRODUCTION';
  end if;

  if v_project_to_state is distinct from v_project.state then
    v_project_from_state := v_project.state;
    update public.projects
    set state = v_project_to_state
    where id = v_project.id
    returning * into v_project;

    perform public.append_audit_event(
      p_action_type => 'AUTO_PROJECT_STATE_FROM_PART_STATUS',
      p_technician_name => v_technician_name,
      p_project_id => v_project.id,
      p_part_id => null,
      p_from_project_state => v_project_from_state,
      p_to_project_state => v_project_to_state,
      p_from_part_status => null,
      p_to_part_status => null,
      p_reason => null,
      p_override_note => null,
      p_payload => jsonb_build_object('collected_part_ids', v_part_ids)
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'part_ids', to_jsonb(v_part_ids),
    'project_id', v_project.id,
    'project_state', v_project.state,
    'warnings', '[]'::jsonb
  );
end;
$$;

revoke all on function public.collect_project_parts(text, uuid[], text, text) from public;
grant execute on function public.collect_project_parts(text, uuid[], text, text) to authenticated, service_role;
