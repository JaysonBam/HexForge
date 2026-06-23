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
  v_provided_filament_price_per_gram numeric := 1;
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
