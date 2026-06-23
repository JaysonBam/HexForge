-- Allow quote snapshots to be deleted only when a project delete cascades.
-- Direct snapshot deletes remain blocked.
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

