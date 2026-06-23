-- Phase 3: Quote snapshots + payment state hardening

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS "moduleOrLecturerPays" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "paymentNote" text,
  ADD COLUMN IF NOT EXISTS "paymentOverrideNote" text;

CREATE TABLE IF NOT EXISTS public.project_cost_snapshots (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id text NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  snapshot_version integer NOT NULL,
  status text NOT NULL CHECK (status IN ('ISSUED', 'SUPERSEDED')),
  currency text NOT NULL DEFAULT 'ZAR',
  total_cost numeric NOT NULL DEFAULT 0,
  line_summary jsonb NOT NULL DEFAULT '[]'::jsonb,
  generated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  generated_by_user_id uuid,
  generated_by_email text,
  generated_by_technician text NOT NULL,
  superseded_at timestamptz,
  superseded_by_user_id uuid,
  superseded_by_email text,
  superseded_by_technician text,
  superseded_reason text
);

ALTER TABLE public.project_cost_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS project_cost_snapshots_select_authenticated ON public.project_cost_snapshots;
CREATE POLICY project_cost_snapshots_select_authenticated
ON public.project_cost_snapshots
FOR SELECT
TO authenticated
USING (true);

CREATE INDEX IF NOT EXISTS idx_project_cost_snapshots_project_version
  ON public.project_cost_snapshots (project_id, snapshot_version DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_project_cost_snapshots_project_version
  ON public.project_cost_snapshots (project_id, snapshot_version);

CREATE UNIQUE INDEX IF NOT EXISTS uq_project_cost_snapshots_active_issued
  ON public.project_cost_snapshots (project_id)
  WHERE status = 'ISSUED';

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

DROP TRIGGER IF EXISTS trg_guard_project_cost_snapshot_updates ON public.project_cost_snapshots;
DROP TRIGGER IF EXISTS trg_prevent_project_cost_snapshot_delete ON public.project_cost_snapshots;

CREATE TRIGGER trg_guard_project_cost_snapshot_updates
BEFORE UPDATE ON public.project_cost_snapshots
FOR EACH ROW
EXECUTE FUNCTION public.guard_project_cost_snapshot_updates();

CREATE TRIGGER trg_prevent_project_cost_snapshot_delete
BEFORE DELETE ON public.project_cost_snapshots
FOR EACH ROW
EXECUTE FUNCTION public.prevent_project_cost_snapshot_delete();

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
      SELECT *
      FROM (
        VALUES
          (
            'primary'::text,
            NULLIF(trim(prt."primaryMaterial"), ''),
            COALESCE(prt."primaryEstimatedWeight", 0)::numeric,
            COALESCE(prt."primaryServiceCost", 0)::numeric
          ),
          (
            'secondary'::text,
            NULLIF(trim(prt."secondaryMaterial"), ''),
            COALESCE(prt."secondaryEstimatedWeight", 0)::numeric,
            COALESCE(prt."secondaryServiceCost", 0)::numeric
          )
      ) AS material_rows(slot, material, grams, cost)
      WHERE material_rows.material IS NOT NULL
         OR material_rows.grams <> 0
         OR material_rows.cost <> 0
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
  v_total_parts integer := 0;
  v_review_ready_parts integer := 0;
  v_printing_or_waiting_parts integer := 0;
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
      IF v_payment_ok THEN
        v_to_state := 'QUOTE';
      ELSE
        v_to_state := 'AWAITING_PAYMENT';
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
      v_errors := array_append(v_errors, 'Payment gate not satisfied. Add receipt, mark module/lecturer-paid, or provide an override note.');
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
      'superseded_snapshots', v_superseded_snapshots
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'action', v_action,
    'from_state', v_from_state,
    'to_state', v_to_state,
    'project_id', v_project.id,
    'quote_snapshot', v_quote_snapshot
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
      IF NOT public.payment_gate_satisfied(
        v_project."needsPayment",
        v_project."receiptNumber",
        v_project."moduleOrLecturerPays",
        v_project."paymentOverrideNote"
      ) THEN
        v_errors := array_append(v_errors, 'Payment gate not satisfied. Record receipt, mark module/lecturer payment, or add an override note before collection.');
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
