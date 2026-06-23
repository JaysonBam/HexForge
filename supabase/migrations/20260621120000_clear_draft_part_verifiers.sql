-- Draft parts are not verified, so they must not retain a verifier name.
UPDATE public.parts
SET "checkedBy" = NULL
WHERE "printStatus" = 'DRAFT'
  AND NULLIF(trim(coalesce("checkedBy", '')), '') IS NOT NULL;
