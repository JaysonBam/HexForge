-- Declarative snapshot for workflow tables, views, policies, and RPCs generated from the latest migrations.

create table public.audit_events (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default timezone('utc'::text, now()),
  actor_user_id uuid,
  actor_email text,
  technician_name text not null,
  action_type text not null,
  project_id text,
  part_id uuid,
  from_project_state public.project_state,
  to_project_state public.project_state,
  from_part_status public.part_status,
  to_part_status public.part_status,
  reason text,
  override_note text,
  payload jsonb not null default '{}'::jsonb
);

alter table public.audit_events enable row level security;

create policy audit_events_select_authenticated
on public.audit_events
for select
to authenticated
using (true);

create policy audit_events_insert_authenticated
on public.audit_events
for insert
to authenticated
with check (true);

create index idx_audit_events_created_at on public.audit_events (created_at desc);
create index idx_audit_events_project_id on public.audit_events (project_id, created_at desc);
create index idx_audit_events_part_id on public.audit_events (part_id, created_at desc);

create table public.print_runs (
  id bigint generated always as identity primary key,
  part_id uuid not null references public.parts(id) on delete cascade,
  project_id text not null references public.projects(id) on delete cascade,
  machine_name text,
  machine_id text,
  started_by text not null,
  ended_by text,
  started_at timestamptz not null default timezone('utc'::text, now()),
  finished_at timestamptz,
  failed_at timestamptz,
  failure_reason text,
  outcome text check (outcome in ('PRINTED', 'FAILED'))
);

alter table public.print_runs enable row level security;

create policy print_runs_select_authenticated
on public.print_runs
for select
to authenticated
using (true);

create policy print_runs_insert_authenticated
on public.print_runs
for insert
to authenticated
with check (true);

create policy print_runs_update_authenticated
on public.print_runs
for update
to authenticated
using (true)
with check (true);

create index idx_print_runs_part_id on public.print_runs (part_id, started_at desc);
create index idx_print_runs_project_id on public.print_runs (project_id, started_at desc);
create index idx_print_runs_machine_id on public.print_runs (machine_id) where machine_id is not null;

create table public.project_cost_snapshots (
  id bigint generated always as identity primary key,
  project_id text not null references public.projects(id) on delete cascade,
  snapshot_version integer not null,
  status text not null check (status in ('ISSUED', 'SUPERSEDED')),
  currency text not null default 'ZAR',
  total_cost numeric not null default 0,
  line_summary jsonb not null default '[]'::jsonb,
  generated_at timestamptz not null default timezone('utc'::text, now()),
  generated_by_user_id uuid,
  generated_by_email text,
  generated_by_technician text not null,
  superseded_at timestamptz,
  superseded_by_user_id uuid,
  superseded_by_email text,
  superseded_by_technician text,
  superseded_reason text
);

alter table public.project_cost_snapshots enable row level security;

create policy project_cost_snapshots_select_authenticated
on public.project_cost_snapshots
for select
to authenticated
using (true);

create index idx_project_cost_snapshots_project_version
  on public.project_cost_snapshots (project_id, snapshot_version desc);

create unique index uq_project_cost_snapshots_project_version
  on public.project_cost_snapshots (project_id, snapshot_version);

create unique index uq_project_cost_snapshots_active_issued
  on public.project_cost_snapshots (project_id)
  where status = 'ISSUED';

