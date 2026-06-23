alter table "public"."parts" drop constraint "parts_project_id_fkey";

alter table "public"."parts" drop constraint "parts_pkey";

alter table "public"."projects" drop constraint "projects_pkey";

drop index if exists "public"."parts_pkey";

drop index if exists "public"."projects_pkey";

alter table "public"."parts" drop column "brand_1";

alter table "public"."parts" drop column "brand_2";

alter table "public"."parts" drop column "checked_by";

alter table "public"."parts" drop column "created_at";

alter table "public"."parts" drop column "length_1";

alter table "public"."parts" drop column "length_2";

alter table "public"."parts" drop column "material_cost_1";

alter table "public"."parts" drop column "material_cost_2";

alter table "public"."parts" drop column "moved_by";

alter table "public"."parts" drop column "own_material_1";

alter table "public"."parts" drop column "own_material_2";

alter table "public"."parts" drop column "part_id";

alter table "public"."parts" drop column "part_name";

alter table "public"."parts" drop column "printed_by";

alter table "public"."parts" drop column "printer_name";

alter table "public"."parts" drop column "printing_time";

alter table "public"."parts" drop column "project_id";

alter table "public"."parts" drop column "service_cost_1";

alter table "public"."parts" drop column "service_cost_2";

alter table "public"."parts" drop column "state";

alter table "public"."parts" drop column "type_1";

alter table "public"."parts" drop column "type_2";

alter table "public"."parts" drop column "weight_1";

alter table "public"."parts" drop column "weight_2";

alter table "public"."parts" add column "brand" text;

alter table "public"."parts" add column "checkedBy" text;

alter table "public"."parts" add column "collectedBy" text;

alter table "public"."parts" add column "estimatedWeight" numeric;

alter table "public"."parts" add column "expanded" boolean default true;

alter table "public"."parts" add column "id" uuid not null default gen_random_uuid();

alter table "public"."parts" add column "length" numeric;

alter table "public"."parts" add column "materialCost" numeric;

alter table "public"."parts" add column "ownFilament" boolean default false;

alter table "public"."parts" add column "partName" text not null;

alter table "public"."parts" add column "partNumber" integer not null default 1;

alter table "public"."parts" add column "primaryMaterial" text;

alter table "public"."parts" add column "printStatus" text not null default 'TO_BE_PRINTED'::text;

alter table "public"."parts" add column "printerName" text;

alter table "public"."parts" add column "printingTime" text;

alter table "public"."parts" add column "projectId" uuid not null;

alter table "public"."parts" add column "removedBy" text;

alter table "public"."parts" add column "secondaryBrand" text;

alter table "public"."parts" add column "secondaryMaterial" text;

alter table "public"."parts" add column "secondaryOwnFilament" boolean default false;

alter table "public"."parts" add column "serviceCost" numeric;

alter table "public"."parts" add column "specialInstruction" text;

alter table "public"."parts" add column "startedBy" text;

alter table "public"."parts" add column "useSupport" boolean default false;

alter table "public"."parts" add column "weight" numeric;

alter table "public"."projects" drop column "archive";

alter table "public"."projects" drop column "created_at";

alter table "public"."projects" drop column "module_code";

alter table "public"."projects" drop column "priority_number";

alter table "public"."projects" drop column "project_id";

alter table "public"."projects" drop column "receipt_needed";

alter table "public"."projects" drop column "receipt_number";

alter table "public"."projects" drop column "student_name";

alter table "public"."projects" drop column "student_number";

alter table "public"."projects" drop column "supervisor_name";

alter table "public"."projects" add column "archived" boolean not null default false;

alter table "public"."projects" add column "course" text;

alter table "public"."projects" add column "createdAt" text not null;

alter table "public"."projects" add column "id" uuid not null default gen_random_uuid();

alter table "public"."projects" add column "lecturer" text;

alter table "public"."projects" add column "priorityNumber" integer not null default 0;

alter table "public"."projects" add column "studentName" text not null;

alter table "public"."projects" add column "studentNumber" text not null;

alter table "public"."projects" alter column "state" drop default;

alter table "public"."projects" alter column "state" set data type text using "state"::text;

alter table "public"."projects" alter column "state" set default 'NEW'::text;

drop type "public"."part_state";

drop type "public"."project_state";

CREATE UNIQUE INDEX parts_pkey ON public.parts USING btree (id);

CREATE UNIQUE INDEX projects_pkey ON public.projects USING btree (id);

alter table "public"."parts" add constraint "parts_pkey" PRIMARY KEY using index "parts_pkey";

alter table "public"."projects" add constraint "projects_pkey" PRIMARY KEY using index "projects_pkey";

alter table "public"."parts" add constraint "parts_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES public.projects(id) ON DELETE CASCADE not valid;

alter table "public"."parts" validate constraint "parts_projectId_fkey";


