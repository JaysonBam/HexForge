-- Phase 2: Deterministic workflow transitions (enums + transition RPC + audit events)

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'project_state') THEN
    CREATE TYPE public.project_state AS ENUM (
      'INTAKE',
      'REVIEW',
      'QUOTE',
      'AWAITING_PAYMENT',
      'READY_FOR_PRINTING',
      'IN_PRODUCTION',
      'READY_FOR_COLLECTION',
      'PARTIALLY_COLLECTED',
      'CLOSED',
      'CANCELLED'
    );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'part_status') THEN
    CREATE TYPE public.part_status AS ENUM (
      'DRAFT',
      'VERIFIED',
      'READY',
      'PRINTING',
      'PRINTED',
      'FAILED',
      'POST_PROCESSING',
      'COLLECTED'
    );
  END IF;
END
$$;

ALTER TABLE public.projects
  ALTER COLUMN state DROP DEFAULT;

ALTER TABLE public.projects
  ALTER COLUMN state TYPE public.project_state
  USING (
    CASE state
      WHEN 'NEW' THEN 'INTAKE'::public.project_state
      WHEN 'REVIEW' THEN 'REVIEW'::public.project_state
      WHEN 'CONFIRMATION' THEN 'QUOTE'::public.project_state
      WHEN 'PRINTING' THEN 'IN_PRODUCTION'::public.project_state
      WHEN 'COLLECTION' THEN 'READY_FOR_COLLECTION'::public.project_state
      WHEN 'COMPLETE' THEN 'CLOSED'::public.project_state
      WHEN 'ARCHIVED' THEN 'CANCELLED'::public.project_state
      WHEN 'INTAKE' THEN 'INTAKE'::public.project_state
      WHEN 'QUOTE' THEN 'QUOTE'::public.project_state
      WHEN 'AWAITING_PAYMENT' THEN 'AWAITING_PAYMENT'::public.project_state
      WHEN 'READY_FOR_PRINTING' THEN 'READY_FOR_PRINTING'::public.project_state
      WHEN 'IN_PRODUCTION' THEN 'IN_PRODUCTION'::public.project_state
      WHEN 'READY_FOR_COLLECTION' THEN 'READY_FOR_COLLECTION'::public.project_state
      WHEN 'PARTIALLY_COLLECTED' THEN 'PARTIALLY_COLLECTED'::public.project_state
      WHEN 'CLOSED' THEN 'CLOSED'::public.project_state
      WHEN 'CANCELLED' THEN 'CANCELLED'::public.project_state
      ELSE 'INTAKE'::public.project_state
    END
  );

ALTER TABLE public.projects
  ALTER COLUMN state SET DEFAULT 'INTAKE'::public.project_state;

ALTER TABLE public.parts
  ALTER COLUMN "printStatus" DROP DEFAULT;

ALTER TABLE public.parts
  ALTER COLUMN "printStatus" TYPE public.part_status
  USING (
    CASE "printStatus"
      WHEN 'TO_BE_PRINTED' THEN
        CASE
          WHEN NULLIF(trim(coalesce("checkedBy", '')), '') IS NOT NULL THEN 'VERIFIED'::public.part_status
          ELSE 'DRAFT'::public.part_status
        END
      WHEN 'PRINTING' THEN 'PRINTING'::public.part_status
      WHEN 'PRINTED' THEN 'PRINTED'::public.part_status
      WHEN 'COLLECTED' THEN 'COLLECTED'::public.part_status
      WHEN 'POST_PROCESSING' THEN 'POST_PROCESSING'::public.part_status
      WHEN 'FINISHED' THEN 'PRINTED'::public.part_status
      WHEN 'DRAFT' THEN 'DRAFT'::public.part_status
      WHEN 'VERIFIED' THEN 'VERIFIED'::public.part_status
      WHEN 'READY' THEN 'READY'::public.part_status
      WHEN 'FAILED' THEN 'FAILED'::public.part_status
      ELSE 'DRAFT'::public.part_status
    END
  );

ALTER TABLE public.parts
  ALTER COLUMN "printStatus" SET DEFAULT 'DRAFT'::public.part_status;

CREATE TABLE IF NOT EXISTS public.audit_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  actor_user_id uuid,
  actor_email text,
  technician_name text NOT NULL,
  action_type text NOT NULL,
  project_id text,
  part_id uuid,
  from_project_state public.project_state,
  to_project_state public.project_state,
  from_part_status public.part_status,
  to_part_status public.part_status,
  reason text,
  override_note text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS audit_events_select_authenticated ON public.audit_events;
