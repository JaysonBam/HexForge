-- Run against an isolated migrated database as its owner. All fixtures roll back.
begin;
set local plpgsql.check_asserts = on;

insert into public.projects (
  id, "studentName", "studentNumber", "createdAt", "priorityNumber",
  state, archived, "needsPayment", "receiptNumber"
) values
  ('REPRINT-CLOSED', 'Test student', '12345678', '2026-10-01', 12, 'CLOSED', true, true, 'ORIGINAL-RECEIPT'),
  ('REPRINT-READY', 'Test student', '12345678', '2026-10-01', 13, 'READY_FOR_COLLECTION', false, true, null),
  ('REPRINT-CANCELLED', 'Test student', '12345678', '2026-10-01', 14, 'CANCELLED', false, false, null);

insert into public.parts (
  id, "projectId", "partName", "printStatus", "checkedBy", "printerName",
  "startedBy", "removedBy", "collectedBy", "collectedByStudentNumber", "collectedAt"
) values
  ('00000000-0000-4000-8000-000000000001', 'REPRINT-CLOSED', 'Returned part', 'COLLECTED', 'Reviewer', 'Printer A', 'Printing staff', 'Printing staff', 'Collection staff', '12345678', '2026-10-01 10:00:00+00'),
  ('00000000-0000-4000-8000-000000000002', 'REPRINT-CLOSED', 'Kept part', 'COLLECTED', 'Reviewer', 'Printer A', 'Printing staff', 'Printing staff', 'Collection staff', '12345678', '2026-10-01 10:00:00+00'),
  ('00000000-0000-4000-8000-000000000003', 'REPRINT-READY', 'Uncollected part', 'PRINTED', 'Reviewer', 'Printer A', 'Printing staff', 'Printing staff', null, null, null),
  ('00000000-0000-4000-8000-000000000004', 'REPRINT-CANCELLED', 'Cancelled part', 'COLLECTED', 'Reviewer', null, null, null, 'Collection staff', null, '2026-10-01 10:00:00+00');

insert into public.print_runs (
  part_id, project_id, machine_name, started_by, ended_by, started_at, finished_at, outcome
) values (
  '00000000-0000-4000-8000-000000000001', 'REPRINT-CLOSED', 'Printer A',
  'Printing staff', 'Printing staff', '2026-10-01 08:00:00+00', '2026-10-01 09:00:00+00', 'PRINTED'
);

insert into public.project_cost_snapshots (
  project_id, snapshot_version, status, total_cost, line_summary, generated_by_technician
) values ('REPRINT-CLOSED', 1, 'ISSUED', 70, '[]', 'Quote staff');

do $$
declare
  result jsonb;
  returned public.parts%rowtype;
  kept_before jsonb;
  run_before jsonb;
  quote_before jsonb;
  audit_count bigint;
  part_before jsonb;
  status public.part_status;
