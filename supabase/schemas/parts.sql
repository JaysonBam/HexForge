create type public.part_status as enum (
  'DRAFT',
  'VERIFIED',
  'READY',
  'PRINTING',
  'PRINTED',
  'FAILED',
  'POST_PROCESSING',
  'COLLECTED'
);

create table public.parts (
  id uuid primary key default gen_random_uuid(),
  "projectId" text not null references public.projects(id) on delete cascade,
  "partNumber" integer not null default 1,
  "partName" text not null,
  "printerName" text,
  
  -- Material 1
  "primaryMaterial" text,
  "primaryBrand" text,
  "primaryFilamentSource" text not null default 'misc' check ("primaryFilamentSource" in ('misc', 'student_provided', 'module_provided')),
  "primaryOwnFilament" boolean default false,
  "primaryEstimatedWeight" numeric,
  "primaryWeight" numeric,
  "primaryMaterialCost" numeric,
  "primaryServiceCost" numeric,
  "primaryLength" numeric,
  
  -- Material 2
  "secondaryMaterial" text,
  "secondaryBrand" text,
  "secondaryFilamentSource" text not null default 'misc' check ("secondaryFilamentSource" in ('misc', 'student_provided', 'module_provided')),
  "secondaryOwnFilament" boolean default false,
  "secondaryEstimatedWeight" numeric,
  "secondaryWeight" numeric,
  "secondaryMaterialCost" numeric,
  "secondaryServiceCost" numeric,
  "secondaryLength" numeric,

  -- Image URL
  "imageUrl" text,

  "specialInstruction" text,

  "printingTime" text,
  
  expanded boolean default true,

  "checkedBy" text,
  "startedBy" text,
  "removedBy" text,
  "collectedBy" text,
  "collectedByStudentNumber" text,
  "collectedAt" timestamp with time zone,

  "printStatus" public.part_status not null default 'DRAFT'
);

alter table public.parts enable row level security;
CREATE POLICY allow_authenticated_full_access_parts
  ON public.parts
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

create or replace function public.set_part_collected_at()
returns trigger
language plpgsql
as $$
begin
  if new."printStatus" = 'COLLECTED'
    and old."printStatus" is distinct from 'COLLECTED'
    and new."collectedAt" is null then
    new."collectedAt" := timezone('utc'::text, now());
  end if;

  if new."printStatus" <> 'COLLECTED' then
    new."collectedAt" := null;
  end if;

  return new;
end;
$$;

create trigger set_part_collected_at_before_update
before update on public.parts
for each row
execute function public.set_part_collected_at();

CREATE OR REPLACE FUNCTION public.sync_part_filament_source_flags()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW."primaryFilamentSource" := lower(trim(COALESCE(NEW."primaryFilamentSource", '')));
  NEW."secondaryFilamentSource" := lower(trim(COALESCE(NEW."secondaryFilamentSource", '')));

  IF NEW."primaryFilamentSource" IS NULL OR trim(NEW."primaryFilamentSource") = '' THEN
    NEW."primaryFilamentSource" := CASE
      WHEN COALESCE(NEW."primaryOwnFilament", false) THEN 'student_provided'
      ELSE 'misc'
    END;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD."primaryOwnFilament" IS DISTINCT FROM NEW."primaryOwnFilament"
      AND OLD."primaryFilamentSource" IS NOT DISTINCT FROM NEW."primaryFilamentSource" THEN
      NEW."primaryFilamentSource" := CASE
        WHEN COALESCE(NEW."primaryOwnFilament", false) THEN 'student_provided'
        ELSE 'misc'
      END;
    END IF;
  END IF;

  IF NEW."secondaryFilamentSource" IS NULL OR trim(NEW."secondaryFilamentSource") = '' THEN
    NEW."secondaryFilamentSource" := CASE
      WHEN COALESCE(NEW."secondaryOwnFilament", false) THEN 'student_provided'
      ELSE 'misc'
    END;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD."secondaryOwnFilament" IS DISTINCT FROM NEW."secondaryOwnFilament"
      AND OLD."secondaryFilamentSource" IS NOT DISTINCT FROM NEW."secondaryFilamentSource" THEN
      NEW."secondaryFilamentSource" := CASE
        WHEN COALESCE(NEW."secondaryOwnFilament", false) THEN 'student_provided'
        ELSE 'misc'
      END;
    END IF;
  END IF;

  NEW."primaryOwnFilament" := NEW."primaryFilamentSource" <> 'misc';
  NEW."secondaryOwnFilament" := NEW."secondaryFilamentSource" <> 'misc';

  RETURN NEW;
END;
$$;

CREATE TRIGGER sync_part_filament_source_flags_trigger
BEFORE INSERT OR UPDATE ON public.parts
FOR EACH ROW
EXECUTE FUNCTION public.sync_part_filament_source_flags();