CREATE OR REPLACE FUNCTION public.prevent_audit_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only';
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_managed_state_updates()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('app.transition_rpc', true) = 'on' THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'projects' THEN
    IF NEW.state IS DISTINCT FROM OLD.state THEN
      RAISE EXCEPTION 'Project state transitions must use transition_project_state()';
    END IF;
  ELSIF TG_TABLE_NAME = 'parts' THEN
    IF NEW."printStatus" IS DISTINCT FROM OLD."printStatus" THEN
      RAISE EXCEPTION 'Part status transitions must use transition_part_status()';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.append_audit_event(
  p_action_type text,
  p_technician_name text,
  p_project_id text,
  p_part_id uuid,
  p_from_project_state public.project_state,
  p_to_project_state public.project_state,
  p_from_part_status public.part_status,
  p_to_part_status public.part_status,
  p_reason text,
  p_override_note text,
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.audit_events (
    actor_user_id,
    actor_email,
    technician_name,
    action_type,
    project_id,
    part_id,
    from_project_state,
    to_project_state,
    from_part_status,
    to_part_status,
    reason,
    override_note,
    payload
  )
  VALUES (
    auth.uid(),
    auth.jwt() ->> 'email',
    p_technician_name,
    p_action_type,
    p_project_id,
    p_part_id,
    p_from_project_state,
    p_to_project_state,
    p_from_part_status,
    p_to_part_status,
    p_reason,
    p_override_note,
    coalesce(p_payload, '{}'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_project_cost_snapshot_updates()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('app.transition_rpc', true) = 'on' THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Quote snapshots are immutable and must be managed via transition RPCs.';
END;
$$;

CREATE OR REPLACE FUNCTION public.prevent_project_cost_snapshot_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION 'Quote snapshots cannot be deleted.';
END;
$$;

CREATE OR REPLACE FUNCTION public.normalize_material_bucket(p_material text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_material text := upper(trim(coalesce(p_material, '')));
BEGIN
  IF v_material = '' THEN
    RETURN 'UNSPECIFIED';
  END IF;

  IF v_material LIKE 'PLA%' OR v_material LIKE 'TPLA%' OR v_material LIKE '%PLA%' THEN
    RETURN 'PLA';
  END IF;

  RETURN v_material;
END;
$$;

CREATE OR REPLACE FUNCTION public.payment_gate_satisfied(
  p_needs_payment boolean,
  p_receipt_number text,
  p_module_or_lecturer_pays boolean,
  p_override_note text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    COALESCE(p_needs_payment, true) = false
    OR NULLIF(trim(coalesce(p_receipt_number, '')), '') IS NOT NULL
    OR COALESCE(p_module_or_lecturer_pays, false) = true
    OR NULLIF(trim(coalesce(p_override_note, '')), '') IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION public.supersede_project_quote_snapshots(
  p_project_id text,
  p_technician_name text,
  p_reason text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  PERFORM set_config('app.transition_rpc', 'on', true);

  WITH superseded AS (
    UPDATE public.project_cost_snapshots
    SET
      status = 'SUPERSEDED',
      superseded_at = timezone('utc'::text, now()),
      superseded_by_user_id = auth.uid(),
      superseded_by_email = auth.jwt() ->> 'email',
      superseded_by_technician = NULLIF(trim(coalesce(p_technician_name, '')), ''),
      superseded_reason = NULLIF(trim(coalesce(p_reason, '')), '')
    WHERE project_id = upper(trim(p_project_id))
      AND status = 'ISSUED'
    RETURNING id
  )
  SELECT COUNT(*)::integer INTO v_count FROM superseded;

  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.issue_project_quote_snapshot(
  p_project_id text,
  p_technician_name text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_project public.projects%ROWTYPE;
  v_snapshot_version integer := 0;
  v_total_cost numeric := 0;
  v_line_summary jsonb := '[]'::jsonb;
  v_snapshot_id bigint;
  v_filament_prices jsonb := '[]'::jsonb;
  v_provided_filament_price_per_gram numeric := 0;
BEGIN
  IF NULLIF(trim(coalesce(p_technician_name, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Technician name is required for quote snapshots.';
  END IF;

  SELECT *
  INTO v_project
  FROM public.projects
  WHERE id = upper(trim(p_project_id))
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Project not found.';
  END IF;

  SELECT COALESCE(MAX(snapshot_version), 0) + 1
  INTO v_snapshot_version
  FROM public.project_cost_snapshots
  WHERE project_id = v_project.id;

  SELECT COALESCE((SELECT value FROM public.config WHERE key = 'settings_filaments'), '[]'::jsonb)
  INTO v_filament_prices;

  SELECT COALESCE(
    (
      SELECT CASE
        WHEN COALESCE(value #>> '{}', '') ~ '^[0-9]+(\.[0-9]+)?$' THEN (value #>> '{}')::numeric
        ELSE 0
      END
      FROM public.config
      WHERE key = 'settings_provided_filament_price_per_gram'
    ),
    0
  )
  INTO v_provided_filament_price_per_gram;

  SELECT
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'part_id', per_part.part_id,
          'part_number', per_part.part_number,
          'part_name', per_part.part_name,
          'total_grams', per_part.total_grams,
          'total_cost', per_part.total_cost,
          'materials', per_part.materials
        )
        ORDER BY per_part.part_number, per_part.part_id
      ),
      '[]'::jsonb
    ),
    COALESCE(SUM(per_part.total_cost), 0)
  INTO v_line_summary, v_total_cost
  FROM (
    SELECT
      prt.id AS part_id,
      prt."partNumber" AS part_number,
      prt."partName" AS part_name,
      COALESCE(SUM(mat.grams), 0) AS total_grams,
      COALESCE(SUM(mat.cost), 0) AS total_cost,
      COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'slot', mat.slot,
            'material_bucket', public.normalize_material_bucket(mat.material),
            'filament_source', mat.filament_source,
            'material', mat.material,
            'grams', mat.grams,
            'cost', mat.cost
          )
          ORDER BY mat.slot
        ) FILTER (WHERE mat.slot IS NOT NULL),
        '[]'::jsonb
      ) AS materials
    FROM public.parts prt
    LEFT JOIN LATERAL (
      SELECT
        material_rows.slot,
        material_rows.material,
        material_rows.filament_source,
        material_rows.grams,
        CASE
          WHEN material_rows.filament_source <> 'misc' THEN
            material_rows.grams * v_provided_filament_price_per_gram
          ELSE
            material_rows.grams * COALESCE((
              SELECT
                CASE
                  WHEN COALESCE(price_row.value->>'pricePerGram', '') ~ '^[0-9]+(\.[0-9]+)?$'
                    THEN (price_row.value->>'pricePerGram')::numeric
                  ELSE 0
                END
              FROM jsonb_array_elements(v_filament_prices) AS price_row(value)
              WHERE upper(trim(price_row.value->>'type')) = upper(trim(material_rows.material))
              LIMIT 1
            ), 0)
        END AS cost
      FROM (
        VALUES
          (
            'primary'::text,
            NULLIF(trim(prt."primaryMaterial"), ''),
            COALESCE(prt."primaryFilamentSource", CASE WHEN COALESCE(prt."primaryOwnFilament", false) THEN 'student_provided' ELSE 'misc' END)::text,
            COALESCE(prt."primaryEstimatedWeight", 0)::numeric
          ),
          (
            'secondary'::text,
            NULLIF(trim(prt."secondaryMaterial"), ''),
            COALESCE(prt."secondaryFilamentSource", CASE WHEN COALESCE(prt."secondaryOwnFilament", false) THEN 'student_provided' ELSE 'misc' END)::text,
            COALESCE(prt."secondaryEstimatedWeight", 0)::numeric
          )
      ) AS material_rows(slot, material, filament_source, grams)
      WHERE material_rows.material IS NOT NULL
         OR material_rows.grams <> 0
    ) mat ON true
    WHERE prt."projectId" = v_project.id
    GROUP BY prt.id, prt."partNumber", prt."partName"
  ) per_part;

  PERFORM public.supersede_project_quote_snapshots(
    p_project_id => v_project.id,
    p_technician_name => trim(p_technician_name),
    p_reason => 'Superseded by newer quote snapshot.'
  );

  INSERT INTO public.project_cost_snapshots (
    project_id,
    snapshot_version,
    status,
    currency,
    total_cost,
    line_summary,
    generated_by_user_id,
    generated_by_email,
    generated_by_technician
  )
  VALUES (
    v_project.id,
    v_snapshot_version,
    'ISSUED',
    'ZAR',
    COALESCE(v_total_cost, 0),
    COALESCE(v_line_summary, '[]'::jsonb),
    auth.uid(),
    auth.jwt() ->> 'email',
    trim(p_technician_name)
  )
  RETURNING id INTO v_snapshot_id;

  RETURN jsonb_build_object(
    'snapshot_id', v_snapshot_id,
    'snapshot_version', v_snapshot_version,
    'status', 'ISSUED',
    'currency', 'ZAR',
    'total_cost', COALESCE(v_total_cost, 0),
    'line_summary', COALESCE(v_line_summary, '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.transition_project_state(
  p_project_id text,
  p_action text,
  p_technician_name text,
  p_reason text DEFAULT NULL,
  p_override_note text DEFAULT NULL,
  p_print_label text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_project public.projects%ROWTYPE;
  v_from_state public.project_state;
  v_to_state public.project_state;
  v_action text;
  v_errors text[] := ARRAY[]::text[];
  v_warnings text[] := ARRAY[]::text[];
  v_total_parts integer := 0;
  v_review_ready_parts integer := 0;
  v_collection_ready_parts integer := 0;
  v_collected_parts integer := 0;
  v_payment_ok boolean := false;
  v_effective_label text;
  v_effective_override_note text;
  v_parts_promoted_to_ready integer := 0;
  v_quote_snapshot jsonb := NULL;
  v_superseded_snapshots integer := 0;
BEGIN
  IF NULLIF(trim(coalesce(p_technician_name, '')), '') IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'errors', jsonb_build_array('Technician name is required.')
    );
  END IF;

  SELECT *
  INTO v_project
  FROM public.projects
  WHERE id = upper(trim(p_project_id))
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'errors', jsonb_build_array('Project not found.')
    );
  END IF;

  v_from_state := v_project.state;
  v_action := upper(trim(p_action));

  SELECT
    COUNT(*)::integer,
    COUNT(*) FILTER (WHERE "printStatus" IN ('VERIFIED', 'READY', 'PRINTING', 'PRINTED', 'POST_PROCESSING', 'COLLECTED'))::integer,
    COUNT(*) FILTER (WHERE "printStatus" IN ('PRINTED', 'POST_PROCESSING', 'COLLECTED'))::integer,
    COUNT(*) FILTER (WHERE "printStatus" = 'COLLECTED')::integer
  INTO
    v_total_parts,
    v_review_ready_parts,
    v_collection_ready_parts,
    v_collected_parts
  FROM public.parts
  WHERE "projectId" = v_project.id;

  v_effective_override_note := COALESCE(
    NULLIF(trim(coalesce(p_override_note, '')), ''),
    NULLIF(trim(coalesce(v_project."paymentOverrideNote", '')), '')
  );

  v_payment_ok := public.payment_gate_satisfied(
    v_project."needsPayment",
    v_project."receiptNumber",
    v_project."moduleOrLecturerPays",
    v_effective_override_note
  );

  IF v_action = 'BEGIN_REVIEW' THEN
    IF v_from_state NOT IN ('INTAKE', 'REVIEW') THEN
      v_warnings := array_append(v_warnings, format('BEGIN_REVIEW from %s: allowing override by policy.', v_from_state));
    END IF;
    v_to_state := 'REVIEW';

  ELSIF v_action = 'COMPLETE_REVIEW' THEN
    IF v_from_state NOT IN ('INTAKE', 'REVIEW') THEN
      v_warnings := array_append(v_warnings, format('COMPLETE_REVIEW from %s: allowing direct quote progression by policy.', v_from_state));
    END IF;
    IF v_total_parts = 0 THEN
      v_errors := array_append(v_errors, 'Add at least one part before completing review.');
    END IF;
    IF v_review_ready_parts <> v_total_parts THEN
      v_warnings := array_append(v_warnings, 'Not all parts are verified/ready. Proceeding by override policy.');
    END IF;
    IF array_length(v_errors, 1) IS NULL THEN
      v_to_state := 'QUOTE';
    END IF;

  ELSIF v_action = 'ISSUE_QUOTE' THEN
    IF v_from_state NOT IN ('QUOTE', 'AWAITING_PAYMENT', 'READY_FOR_PRINTING') THEN
      v_warnings := array_append(v_warnings, format('ISSUE_QUOTE from %s: allowing re-quote from any stage by policy.', v_from_state));
    END IF;
    IF v_total_parts = 0 THEN
      v_errors := array_append(v_errors, 'Cannot issue quote without parts.');
    END IF;
    IF v_review_ready_parts <> v_total_parts THEN
      v_warnings := array_append(v_warnings, 'Not all parts are verified/ready. Issuing quote anyway by override policy.');
    END IF;
    IF array_length(v_errors, 1) IS NULL THEN
      IF v_payment_ok THEN
        v_to_state := 'QUOTE';
      ELSE
        v_to_state := 'AWAITING_PAYMENT';
      END IF;
    END IF;

  ELSIF v_action = 'MOVE_TO_PRINTING' THEN
    IF v_from_state NOT IN ('QUOTE', 'AWAITING_PAYMENT', 'READY_FOR_PRINTING', 'IN_PRODUCTION') THEN
      v_warnings := array_append(v_warnings, format('MOVE_TO_PRINTING from %s: allowing override by policy.', v_from_state));
    END IF;
    IF v_total_parts = 0 THEN
      v_errors := array_append(v_errors, 'Cannot start production without parts.');
    END IF;
    IF NOT v_payment_ok THEN
      v_errors := array_append(v_errors, 'Payment gate not satisfied. Add receipt, mark module/lecturer-paid, or provide an override note.');
    END IF;
    IF array_length(v_errors, 1) IS NULL THEN
      IF v_review_ready_parts <> v_total_parts THEN
        v_warnings := array_append(v_warnings, 'Not all parts are verified/ready. Proceeding to production by override policy.');
      END IF;
      v_to_state := 'IN_PRODUCTION';
    END IF;

  ELSIF v_action = 'MARK_READY_FOR_COLLECTION' THEN
    IF v_from_state NOT IN ('IN_PRODUCTION', 'READY_FOR_COLLECTION', 'PARTIALLY_COLLECTED') THEN
      v_warnings := array_append(v_warnings, format('MARK_READY_FOR_COLLECTION from %s: allowing override by policy.', v_from_state));
    END IF;
    IF v_total_parts = 0 THEN
      v_errors := array_append(v_errors, 'Cannot mark project ready for collection without parts.');
    END IF;
    IF array_length(v_errors, 1) IS NULL THEN
      IF v_collection_ready_parts <> v_total_parts THEN
        v_warnings := array_append(v_warnings, 'Not all parts are printed/post-processed/collected. Collection readiness forced by override policy.');
      END IF;

      IF v_collected_parts > 0 AND v_collected_parts < v_total_parts THEN
        v_to_state := 'PARTIALLY_COLLECTED';
      ELSIF v_collected_parts = v_total_parts THEN
        v_to_state := 'CLOSED';
      ELSE
        v_to_state := 'READY_FOR_COLLECTION';
      END IF;
    END IF;

  ELSIF v_action = 'CLOSE_PROJECT' THEN
    IF v_total_parts = 0 THEN
      v_errors := array_append(v_errors, 'Cannot close an empty project.');
    END IF;
    IF v_collected_parts <> v_total_parts THEN
      v_warnings := array_append(v_warnings, 'Closing without all parts collected by override policy.');
    END IF;
    IF array_length(v_errors, 1) IS NULL THEN
      v_to_state := 'CLOSED';
    END IF;

  ELSIF v_action = 'CANCEL_PROJECT' THEN
    IF v_project.state = 'CLOSED' THEN
      v_warnings := array_append(v_warnings, 'Cancelling a previously closed project by override policy.');
    END IF;
    v_to_state := 'CANCELLED';

  ELSIF v_action = 'REOPEN_REVIEW' THEN
    IF v_from_state NOT IN ('QUOTE', 'AWAITING_PAYMENT', 'READY_FOR_PRINTING', 'IN_PRODUCTION', 'READY_FOR_COLLECTION', 'PARTIALLY_COLLECTED') THEN
      v_warnings := array_append(v_warnings, format('REOPEN_REVIEW from %s: allowing override by policy.', v_from_state));
    END IF;
    IF NULLIF(trim(coalesce(p_reason, '')), '') IS NULL THEN
      v_warnings := array_append(v_warnings, 'Reopening review without a reason. Reason is recommended.');
    END IF;
    v_to_state := 'REVIEW';

  ELSE
    v_errors := array_append(v_errors, format('Unsupported action: %s', p_action));
  END IF;

  IF array_length(v_errors, 1) IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'action', v_action,
      'current_state', v_from_state,
      'errors', to_jsonb(v_errors),
      'warnings', to_jsonb(v_warnings)
    );
  END IF;

  v_effective_label := NULLIF(trim(coalesce(p_print_label, '')), '');

  PERFORM set_config('app.transition_rpc', 'on', true);

  UPDATE public.projects
  SET
    state = v_to_state,
    "printLabel" = CASE
      WHEN v_effective_label IS NOT NULL THEN v_effective_label
      ELSE "printLabel"
    END,
    "paymentOverrideNote" = CASE
      WHEN NULLIF(trim(coalesce(p_override_note, '')), '') IS NOT NULL THEN NULLIF(trim(coalesce(p_override_note, '')), '')
      ELSE "paymentOverrideNote"
    END
  WHERE id = v_project.id
  RETURNING * INTO v_project;

  IF v_action = 'MOVE_TO_PRINTING' THEN
    WITH promoted AS (
      UPDATE public.parts
      SET "printStatus" = 'READY'
      WHERE "projectId" = v_project.id
        AND "printStatus" = 'VERIFIED'
      RETURNING id
    )
    SELECT COUNT(*)::integer INTO v_parts_promoted_to_ready FROM promoted;
  END IF;

  IF v_action = 'ISSUE_QUOTE' THEN
    v_quote_snapshot := public.issue_project_quote_snapshot(v_project.id, trim(p_technician_name));
  ELSIF v_action = 'REOPEN_REVIEW' THEN
    v_superseded_snapshots := public.supersede_project_quote_snapshots(
      p_project_id => v_project.id,
      p_technician_name => trim(p_technician_name),
      p_reason => NULLIF(trim(coalesce(p_reason, '')), '')
    );
  END IF;

  PERFORM public.append_audit_event(
    p_action_type => v_action,
    p_technician_name => trim(p_technician_name),
    p_project_id => v_project.id,
    p_part_id => NULL,
    p_from_project_state => v_from_state,
    p_to_project_state => v_to_state,
    p_from_part_status => NULL,
    p_to_part_status => NULL,
    p_reason => NULLIF(trim(coalesce(p_reason, '')), ''),
    p_override_note => NULLIF(trim(coalesce(p_override_note, '')), ''),
    p_payload => jsonb_build_object(
      'total_parts', v_total_parts,
      'payment_gate_passed', v_payment_ok,
      'print_label', COALESCE(v_effective_label, v_project."printLabel"),
      'parts_promoted_to_ready', v_parts_promoted_to_ready,
      'module_or_lecturer_pays', COALESCE(v_project."moduleOrLecturerPays", false),
      'payment_override_on_project', NULLIF(trim(coalesce(v_project."paymentOverrideNote", '')), '') IS NOT NULL,
      'quote_snapshot', v_quote_snapshot,
      'superseded_snapshots', v_superseded_snapshots,
      'warnings', to_jsonb(v_warnings)
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'action', v_action,
    'from_state', v_from_state,
    'to_state', v_to_state,
    'project_id', v_project.id,
    'quote_snapshot', v_quote_snapshot,
    'warnings', to_jsonb(v_warnings)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.transition_part_status(
  p_project_id text,
  p_part_id uuid,
  p_action text,
  p_technician_name text,
  p_machine_name text DEFAULT NULL,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_project public.projects%ROWTYPE;
  v_part public.parts%ROWTYPE;
  v_action text;
  v_errors text[] := ARRAY[]::text[];
  v_warnings text[] := ARRAY[]::text[];
  v_from_status public.part_status;
  v_to_status public.part_status;
  v_total_parts integer := 0;
  v_collected_parts integer := 0;
  v_collection_ready_parts integer := 0;
  v_project_from_state public.project_state;
  v_project_to_state public.project_state;
  v_tech text;
  v_machine text;
  v_active_run_id bigint;
  v_failure_reason text;
BEGIN
  v_tech := NULLIF(trim(coalesce(p_technician_name, '')), '');
  v_machine := NULLIF(trim(coalesce(p_machine_name, '')), '');
  v_failure_reason := NULLIF(trim(coalesce(p_reason, '')), '');

  SELECT *
  INTO v_project
  FROM public.projects
  WHERE id = upper(trim(p_project_id))
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'errors', jsonb_build_array('Project not found.')
    );
  END IF;

  SELECT *
  INTO v_part
  FROM public.parts
  WHERE id = p_part_id
    AND "projectId" = v_project.id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'errors', jsonb_build_array('Part not found for this project.')
    );
  END IF;

  v_action := upper(trim(p_action));
  v_from_status := v_part."printStatus";
  v_project_from_state := v_project.state;

  IF v_action IN ('VERIFY_PART', 'MARK_PART_READY', 'START_PRINT', 'FINISH_PRINT', 'FAIL_PRINT', 'COLLECT_PART')
     AND v_tech IS NULL THEN
    v_errors := array_append(v_errors, 'Technician name is required.');
  END IF;

  IF v_action = 'START_PRINT' THEN
    SELECT id
    INTO v_active_run_id
    FROM public.print_runs
    WHERE part_id = v_part.id
      AND finished_at IS NULL
      AND failed_at IS NULL
    ORDER BY started_at DESC
    LIMIT 1
    FOR UPDATE;

    IF FOUND THEN
      IF v_from_status = 'PRINTING' THEN
        v_errors := array_append(v_errors, 'This part already has an active print run.');
      ELSE
        v_warnings := array_append(v_warnings, 'Closed a stale active print run before starting a new run.');
      END IF;
    END IF;
  END IF;

  IF v_action IN ('FINISH_PRINT', 'FAIL_PRINT', 'REQUEUE_PART') THEN
    SELECT id
    INTO v_active_run_id
    FROM public.print_runs
    WHERE part_id = v_part.id
      AND finished_at IS NULL
      AND failed_at IS NULL
    ORDER BY started_at DESC
    LIMIT 1
    FOR UPDATE;

    IF v_action IN ('FINISH_PRINT', 'FAIL_PRINT') AND NOT FOUND THEN
      v_errors := array_append(v_errors, 'No active print run found for this part.');
    END IF;
  END IF;

  IF v_action = 'VERIFY_PART' THEN
    IF v_from_status NOT IN ('DRAFT', 'VERIFIED', 'READY') THEN
      v_errors := array_append(v_errors, format('Cannot verify part from status %s.', v_from_status));
    ELSE
      v_to_status := 'VERIFIED';
    END IF;

  ELSIF v_action = 'UNVERIFY_PART' THEN
    IF v_from_status NOT IN ('VERIFIED', 'READY') THEN
      v_errors := array_append(v_errors, format('Cannot unverify part from status %s.', v_from_status));
    ELSE
      v_to_status := 'DRAFT';
    END IF;

  ELSIF v_action = 'MARK_PART_READY' THEN
    IF v_from_status NOT IN ('VERIFIED', 'FAILED', 'DRAFT') THEN
      v_errors := array_append(v_errors, format('Cannot mark part ready from status %s.', v_from_status));
    ELSE
      IF v_from_status = 'DRAFT' AND NULLIF(trim(coalesce(v_part."checkedBy", '')), '') IS NULL AND v_tech IS NULL THEN
        v_errors := array_append(v_errors, 'Draft parts need verification before they can be marked ready.');
      ELSE
        v_to_status := 'READY';
      END IF;
    END IF;

  ELSIF v_action = 'START_PRINT' THEN
    IF v_machine IS NULL THEN
      v_errors := array_append(v_errors, 'Machine/printer name is required to start a print.');
    END IF;
    IF v_project.state NOT IN ('READY_FOR_PRINTING', 'IN_PRODUCTION') THEN
      v_errors := array_append(v_errors, format('Project must be READY_FOR_PRINTING or IN_PRODUCTION to start a print (current: %s).', v_project.state));
    END IF;
    IF v_from_status NOT IN ('READY', 'VERIFIED', 'FAILED') THEN
      v_errors := array_append(v_errors, format('Cannot start print from status %s.', v_from_status));
    ELSE
      v_to_status := 'PRINTING';
    END IF;

  ELSIF v_action = 'FINISH_PRINT' THEN
    IF v_from_status <> 'PRINTING' THEN
      v_errors := array_append(v_errors, format('Cannot finish print from status %s.', v_from_status));
    ELSE
      v_to_status := 'PRINTED';
    END IF;

  ELSIF v_action = 'FAIL_PRINT' THEN
    IF v_from_status <> 'PRINTING' THEN
      v_errors := array_append(v_errors, format('Cannot fail print from status %s.', v_from_status));
    ELSE
      IF v_failure_reason IS NULL THEN
        v_errors := array_append(v_errors, 'Failure reason is required to fail a print.');
      END IF;
      v_to_status := 'FAILED';
    END IF;

  ELSIF v_action = 'SEND_TO_POST_PROCESSING' THEN
    IF v_from_status <> 'PRINTED' THEN
      v_errors := array_append(v_errors, format('Cannot send to post-processing from status %s.', v_from_status));
    ELSE
      v_to_status := 'POST_PROCESSING';
    END IF;

  ELSIF v_action = 'MARK_PRINTED_READY' THEN
    IF v_from_status <> 'POST_PROCESSING' THEN
      v_errors := array_append(v_errors, format('Cannot mark printed-ready from status %s.', v_from_status));
    ELSE
      v_to_status := 'PRINTED';
    END IF;

  ELSIF v_action = 'COLLECT_PART' THEN
    IF v_from_status NOT IN ('PRINTED', 'POST_PROCESSING') THEN
      v_errors := array_append(v_errors, format('Cannot collect part from status %s.', v_from_status));
    ELSE
      IF COALESCE(v_project."needsPayment", true) = true
         AND NULLIF(trim(coalesce(v_project."receiptNumber", '')), '') IS NULL THEN
        v_errors := array_append(v_errors, 'Receipt number is required before collection when payment is required.');
      END IF;
      v_to_status := 'COLLECTED';
    END IF;

  ELSIF v_action = 'REQUEUE_PART' THEN
    IF v_from_status NOT IN ('FAILED', 'PRINTED', 'POST_PROCESSING', 'PRINTING', 'READY', 'VERIFIED') THEN
      v_errors := array_append(v_errors, format('Cannot requeue part from status %s.', v_from_status));
    ELSE
      v_to_status := 'READY';
    END IF;

  ELSE
    v_errors := array_append(v_errors, format('Unsupported action: %s', p_action));
  END IF;

  IF array_length(v_errors, 1) IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'action', v_action,
      'current_status', v_from_status,
      'errors', to_jsonb(v_errors)
    );
  END IF;

  PERFORM set_config('app.transition_rpc', 'on', true);

  UPDATE public.parts
  SET
    "printStatus" = v_to_status,
    "checkedBy" = CASE
      WHEN v_action = 'VERIFY_PART' THEN v_tech
      WHEN v_action = 'UNVERIFY_PART' THEN NULL
      ELSE "checkedBy"
    END,
    "printerName" = CASE
      WHEN v_action = 'START_PRINT' THEN v_machine
      WHEN v_action = 'REQUEUE_PART' THEN NULL
      ELSE "printerName"
    END,
    "startedBy" = CASE
      WHEN v_action = 'START_PRINT' THEN v_tech
      WHEN v_action = 'REQUEUE_PART' THEN NULL
      ELSE "startedBy"
    END,
    "removedBy" = CASE
      WHEN v_action IN ('FINISH_PRINT', 'FAIL_PRINT', 'REQUEUE_PART') THEN v_tech
      ELSE "removedBy"
    END,
    "collectedBy" = CASE
      WHEN v_action = 'COLLECT_PART' THEN v_tech
      ELSE "collectedBy"
    END
  WHERE id = v_part.id
  RETURNING * INTO v_part;

  IF v_action = 'START_PRINT' THEN
    IF v_active_run_id IS NOT NULL AND v_from_status <> 'PRINTING' THEN
      UPDATE public.print_runs
      SET
        failed_at = timezone('utc'::text, now()),
        ended_by = v_tech,
        failure_reason = COALESCE(failure_reason, 'Automatically closed stale active print run before restart.'),
        outcome = 'FAILED'
      WHERE id = v_active_run_id;
    END IF;

    INSERT INTO public.print_runs (
      part_id,
      project_id,
      machine_name,
      started_by
    )
    VALUES (
      v_part.id,
      v_project.id,
      v_machine,
      v_tech
    )
    RETURNING id INTO v_active_run_id;
  ELSIF v_action = 'FINISH_PRINT' THEN
    UPDATE public.print_runs
    SET
      finished_at = timezone('utc'::text, now()),
      ended_by = v_tech,
      outcome = 'PRINTED'
    WHERE id = v_active_run_id;
  ELSIF v_action = 'FAIL_PRINT' THEN
    UPDATE public.print_runs
    SET
      failed_at = timezone('utc'::text, now()),
      ended_by = v_tech,
      failure_reason = v_failure_reason,
      outcome = 'FAILED'
    WHERE id = v_active_run_id;
  ELSIF v_action = 'REQUEUE_PART' AND v_active_run_id IS NOT NULL THEN
    UPDATE public.print_runs
    SET
      failed_at = timezone('utc'::text, now()),
      ended_by = COALESCE(v_tech, ended_by),
      failure_reason = COALESCE(v_failure_reason, failure_reason, 'Requeued before completion.'),
      outcome = 'FAILED'
    WHERE id = v_active_run_id;
  END IF;

  PERFORM public.append_audit_event(
    p_action_type => v_action,
    p_technician_name => COALESCE(v_tech, 'Unknown Technician'),
    p_project_id => v_project.id,
    p_part_id => v_part.id,
    p_from_project_state => NULL,
    p_to_project_state => NULL,
    p_from_part_status => v_from_status,
    p_to_part_status => v_to_status,
    p_reason => NULLIF(trim(coalesce(p_reason, '')), ''),
    p_override_note => NULL,
    p_payload => jsonb_build_object(
      'machine_name', v_machine,
      'project_state', v_project.state,
      'print_run_id', v_active_run_id
    )
  );

  IF v_action = 'START_PRINT' AND v_project.state <> 'IN_PRODUCTION' THEN
    v_project_to_state := 'IN_PRODUCTION';
    PERFORM set_config('app.transition_rpc', 'on', true);
    UPDATE public.projects
    SET state = v_project_to_state
    WHERE id = v_project.id
    RETURNING * INTO v_project;

    PERFORM public.append_audit_event(
      p_action_type => 'AUTO_PROJECT_STATE_FROM_PART_START',
      p_technician_name => COALESCE(v_tech, 'Unknown Technician'),
      p_project_id => v_project.id,
      p_part_id => v_part.id,
      p_from_project_state => v_project_from_state,
      p_to_project_state => v_project_to_state,
      p_from_part_status => NULL,
      p_to_part_status => NULL,
      p_reason => NULL,
      p_override_note => NULL,
      p_payload => '{}'::jsonb
    );

    v_project_from_state := v_project_to_state;
  END IF;

  SELECT
    COUNT(*)::integer,
    COUNT(*) FILTER (WHERE "printStatus" = 'COLLECTED')::integer,
    COUNT(*) FILTER (WHERE "printStatus" IN ('PRINTED', 'POST_PROCESSING', 'COLLECTED'))::integer
  INTO
    v_total_parts,
    v_collected_parts,
    v_collection_ready_parts
  FROM public.parts
  WHERE "projectId" = v_project.id;

  v_project_to_state := v_project.state;

  IF v_total_parts > 0 AND v_collected_parts = v_total_parts THEN
    v_project_to_state := 'CLOSED';
  ELSIF v_collected_parts > 0 AND v_collected_parts < v_total_parts THEN
    v_project_to_state := 'PARTIALLY_COLLECTED';
  ELSIF v_project.state = 'READY_FOR_COLLECTION' AND v_collection_ready_parts < v_total_parts THEN
    v_project_to_state := 'IN_PRODUCTION';
  END IF;

  IF v_project_to_state IS DISTINCT FROM v_project.state THEN
    v_project_from_state := v_project.state;
    PERFORM set_config('app.transition_rpc', 'on', true);
    UPDATE public.projects
    SET state = v_project_to_state
    WHERE id = v_project.id
    RETURNING * INTO v_project;

    PERFORM public.append_audit_event(
      p_action_type => 'AUTO_PROJECT_STATE_FROM_PART_STATUS',
      p_technician_name => COALESCE(v_tech, 'Unknown Technician'),
      p_project_id => v_project.id,
      p_part_id => v_part.id,
      p_from_project_state => v_project_from_state,
      p_to_project_state => v_project_to_state,
      p_from_part_status => NULL,
      p_to_part_status => NULL,
      p_reason => NULL,
      p_override_note => NULL,
      p_payload => jsonb_build_object('triggering_part_status', v_to_status)
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'action', v_action,
    'from_status', v_from_status,
    'to_status', v_to_status,
    'part_id', v_part.id,
    'project_id', v_project.id,
    'project_state', v_project.state,
    'warnings', to_jsonb(v_warnings)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_public_project_status(project_code text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  normalized_code text;
  v_project public.projects%ROWTYPE;
  v_issued_snapshot public.project_cost_snapshots%ROWTYPE;
  v_snapshot_line_summary jsonb := '[]'::jsonb;
  parts_payload jsonb := '[]'::jsonb;
  total_parts integer := 0;
  completed_parts integer := 0;
  printing_parts integer := 0;
  queued_parts integer := 0;
  computed_cost_total numeric := 0;
  cost_total numeric := 0;
  payment_state_label text;
  state_label text;
  state_description text;
BEGIN
  normalized_code := upper(trim(project_code));

  IF normalized_code !~ '^[A-Z0-9]{5}$' THEN
    RAISE EXCEPTION 'Invalid project code'
      USING ERRCODE = '22023',
            HINT = 'Project codes must be exactly 5 uppercase base36 characters.';
  END IF;

  SELECT p.*
  INTO v_project
  FROM public.projects p
  WHERE p.id = normalized_code
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT *
  INTO v_issued_snapshot
  FROM public.project_cost_snapshots pcs
  WHERE pcs.project_id = v_project.id
    AND pcs.status = 'ISSUED'
  ORDER BY pcs.snapshot_version DESC
  LIMIT 1;

  IF FOUND THEN
    v_snapshot_line_summary := COALESCE(v_issued_snapshot.line_summary, '[]'::jsonb);
  END IF;

  SELECT
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'part_id', prt.id,
          'part_number', prt."partNumber",
          'part_name', prt."partName",
          'print_status', prt."printStatus",
          'print_status_label',
            CASE prt."printStatus"
              WHEN 'DRAFT' THEN 'Queued'
              WHEN 'VERIFIED' THEN 'Queued'
              WHEN 'READY' THEN 'Queued'
              WHEN 'PRINTING' THEN 'Printing'
              WHEN 'PRINTED' THEN 'Printed'
              WHEN 'FAILED' THEN 'Queued'
              WHEN 'POST_PROCESSING' THEN 'Printed'
              WHEN 'COLLECTED' THEN 'Printed'
              ELSE initcap(replace(prt."printStatus"::text, '_', ' '))
            END,
          'thumbnail_url', prt."imageUrl",
          'printer_name', prt."printerName",
          'primary_material', prt."primaryMaterial",
          'primary_brand', prt."primaryBrand",
          'primary_estimated_weight', prt."primaryEstimatedWeight",
          'secondary_material', prt."secondaryMaterial",
          'secondary_brand', prt."secondaryBrand",
          'secondary_estimated_weight', prt."secondaryEstimatedWeight",
          'primary_cost', COALESCE(snap.primary_cost, COALESCE(prt."primaryServiceCost", 0)),
          'secondary_cost', COALESCE(snap.secondary_cost, COALESCE(prt."secondaryServiceCost", 0)),
          'total_cost', COALESCE(
            snap.total_cost,
            COALESCE(prt."primaryServiceCost", 0) + COALESCE(prt."secondaryServiceCost", 0)
          )
        )
        ORDER BY prt."partNumber", prt.id
      ),
      '[]'::jsonb
    ),
    COUNT(*)::integer,
    COUNT(*) FILTER (WHERE prt."printStatus" IN ('PRINTED', 'POST_PROCESSING', 'COLLECTED'))::integer,
    COUNT(*) FILTER (WHERE prt."printStatus" = 'PRINTING')::integer,
    COUNT(*) FILTER (WHERE prt."printStatus" IN ('DRAFT', 'VERIFIED', 'READY', 'FAILED'))::integer,
    COALESCE(SUM(COALESCE(
      snap.total_cost,
      COALESCE(prt."primaryServiceCost", 0) + COALESCE(prt."secondaryServiceCost", 0)
    )), 0)
  INTO
    parts_payload,
    total_parts,
    completed_parts,
    printing_parts,
    queued_parts,
    computed_cost_total
  FROM public.parts prt
  LEFT JOIN LATERAL (
    SELECT
      COALESCE((line ->> 'total_cost')::numeric, NULL) AS total_cost,
      (
        SELECT (material_item ->> 'cost')::numeric
        FROM jsonb_array_elements(COALESCE(line -> 'materials', '[]'::jsonb)) material_item
        WHERE material_item ->> 'slot' = 'primary'
        LIMIT 1
      ) AS primary_cost,
      (
        SELECT (material_item ->> 'cost')::numeric
        FROM jsonb_array_elements(COALESCE(line -> 'materials', '[]'::jsonb)) material_item
        WHERE material_item ->> 'slot' = 'secondary'
        LIMIT 1
      ) AS secondary_cost
    FROM jsonb_array_elements(v_snapshot_line_summary) line
    WHERE line ->> 'part_id' = prt.id::text
    LIMIT 1
  ) snap ON true
  WHERE prt."projectId" = v_project.id;

  cost_total := COALESCE(v_issued_snapshot.total_cost, computed_cost_total, 0);

  IF COALESCE(v_project."needsPayment", true) = false THEN
    payment_state_label := 'NOT_REQUIRED';
  ELSIF COALESCE(NULLIF(trim(v_project."receiptNumber"), ''), '') <> '' THEN
    payment_state_label := 'RECEIPT_RECORDED';
  ELSIF COALESCE(v_project."moduleOrLecturerPays", false) = true THEN
    payment_state_label := 'MODULE_OR_LECTURER_PAID';
  ELSIF COALESCE(NULLIF(trim(v_project."paymentOverrideNote"), ''), '') <> '' THEN
    payment_state_label := 'OVERRIDE_APPROVED';
  ELSE
    payment_state_label := 'PAYMENT_REQUIRED';
  END IF;

  state_label :=
    CASE v_project.state
      WHEN 'INTAKE' THEN 'Submitted'
      WHEN 'REVIEW' THEN 'Under review'
      WHEN 'QUOTE' THEN 'Quote ready'
      WHEN 'AWAITING_PAYMENT' THEN 'Action needed'
      WHEN 'READY_FOR_PRINTING' THEN 'Ready for production'
      WHEN 'IN_PRODUCTION' THEN 'In production'
      WHEN 'READY_FOR_COLLECTION' THEN 'Ready to collect'
      WHEN 'PARTIALLY_COLLECTED' THEN 'Partially collected'
      WHEN 'CLOSED' THEN 'Complete'
      WHEN 'CANCELLED' THEN 'Cancelled'
      ELSE initcap(replace(v_project.state::text, '_', ' '))
    END;

  state_description :=
    CASE v_project.state
      WHEN 'INTAKE' THEN 'Your request has been received.'
      WHEN 'REVIEW' THEN 'MISC is checking files, material choices, and print details.'
      WHEN 'QUOTE' THEN 'Your quote is being prepared for confirmation.'
      WHEN 'AWAITING_PAYMENT' THEN 'Please settle payment requirements before production starts.'
      WHEN 'READY_FOR_PRINTING' THEN 'This project is approved and waiting for a machine slot.'
      WHEN 'IN_PRODUCTION' THEN 'Your parts are in the print queue or currently printing.'
      WHEN 'READY_FOR_COLLECTION' THEN 'Your project is ready at the MISC front desk.'
      WHEN 'PARTIALLY_COLLECTED' THEN 'Some parts have already been collected.'
      WHEN 'CLOSED' THEN 'This project has been collected and closed.'
      WHEN 'CANCELLED' THEN 'This project has been cancelled by MISC.'
      ELSE format('Current status: %s', v_project.state)
    END;

  RETURN jsonb_build_object(
    'project_code', v_project.id,
    'collection_code',
      CASE
        WHEN v_project.state IN ('READY_FOR_COLLECTION', 'PARTIALLY_COLLECTED', 'CLOSED') THEN v_project.id
        ELSE NULL
      END,
    'state', v_project.state,
    'state_label', state_label,
    'state_description', state_description,
    'created_at', v_project."createdAt",
    'course', v_project.course,
    'lecturer', v_project.lecturer,
    'cost_total', cost_total,
    'currency', COALESCE(v_issued_snapshot.currency, 'ZAR'),
    'payment', jsonb_build_object(
      'needs_payment', COALESCE(v_project."needsPayment", true),
      'payment_state_label', payment_state_label,
      'receipt_number', NULLIF(trim(v_project."receiptNumber"), ''),
      'module_paid', COALESCE(v_project."moduleOrLecturerPays", false),
      'override_applied', COALESCE(NULLIF(trim(v_project."paymentOverrideNote"), ''), '') <> ''
    ),
    'quote_snapshot',
      CASE
        WHEN v_issued_snapshot.id IS NULL THEN NULL
        ELSE jsonb_build_object(
          'snapshot_version', v_issued_snapshot.snapshot_version,
          'status', v_issued_snapshot.status,
          'generated_at', v_issued_snapshot.generated_at,
          'total_cost', v_issued_snapshot.total_cost,
          'currency', v_issued_snapshot.currency,
          'line_summary', COALESCE(v_issued_snapshot.line_summary, '[]'::jsonb)
        )
      END,
    'part_summary', jsonb_build_object(
      'total_parts', total_parts,
      'completed_parts', completed_parts,
      'printing_parts', printing_parts,
      'queued_parts', queued_parts
    ),
    'parts', parts_payload
  );
END;
$$;

CREATE OR REPLACE VIEW public.global_queue_parts AS
WITH latest_run AS (
  SELECT DISTINCT ON (pr.part_id)
    pr.part_id,
    pr.id AS latest_run_id,
    pr.machine_id AS latest_machine_id,
    pr.machine_name AS latest_machine_name,
    pr.started_by AS latest_started_by,
    pr.started_at AS latest_started_at,
    pr.ended_by AS latest_ended_by,
    pr.finished_at AS latest_finished_at,
    pr.failed_at AS latest_failed_at,
    pr.failure_reason AS latest_failure_reason,
    pr.outcome AS latest_outcome
  FROM public.print_runs pr
  ORDER BY pr.part_id, pr.started_at DESC
)
SELECT
  p.id AS project_id,
  p."priorityNumber" AS priority_number,
  CASE
    WHEN p."createdAt" IS NULL OR p."createdAt" = '' THEN timezone('utc'::text, now())
    ELSE p."createdAt"::timestamptz
  END AS project_created_at,
  p."studentName" AS student_name,
  p."studentNumber" AS student_number,
  p.state AS project_state,
  prt.id AS part_id,
  prt."partNumber" AS part_number,
  prt."partName" AS part_name,
  prt."printStatus" AS part_status,
  prt."printerName" AS part_printer_name,
  CASE
    WHEN prt."printStatus" IN ('DRAFT', 'VERIFIED') THEN 'PENDING_VERIFICATION'
    WHEN prt."printStatus" = 'READY' THEN 'READY_TO_PRINT'
    WHEN prt."printStatus" = 'PRINTING' THEN 'ACTIVE_PRINTS'
    WHEN prt."printStatus" IN ('FAILED', 'POST_PROCESSING') THEN 'FAILED_OR_POST_PROCESSING'
    ELSE NULL
  END AS queue_bucket,
  lr.latest_run_id,
  lr.latest_machine_id,
  lr.latest_machine_name,
  lr.latest_started_by,
  lr.latest_started_at,
  lr.latest_ended_by,
  lr.latest_finished_at,
  lr.latest_failed_at,
  lr.latest_failure_reason,
  lr.latest_outcome
FROM public.projects p
JOIN public.parts prt
  ON prt."projectId" = p.id
LEFT JOIN latest_run lr
  ON lr.part_id = prt.id
WHERE p.archived = false
  AND p.state <> 'CANCELLED'
  AND prt."printStatus" IN ('DRAFT', 'VERIFIED', 'READY', 'PRINTING', 'FAILED', 'POST_PROCESSING');

GRANT SELECT ON public.global_queue_parts TO authenticated;

CREATE OR REPLACE FUNCTION public.get_global_queue()
RETURNS TABLE (
  project_id text,
  priority_number integer,
  project_created_at timestamptz,
  student_name text,
  student_number text,
  project_state public.project_state,
  part_id uuid,
  part_number integer,
  part_name text,
  part_status public.part_status,
  part_printer_name text,
  queue_bucket text,
  latest_run_id bigint,
  latest_machine_id text,
  latest_machine_name text,
  latest_started_by text,
  latest_started_at timestamptz,
  latest_ended_by text,
  latest_finished_at timestamptz,
  latest_failed_at timestamptz,
  latest_failure_reason text,
  latest_outcome text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    gq.project_id,
    gq.priority_number,
    gq.project_created_at,
    gq.student_name,
    gq.student_number,
    gq.project_state,
    gq.part_id,
    gq.part_number,
    gq.part_name,
    gq.part_status,
    gq.part_printer_name,
    gq.queue_bucket,
    gq.latest_run_id,
    gq.latest_machine_id,
    gq.latest_machine_name,
    gq.latest_started_by,
    gq.latest_started_at,
    gq.latest_ended_by,
    gq.latest_finished_at,
    gq.latest_failed_at,
    gq.latest_failure_reason,
    gq.latest_outcome
  FROM public.global_queue_parts gq
  ORDER BY gq.priority_number ASC, gq.project_created_at ASC, gq.part_number ASC;
$$;


create trigger trg_prevent_audit_event_update
before update on public.audit_events
for each row
execute function public.prevent_audit_event_mutation();

create trigger trg_prevent_audit_event_delete
before delete on public.audit_events
for each row
execute function public.prevent_audit_event_mutation();

create trigger trg_guard_project_state_updates
before update on public.projects
for each row
execute function public.guard_managed_state_updates();

create trigger trg_guard_part_status_updates
before update on public.parts
for each row
execute function public.guard_managed_state_updates();

create trigger trg_guard_project_cost_snapshot_updates
before update on public.project_cost_snapshots
for each row
execute function public.guard_project_cost_snapshot_updates();

create trigger trg_prevent_project_cost_snapshot_delete
before delete on public.project_cost_snapshots
for each row
execute function public.prevent_project_cost_snapshot_delete();

revoke all on function public.get_public_project_status(text) from public;
grant execute on function public.get_public_project_status(text) to anon, authenticated, service_role;
grant execute on function public.get_global_queue() to authenticated;
