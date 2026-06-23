-- Phase 4: Global queue operations surface + additive print run support.
-- This migration is intentionally additive so phase 1-3 behavior remains unchanged.

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

ALTER TABLE public.print_runs
  ADD COLUMN IF NOT EXISTS machine_id text;

CREATE INDEX IF NOT EXISTS idx_print_runs_machine_id
  ON public.print_runs (machine_id)
  WHERE machine_id IS NOT NULL;

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

REVOKE ALL ON FUNCTION public.get_global_queue() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_global_queue() TO authenticated;
