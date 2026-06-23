-- Phase 1: Public tracking hardening
-- 1) Remove table-wide anon read access
-- 2) Expose a single, scoped SECURITY DEFINER RPC DTO for public tracking

DROP POLICY IF EXISTS "Allow public read access to projects" ON public.projects;
DROP POLICY IF EXISTS "Allow public read access to parts" ON public.parts;

REVOKE SELECT ON TABLE public.projects FROM anon;
REVOKE SELECT ON TABLE public.parts FROM anon;

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
              WHEN 'TO_BE_PRINTED' THEN 'Queued'
              WHEN 'PRINTING' THEN 'Printing'
              WHEN 'PRINTED' THEN 'Printed'
              WHEN 'COLLECTED' THEN 'Collected'
              WHEN 'POST_PROCESSING' THEN 'Finishing'
              WHEN 'FINISHED' THEN 'Finished'
              ELSE initcap(replace(prt."printStatus", '_', ' '))
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
    COUNT(*) FILTER (WHERE prt."printStatus" IN ('PRINTED', 'COLLECTED', 'POST_PROCESSING', 'FINISHED'))::integer,
    COUNT(*) FILTER (WHERE prt."printStatus" = 'PRINTING')::integer,
    COUNT(*) FILTER (WHERE prt."printStatus" = 'TO_BE_PRINTED')::integer,
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
      WHEN 'NEW' THEN 'Submitted'
      WHEN 'REVIEW' THEN 'Under review'
      WHEN 'CONFIRMATION' THEN 'Action needed'
      WHEN 'PRINTING' THEN 'In production'
      WHEN 'COLLECTION' THEN 'Ready to collect'
      WHEN 'COMPLETE' THEN 'Complete'
      WHEN 'ARCHIVED' THEN 'Archived'
      ELSE initcap(replace(v_project.state, '_', ' '))
    END;

  state_description :=
    CASE v_project.state
      WHEN 'NEW' THEN 'Your request has been received.'
      WHEN 'REVIEW' THEN 'MISC is checking files, material choices, and print details.'
      WHEN 'CONFIRMATION' THEN 'Please confirm the quote and settle any payment requirements.'
      WHEN 'PRINTING' THEN 'Your parts are in the print queue or currently printing.'
      WHEN 'COLLECTION' THEN 'Your project is ready at the MISC front desk.'
      WHEN 'COMPLETE' THEN 'This project has been collected and closed.'
      WHEN 'ARCHIVED' THEN 'This project has been archived by MISC.'
      ELSE format('Current status: %s', v_project.state)
    END;

  RETURN jsonb_build_object(
    'project_code', v_project.id,
    'collection_code',
      CASE
        WHEN v_project.state IN ('COLLECTION', 'COMPLETE') THEN v_project.id
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

REVOKE ALL ON FUNCTION public.get_public_project_status(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_project_status(text) TO anon, authenticated, service_role;
