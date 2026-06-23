-- Patch: keep ISSUE_QUOTE in quote/payment states until explicit MOVE_TO_PRINTING

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