DROP POLICY IF EXISTS audit_events_insert_authenticated ON public.audit_events;

CREATE POLICY audit_events_select_authenticated
ON public.audit_events
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY audit_events_insert_authenticated
ON public.audit_events
FOR INSERT
TO authenticated
WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_audit_events_created_at ON public.audit_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_project_id ON public.audit_events (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_part_id ON public.audit_events (part_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.print_runs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  part_id uuid NOT NULL REFERENCES public.parts(id) ON DELETE CASCADE,
  project_id text NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  machine_name text,
  started_by text NOT NULL,
  ended_by text,
  started_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  finished_at timestamptz,
  failed_at timestamptz,
  failure_reason text,
  outcome text CHECK (outcome IN ('PRINTED', 'FAILED'))
);

ALTER TABLE public.print_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS print_runs_select_authenticated ON public.print_runs;
DROP POLICY IF EXISTS print_runs_insert_authenticated ON public.print_runs;
DROP POLICY IF EXISTS print_runs_update_authenticated ON public.print_runs;

CREATE POLICY print_runs_select_authenticated
ON public.print_runs
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY print_runs_insert_authenticated
ON public.print_runs
FOR INSERT
TO authenticated
WITH CHECK (true);

CREATE POLICY print_runs_update_authenticated
ON public.print_runs
FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_print_runs_part_id ON public.print_runs (part_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_print_runs_project_id ON public.print_runs (project_id, started_at DESC);

CREATE OR REPLACE FUNCTION public.prevent_audit_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only';
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_audit_event_update ON public.audit_events;
DROP TRIGGER IF EXISTS trg_prevent_audit_event_delete ON public.audit_events;

CREATE TRIGGER trg_prevent_audit_event_update
BEFORE UPDATE ON public.audit_events
FOR EACH ROW
EXECUTE FUNCTION public.prevent_audit_event_mutation();

CREATE TRIGGER trg_prevent_audit_event_delete
BEFORE DELETE ON public.audit_events
FOR EACH ROW
EXECUTE FUNCTION public.prevent_audit_event_mutation();

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

DROP TRIGGER IF EXISTS trg_guard_project_state_updates ON public.projects;
DROP TRIGGER IF EXISTS trg_guard_part_status_updates ON public.parts;

CREATE TRIGGER trg_guard_project_state_updates
BEFORE UPDATE ON public.projects
FOR EACH ROW
EXECUTE FUNCTION public.guard_managed_state_updates();

CREATE TRIGGER trg_guard_part_status_updates
BEFORE UPDATE ON public.parts
FOR EACH ROW
EXECUTE FUNCTION public.guard_managed_state_updates();

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
  v_total_parts integer := 0;
  v_review_ready_parts integer := 0;
  v_printing_or_waiting_parts integer := 0;
  v_collection_ready_parts integer := 0;
  v_collected_parts integer := 0;
  v_payment_ok boolean := false;
  v_effective_label text;
  v_parts_promoted_to_ready integer := 0;
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
    COUNT(*) FILTER (WHERE "printStatus" IN ('READY', 'VERIFIED', 'PRINTING', 'DRAFT', 'FAILED'))::integer,
    COUNT(*) FILTER (WHERE "printStatus" IN ('PRINTED', 'POST_PROCESSING', 'COLLECTED'))::integer,
    COUNT(*) FILTER (WHERE "printStatus" = 'COLLECTED')::integer
  INTO
    v_total_parts,
    v_review_ready_parts,
    v_printing_or_waiting_parts,
    v_collection_ready_parts,
    v_collected_parts
  FROM public.parts
  WHERE "projectId" = v_project.id;

  v_payment_ok :=
    COALESCE(v_project."needsPayment", true) = false
    OR NULLIF(trim(coalesce(v_project."receiptNumber", '')), '') IS NOT NULL
    OR NULLIF(trim(coalesce(p_override_note, '')), '') IS NOT NULL;

  IF v_action = 'BEGIN_REVIEW' THEN
    IF v_project.state NOT IN ('INTAKE', 'REVIEW') THEN
      v_errors := array_append(v_errors, format('Action BEGIN_REVIEW is not allowed from %s.', v_project.state));
    ELSE
      v_to_state := 'REVIEW';
    END IF;

  ELSIF v_action = 'COMPLETE_REVIEW' THEN
    IF v_project.state NOT IN ('REVIEW', 'INTAKE') THEN
      v_errors := array_append(v_errors, format('Action COMPLETE_REVIEW is not allowed from %s.', v_project.state));
    END IF;
    IF v_total_parts = 0 THEN
      v_errors := array_append(v_errors, 'Add at least one part before completing review.');
    END IF;
    IF v_review_ready_parts <> v_total_parts THEN
      v_errors := array_append(v_errors, 'All parts must be verified or ready before completing review.');
    END IF;
    IF array_length(v_errors, 1) IS NULL THEN
      v_to_state := 'QUOTE';
    END IF;

  ELSIF v_action = 'ISSUE_QUOTE' THEN
    IF v_project.state NOT IN ('QUOTE', 'AWAITING_PAYMENT', 'READY_FOR_PRINTING') THEN
      v_errors := array_append(v_errors, format('Action ISSUE_QUOTE is not allowed from %s.', v_project.state));
    END IF;
    IF v_total_parts = 0 THEN
      v_errors := array_append(v_errors, 'Cannot issue quote without parts.');
    END IF;
    IF array_length(v_errors, 1) IS NULL THEN
      -- Issuing a quote must not auto-advance into production readiness.
      -- The explicit MOVE_TO_PRINTING action remains the only production gate.
      IF COALESCE(v_project."needsPayment", true) = true
         AND NULLIF(trim(coalesce(v_project."receiptNumber", '')), '') IS NULL THEN
        v_to_state := 'AWAITING_PAYMENT';
      ELSE
        v_to_state := 'QUOTE';
      END IF;
    END IF;

  ELSIF v_action = 'MOVE_TO_PRINTING' THEN
    IF v_project.state NOT IN ('QUOTE', 'AWAITING_PAYMENT', 'READY_FOR_PRINTING', 'IN_PRODUCTION') THEN
      v_errors := array_append(v_errors, format('Action MOVE_TO_PRINTING is not allowed from %s.', v_project.state));
    END IF;
    IF v_total_parts = 0 THEN
      v_errors := array_append(v_errors, 'Cannot start production without parts.');
    END IF;
    IF v_review_ready_parts <> v_total_parts THEN
      v_errors := array_append(v_errors, 'All parts must be verified or ready before production starts.');
    END IF;
    IF NOT v_payment_ok THEN
      v_errors := array_append(v_errors, 'Payment gate not satisfied. Add a receipt number or provide an override note.');
    END IF;
    IF array_length(v_errors, 1) IS NULL THEN
      v_to_state := 'IN_PRODUCTION';
    END IF;

  ELSIF v_action = 'MARK_READY_FOR_COLLECTION' THEN
    IF v_project.state NOT IN ('IN_PRODUCTION', 'READY_FOR_COLLECTION', 'PARTIALLY_COLLECTED') THEN
      v_errors := array_append(v_errors, format('Action MARK_READY_FOR_COLLECTION is not allowed from %s.', v_project.state));
    END IF;
    IF v_total_parts = 0 THEN
      v_errors := array_append(v_errors, 'Cannot mark project ready for collection without parts.');
    END IF;
    IF v_collection_ready_parts <> v_total_parts THEN
      v_errors := array_append(v_errors, 'Every part must be printed/post-processed/collected before collection can start.');
    END IF;
    IF array_length(v_errors, 1) IS NULL THEN
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
      v_errors := array_append(v_errors, 'All parts must be collected before closing the project.');
    END IF;
    IF array_length(v_errors, 1) IS NULL THEN
      v_to_state := 'CLOSED';
    END IF;

  ELSIF v_action = 'CANCEL_PROJECT' THEN
    IF v_project.state = 'CLOSED' THEN
      v_errors := array_append(v_errors, 'Closed projects cannot be cancelled.');
    END IF;
    IF array_length(v_errors, 1) IS NULL THEN
      v_to_state := 'CANCELLED';
    END IF;

  ELSIF v_action = 'REOPEN_REVIEW' THEN
    IF v_project.state NOT IN ('QUOTE', 'AWAITING_PAYMENT', 'READY_FOR_PRINTING', 'IN_PRODUCTION', 'READY_FOR_COLLECTION', 'PARTIALLY_COLLECTED') THEN
      v_errors := array_append(v_errors, format('Action REOPEN_REVIEW is not allowed from %s.', v_project.state));
    END IF;
    IF NULLIF(trim(coalesce(p_reason, '')), '') IS NULL THEN
      v_errors := array_append(v_errors, 'A reason is required to reopen review.');
    END IF;
    IF array_length(v_errors, 1) IS NULL THEN
      v_to_state := 'REVIEW';
    END IF;

  ELSE
    v_errors := array_append(v_errors, format('Unsupported action: %s', p_action));
  END IF;

  IF array_length(v_errors, 1) IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'action', v_action,
      'current_state', v_from_state,
      'errors', to_jsonb(v_errors)
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
      'parts_promoted_to_ready', v_parts_promoted_to_ready
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'action', v_action,
    'from_state', v_from_state,
    'to_state', v_to_state,
    'project_id', v_project.id
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
      v_errors := array_append(v_errors, 'This part already has an active print run.');
    END IF;
  END IF;

  IF v_action IN ('FINISH_PRINT', 'FAIL_PRINT') THEN
    SELECT id
    INTO v_active_run_id
    FROM public.print_runs
    WHERE part_id = v_part.id
      AND finished_at IS NULL
      AND failed_at IS NULL
    ORDER BY started_at DESC
    LIMIT 1
    FOR UPDATE;

    IF NOT FOUND THEN
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
      v_to_status := 'READY';
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
        v_errors := array_append(v_errors, 'Payment gate not satisfied. Receipt number is required before collection.');
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
      ELSE "printerName"
    END,
    "startedBy" = CASE
      WHEN v_action = 'START_PRINT' THEN v_tech
      ELSE "startedBy"
    END,
    "removedBy" = CASE
      WHEN v_action IN ('FINISH_PRINT', 'FAIL_PRINT') THEN v_tech
      ELSE "removedBy"
    END,
    "collectedBy" = CASE
      WHEN v_action = 'COLLECT_PART' THEN v_tech
      ELSE "collectedBy"
    END
  WHERE id = v_part.id
  RETURNING * INTO v_part;

  IF v_action = 'START_PRINT' THEN
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
  ELSIF v_collection_ready_parts = v_total_parts AND v_project.state = 'IN_PRODUCTION' THEN
    v_project_to_state := 'READY_FOR_COLLECTION';
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
    'project_state', v_project.state
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
  parts_payload jsonb := '[]'::jsonb;
  total_parts integer := 0;
  completed_parts integer := 0;
  printing_parts integer := 0;
  queued_parts integer := 0;
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
          'primary_cost', COALESCE(prt."primaryServiceCost", 0),
          'secondary_cost', COALESCE(prt."secondaryServiceCost", 0),
          'total_cost', COALESCE(prt."primaryServiceCost", 0) + COALESCE(prt."secondaryServiceCost", 0)
        )
        ORDER BY prt."partNumber", prt.id
      ),
      '[]'::jsonb
    ),
    COUNT(*)::integer,
    COUNT(*) FILTER (WHERE prt."printStatus" IN ('PRINTED', 'POST_PROCESSING', 'COLLECTED'))::integer,
    COUNT(*) FILTER (WHERE prt."printStatus" = 'PRINTING')::integer,
    COUNT(*) FILTER (WHERE prt."printStatus" IN ('DRAFT', 'VERIFIED', 'READY', 'FAILED'))::integer,
    COALESCE(SUM(COALESCE(prt."primaryServiceCost", 0) + COALESCE(prt."secondaryServiceCost", 0)), 0)
  INTO parts_payload, total_parts, completed_parts, printing_parts, queued_parts, cost_total
  FROM public.parts prt
  WHERE prt."projectId" = v_project.id;

  IF COALESCE(v_project."needsPayment", true) = false THEN
    payment_state_label := 'NOT_REQUIRED';
  ELSIF COALESCE(nullif(trim(v_project."receiptNumber"), ''), '') <> '' THEN
    payment_state_label := 'RECEIPT_RECORDED';
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
    'currency', 'ZAR',
    'payment', jsonb_build_object(
      'needs_payment', COALESCE(v_project."needsPayment", true),
      'payment_state_label', payment_state_label,
      'receipt_number', NULLIF(trim(v_project."receiptNumber"), ''),
      'module_paid', NULL,
      'override_applied', NULL
    ),
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

REVOKE ALL ON FUNCTION public.transition_project_state(text, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.transition_part_status(text, uuid, text, text, text, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.transition_project_state(text, text, text, text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.transition_part_status(text, uuid, text, text, text, text) TO authenticated, service_role;