begin
  select to_jsonb(p) into kept_before from public.parts p where id = '00000000-0000-4000-8000-000000000002';
  select to_jsonb(r) into run_before from public.print_runs r where part_id = '00000000-0000-4000-8000-000000000001';
  select to_jsonb(q) into quote_before from public.project_cost_snapshots q where project_id = 'REPRINT-CLOSED';

  -- Staff identity and project/part membership are enforced before any writes.
  result := public.transition_part_status('REPRINT-CLOSED', '00000000-0000-4000-8000-000000000001', 'RETURN_FOR_REPRINT', ' ');
  assert not (result->>'ok')::boolean, 'Return requires a staff name';
  result := public.transition_part_status('REPRINT-CLOSED', '00000000-0000-4000-8000-000000000003', 'RETURN_FOR_REPRINT', 'Returns staff');
  assert not (result->>'ok')::boolean, 'A part from another project must be rejected';
  assert (select count(*) = 0 from public.audit_events where project_id = 'REPRINT-CLOSED'), 'Rejected returns must not append audit events';

  result := public.transition_part_status('REPRINT-CLOSED', '00000000-0000-4000-8000-000000000001', 'RETURN_FOR_REPRINT', 'Returns staff', null, 'Returned for reprint.');
  assert (result->>'ok')::boolean, 'Collected part return succeeds';
  assert result->>'project_state' = 'IN_PRODUCTION', 'Other collected parts must not leave the reprint in collection';
  select * into returned from public.parts where id = '00000000-0000-4000-8000-000000000001';
  assert returned."printStatus" = 'READY', 'Returned part is ready to print';
  assert returned."collectedBy" is null and returned."collectedAt" is null and returned."collectedByStudentNumber" is null, 'Current collection details are cleared';
  assert returned."printerName" is null and returned."startedBy" is null and returned."removedBy" is null, 'Previous printer assignment is cleared';
  assert returned."checkedBy" = 'Reviewer', 'Verification is retained';
  assert (select not archived and "receiptNumber" = 'ORIGINAL-RECEIPT' and "priorityNumber" = 12 from public.projects where id = 'REPRINT-CLOSED'), 'Project reopens without resetting payment or queue priority';
  assert (select to_jsonb(p) = kept_before from public.parts p where id = '00000000-0000-4000-8000-000000000002'), 'Other collected parts stay unchanged';
  assert (select to_jsonb(r) = run_before from public.print_runs r where part_id = returned.id), 'Completed attempt remains unchanged';
  assert (select to_jsonb(q) = quote_before from public.project_cost_snapshots q where project_id = 'REPRINT-CLOSED'), 'Issued quote remains unchanged';
  assert exists (select 1 from public.global_queue_parts where part_id = returned.id and part_status = 'READY'), 'Return appears in the regular queue';
  assert exists (
    select 1 from public.audit_events where action_type = 'RETURN_FOR_REPRINT' and part_id = returned.id
      and from_part_status = 'COLLECTED' and to_part_status = 'READY'
      and technician_name = 'Returns staff' and reason = 'Returned for reprint.'
      and payload->'previous_collection'->>'collected_by' = 'Collection staff'
      and payload->'previous_collection'->>'collected_by_student_number' = '12345678'
      and (payload->'previous_collection'->>'collected_at')::timestamptz = '2026-10-01 10:00:00+00'
  ), 'Return audit retains the original collection';

  -- Duplicate or stale clicks must not reset a queued/active part or its history.
  select count(*) into audit_count from public.audit_events;
  result := public.transition_part_status('REPRINT-CLOSED', returned.id, 'RETURN_FOR_REPRINT', 'Returns staff');
  assert not (result->>'ok')::boolean, 'Duplicate return is rejected';
  assert (select count(*) = audit_count from public.audit_events), 'Duplicate return has no side effects';

  -- A returned part follows normal printing, failure/retry, finish and release.
  result := public.transition_part_status('REPRINT-CLOSED', returned.id, 'START_PRINT', 'Printing staff', 'Printer B');
  assert (result->>'ok')::boolean and result->>'project_state' = 'IN_PRODUCTION', 'Reprint starts without falling back to partially collected';
  assert (select count(*) = 2 from public.print_runs where part_id = returned.id), 'Starting a reprint adds a new attempt';
  result := public.transition_part_status('REPRINT-CLOSED', returned.id, 'FAIL_PRINT', 'Printing staff', null, 'Test failure');
  assert (result->>'ok')::boolean and result->>'project_state' = 'IN_PRODUCTION', 'Failed reprint stays in production';
  result := public.transition_part_status('REPRINT-CLOSED', returned.id, 'REQUEUE_PART', 'Printing staff');
  assert (result->>'ok')::boolean and result->>'project_state' = 'IN_PRODUCTION', 'Reprint retry stays in production';
  result := public.transition_part_status('REPRINT-CLOSED', returned.id, 'START_PRINT', 'Printing staff', 'Printer C');
  assert (result->>'ok')::boolean, 'Retry starts normally';
  result := public.transition_part_status('REPRINT-CLOSED', returned.id, 'FINISH_PRINT', 'Printing staff');
  assert (result->>'ok')::boolean and result->>'project_state' = 'IN_PRODUCTION', 'Finished reprint waits for explicit collection release';
  assert (select count(*) = 3 from public.print_runs where part_id = returned.id), 'Original, failed reprint and successful retry remain in history';
  result := public.transition_project_state('REPRINT-CLOSED', 'MARK_READY_FOR_COLLECTION', 'Printing staff');
  assert (result->>'ok')::boolean and result->>'to_state' = 'PARTIALLY_COLLECTED', 'Explicit release restores partial collection';
  result := public.transition_part_status('REPRINT-CLOSED', returned.id, 'COLLECT_PART', 'Collection staff');
  assert (result->>'ok')::boolean and result->>'project_state' = 'CLOSED', 'Collecting the reprint closes the project again';
  assert (select "collectedAt" > '2026-10-01 10:00:00+00' from public.parts where id = returned.id), 'New collection has a fresh timestamp';
  assert (select to_jsonb(p) = kept_before from public.parts p where id = '00000000-0000-4000-8000-000000000002'), 'Kept part stays unchanged through the entire cycle';

  -- Returns work before collection too, without bypassing the collection payment gate.
  result := public.transition_part_status('REPRINT-READY', '00000000-0000-4000-8000-000000000003', 'RETURN_FOR_REPRINT', 'Returns staff');
  assert (result->>'ok')::boolean, 'Uncollected printed part can be returned without a receipt';
  perform set_config('app.transition_rpc', 'on', true);
  update public.parts set "printStatus" = 'POST_PROCESSING' where id = '00000000-0000-4000-8000-000000000003';
  result := public.transition_part_status('REPRINT-READY', '00000000-0000-4000-8000-000000000003', 'RETURN_FOR_REPRINT', 'Returns staff');
  assert (result->>'ok')::boolean, 'Post-processing part can be returned';
  result := public.transition_part_status('REPRINT-READY', '00000000-0000-4000-8000-000000000003', 'START_PRINT', 'Printing staff', 'Printer B');
  assert (result->>'ok')::boolean, 'Uncollected reprint starts';
  result := public.transition_part_status('REPRINT-READY', '00000000-0000-4000-8000-000000000003', 'FINISH_PRINT', 'Printing staff');
  assert (result->>'ok')::boolean, 'Uncollected reprint finishes';
  result := public.transition_part_status('REPRINT-READY', '00000000-0000-4000-8000-000000000003', 'COLLECT_PART', 'Collection staff');
  assert not (result->>'ok')::boolean, 'Reprint does not bypass the receipt requirement';

  -- Non-finished statuses and cancelled projects are rejected without changing data.
  foreach status in array array['DRAFT', 'VERIFIED', 'READY', 'PRINTING', 'FAILED']::public.part_status[] loop
    perform set_config('app.transition_rpc', 'on', true);
    update public.parts set "printStatus" = status where id = '00000000-0000-4000-8000-000000000003';
    select to_jsonb(p) into part_before from public.parts p where id = '00000000-0000-4000-8000-000000000003';
    select count(*) into audit_count from public.audit_events;
    result := public.transition_part_status('REPRINT-READY', '00000000-0000-4000-8000-000000000003', 'RETURN_FOR_REPRINT', 'Returns staff');
    assert not (result->>'ok')::boolean, 'Non-finished part cannot be returned';
    assert (select to_jsonb(p) = part_before from public.parts p where id = '00000000-0000-4000-8000-000000000003'), 'Rejected return leaves part unchanged';
    assert (select count(*) = audit_count from public.audit_events), 'Rejected return leaves audit unchanged';
  end loop;
  result := public.transition_part_status('REPRINT-CANCELLED', '00000000-0000-4000-8000-000000000004', 'RETURN_FOR_REPRINT', 'Returns staff');
  assert not (result->>'ok')::boolean, 'Cancelled project cannot be returned';
  assert (select state = 'CANCELLED' from public.projects where id = 'REPRINT-CANCELLED'), 'Cancelled project stays cancelled';

  assert not has_function_privilege('anon', 'public.transition_part_status(text,uuid,text,text,text,text)', 'EXECUTE'), 'Anonymous workflow access stays denied';
  assert has_function_privilege('authenticated', 'public.transition_part_status(text,uuid,text,text,text,text)', 'EXECUTE'), 'Staff workflow access is retained';
  assert has_function_privilege('service_role', 'public.transition_part_status(text,uuid,text,text,text,text)', 'EXECUTE'), 'Service workflow access is retained';
end;
$$;

rollback;
