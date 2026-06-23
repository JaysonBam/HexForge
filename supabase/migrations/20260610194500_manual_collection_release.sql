-- Keep completed projects in production until staff explicitly release them to collection.
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
