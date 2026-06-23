create type "public"."part_state" as enum ('in review', 'to be printed', 'printing', 'printed', 'connected');

create type "public"."project_state" as enum ('review', 'confirmation', 'print', 'completed');


  create table "public"."global_config" (
    "config_id" integer not null default 1,
    "latest_priority" integer not null default 0,
    "staff_names" text[] not null default '{}'::text[],
    "printer_names" text[] not null default '{}'::text[]
      );


alter table "public"."global_config" enable row level security;


  create table "public"."parts" (
    "part_id" uuid not null default gen_random_uuid(),
    "project_id" character varying(5) not null,
    "part_name" text not null,
    "printing_time" numeric,
    "checked_by" text,
    "printed_by" text,
    "moved_by" text,
    "printer_name" text,
    "state" public.part_state not null default 'in review'::public.part_state,
    "type_1" text,
    "brand_1" text,
    "own_material_1" boolean default false,
    "weight_1" numeric,
    "length_1" numeric,
    "service_cost_1" numeric,
    "material_cost_1" numeric,
    "type_2" text,
    "brand_2" text,
    "own_material_2" boolean default false,
    "weight_2" numeric,
    "length_2" numeric,
    "service_cost_2" numeric,
    "material_cost_2" numeric,
    "created_at" timestamp with time zone not null default timezone('utc'::text, now())
      );


alter table "public"."parts" enable row level security;


  create table "public"."projects" (
    "project_id" character varying(5) not null,
    "priority_number" integer not null,
    "student_number" text not null,
    "student_name" text not null,
    "module_code" text,
    "supervisor_name" text,
    "receipt_needed" boolean not null default false,
    "receipt_number" text,
    "state" public.project_state not null default 'review'::public.project_state,
    "archive" boolean not null default false,
    "created_at" timestamp with time zone not null default timezone('utc'::text, now())
      );


alter table "public"."projects" enable row level security;


  create table "public"."vendors" (
    "vendor_id" uuid not null default gen_random_uuid(),
    "filament_type" text not null,
    "vendor_name" text not null,
    "price" numeric not null,
    "price_per_gram" numeric not null,
    "created_at" timestamp with time zone not null default timezone('utc'::text, now())
      );


alter table "public"."vendors" enable row level security;

CREATE UNIQUE INDEX global_config_pkey ON public.global_config USING btree (config_id);

CREATE UNIQUE INDEX parts_pkey ON public.parts USING btree (part_id);

CREATE UNIQUE INDEX projects_pkey ON public.projects USING btree (project_id);

CREATE UNIQUE INDEX vendors_pkey ON public.vendors USING btree (vendor_id);

alter table "public"."global_config" add constraint "global_config_pkey" PRIMARY KEY using index "global_config_pkey";

alter table "public"."parts" add constraint "parts_pkey" PRIMARY KEY using index "parts_pkey";

alter table "public"."projects" add constraint "projects_pkey" PRIMARY KEY using index "projects_pkey";

alter table "public"."vendors" add constraint "vendors_pkey" PRIMARY KEY using index "vendors_pkey";

alter table "public"."global_config" add constraint "single_row" CHECK ((config_id = 1)) not valid;

alter table "public"."global_config" validate constraint "single_row";

alter table "public"."parts" add constraint "parts_project_id_fkey" FOREIGN KEY (project_id) REFERENCES public.projects(project_id) ON DELETE CASCADE not valid;

alter table "public"."parts" validate constraint "parts_project_id_fkey";

grant delete on table "public"."global_config" to "anon";

grant insert on table "public"."global_config" to "anon";

grant references on table "public"."global_config" to "anon";

grant select on table "public"."global_config" to "anon";

grant trigger on table "public"."global_config" to "anon";

grant truncate on table "public"."global_config" to "anon";

grant update on table "public"."global_config" to "anon";

grant delete on table "public"."global_config" to "authenticated";

grant insert on table "public"."global_config" to "authenticated";

grant references on table "public"."global_config" to "authenticated";

grant select on table "public"."global_config" to "authenticated";

grant trigger on table "public"."global_config" to "authenticated";

grant truncate on table "public"."global_config" to "authenticated";

grant update on table "public"."global_config" to "authenticated";

