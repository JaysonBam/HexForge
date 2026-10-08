-- Read-only cache validation. No timestamp columns, write triggers or changes to workflow gates.
create or replace function public.read_active_project_cache(known_versions jsonb default '{}'::jsonb)
returns table(project_id text, version text, project_data jsonb)
language sql stable security invoker
set search_path = public
as $$
  with active as materialized (
    select * from public.projects
    where state not in ('CLOSED', 'CANCELLED', 'READY_FOR_COLLECTION', 'PARTIALLY_COLLECTED')
  ), part_data as (
    select p."projectId" as id, jsonb_agg(to_jsonb(p) order by p."partNumber", p.id) as rows
    from public.parts p join active a on a.id = p."projectId" group by p."projectId"
  ), quote_data as (
    select q.project_id as id, jsonb_agg(to_jsonb(q) order by q.snapshot_version) as rows
    from public.project_cost_snapshots q join active a on a.id = q.project_id group by q.project_id
  ), run_data as (
    select r.project_id as id, jsonb_agg(to_jsonb(r) order by r.started_at desc, r.id) as rows
    from public.print_runs r join active a on a.id = r.project_id group by r.project_id
  ), snapshots as materialized (
    select a.id, jsonb_build_object(
      'project', to_jsonb(a),
      'parts', coalesce(p.rows, '[]'::jsonb),
      'snapshots', coalesce(q.rows, '[]'::jsonb),
      'print_runs', coalesce(r.rows, '[]'::jsonb)
    ) as data
    from active a left join part_data p on p.id = a.id
    left join quote_data q on q.id = a.id left join run_data r on r.id = a.id
  ), versions as materialized (
    select id, data, md5(data::text) as fingerprint from snapshots
  )
  select id, fingerprint,
    case when known_versions ->> id = fingerprint then null else data end
  from versions order by id;
$$;

revoke all on function public.read_active_project_cache(jsonb) from public, anon;
grant execute on function public.read_active_project_cache(jsonb) to authenticated, service_role;