grant delete on table "public"."global_config" to "service_role";

grant insert on table "public"."global_config" to "service_role";

grant references on table "public"."global_config" to "service_role";

grant select on table "public"."global_config" to "service_role";

grant trigger on table "public"."global_config" to "service_role";

grant truncate on table "public"."global_config" to "service_role";

grant update on table "public"."global_config" to "service_role";

grant delete on table "public"."parts" to "anon";

grant insert on table "public"."parts" to "anon";

grant references on table "public"."parts" to "anon";

grant select on table "public"."parts" to "anon";

grant trigger on table "public"."parts" to "anon";

grant truncate on table "public"."parts" to "anon";

grant update on table "public"."parts" to "anon";

grant delete on table "public"."parts" to "authenticated";

grant insert on table "public"."parts" to "authenticated";

grant references on table "public"."parts" to "authenticated";

grant select on table "public"."parts" to "authenticated";

grant trigger on table "public"."parts" to "authenticated";

grant truncate on table "public"."parts" to "authenticated";

grant update on table "public"."parts" to "authenticated";

grant delete on table "public"."parts" to "service_role";

grant insert on table "public"."parts" to "service_role";

grant references on table "public"."parts" to "service_role";

grant select on table "public"."parts" to "service_role";

grant trigger on table "public"."parts" to "service_role";

grant truncate on table "public"."parts" to "service_role";

grant update on table "public"."parts" to "service_role";

grant delete on table "public"."projects" to "anon";

grant insert on table "public"."projects" to "anon";

grant references on table "public"."projects" to "anon";

grant select on table "public"."projects" to "anon";

grant trigger on table "public"."projects" to "anon";

grant truncate on table "public"."projects" to "anon";

grant update on table "public"."projects" to "anon";

grant delete on table "public"."projects" to "authenticated";

grant insert on table "public"."projects" to "authenticated";

grant references on table "public"."projects" to "authenticated";

grant select on table "public"."projects" to "authenticated";

grant trigger on table "public"."projects" to "authenticated";

grant truncate on table "public"."projects" to "authenticated";

grant update on table "public"."projects" to "authenticated";

grant delete on table "public"."projects" to "service_role";

grant insert on table "public"."projects" to "service_role";

grant references on table "public"."projects" to "service_role";

grant select on table "public"."projects" to "service_role";

grant trigger on table "public"."projects" to "service_role";

grant truncate on table "public"."projects" to "service_role";

grant update on table "public"."projects" to "service_role";

grant delete on table "public"."vendors" to "anon";

grant insert on table "public"."vendors" to "anon";

grant references on table "public"."vendors" to "anon";

grant select on table "public"."vendors" to "anon";

grant trigger on table "public"."vendors" to "anon";

grant truncate on table "public"."vendors" to "anon";

grant update on table "public"."vendors" to "anon";

grant delete on table "public"."vendors" to "authenticated";

grant insert on table "public"."vendors" to "authenticated";

grant references on table "public"."vendors" to "authenticated";

grant select on table "public"."vendors" to "authenticated";

grant trigger on table "public"."vendors" to "authenticated";

grant truncate on table "public"."vendors" to "authenticated";

grant update on table "public"."vendors" to "authenticated";

grant delete on table "public"."vendors" to "service_role";

grant insert on table "public"."vendors" to "service_role";

grant references on table "public"."vendors" to "service_role";

grant select on table "public"."vendors" to "service_role";

grant trigger on table "public"."vendors" to "service_role";

grant truncate on table "public"."vendors" to "service_role";

grant update on table "public"."vendors" to "service_role";


  create policy "allow_authenticated_full_access_global_config"
  on "public"."global_config"
  as permissive
  for all
  to authenticated
using (true)
with check (true);



  create policy "allow_authenticated_full_access_parts"
  on "public"."parts"
  as permissive
  for all
  to authenticated
using (true)
with check (true);



  create policy "allow_authenticated_full_access_projects"
  on "public"."projects"
  as permissive
  for all
  to authenticated
using (true)
with check (true);



  create policy "allow_authenticated_full_access_vendors"
  on "public"."vendors"
  as permissive
  for all
  to authenticated
using (true)
with check (true);



