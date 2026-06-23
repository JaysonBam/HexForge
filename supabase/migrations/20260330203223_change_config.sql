drop policy "allow_authenticated_full_access_global_config" on "public"."global_config";

revoke delete on table "public"."global_config" from "anon";

revoke insert on table "public"."global_config" from "anon";

revoke references on table "public"."global_config" from "anon";

revoke select on table "public"."global_config" from "anon";

revoke trigger on table "public"."global_config" from "anon";

revoke truncate on table "public"."global_config" from "anon";

revoke update on table "public"."global_config" from "anon";

revoke delete on table "public"."global_config" from "authenticated";

revoke insert on table "public"."global_config" from "authenticated";

revoke references on table "public"."global_config" from "authenticated";

revoke select on table "public"."global_config" from "authenticated";

revoke trigger on table "public"."global_config" from "authenticated";

revoke truncate on table "public"."global_config" from "authenticated";

revoke update on table "public"."global_config" from "authenticated";

revoke delete on table "public"."global_config" from "service_role";

revoke insert on table "public"."global_config" from "service_role";

revoke references on table "public"."global_config" from "service_role";

revoke select on table "public"."global_config" from "service_role";

revoke trigger on table "public"."global_config" from "service_role";

revoke truncate on table "public"."global_config" from "service_role";

revoke update on table "public"."global_config" from "service_role";

alter table "public"."global_config" drop constraint "single_row";

alter table "public"."global_config" drop constraint "global_config_pkey";

drop index if exists "public"."global_config_pkey";

drop table "public"."global_config";


  create table "public"."config" (
    "key" text not null,
    "value" jsonb
      );


alter table "public"."config" enable row level security;

CREATE UNIQUE INDEX config_pkey ON public.config USING btree (key);

alter table "public"."config" add constraint "config_pkey" PRIMARY KEY using index "config_pkey";

grant delete on table "public"."config" to "anon";

grant insert on table "public"."config" to "anon";

grant references on table "public"."config" to "anon";

grant select on table "public"."config" to "anon";

grant trigger on table "public"."config" to "anon";

grant truncate on table "public"."config" to "anon";

grant update on table "public"."config" to "anon";

grant delete on table "public"."config" to "authenticated";

grant insert on table "public"."config" to "authenticated";

grant references on table "public"."config" to "authenticated";

grant select on table "public"."config" to "authenticated";

grant trigger on table "public"."config" to "authenticated";

grant truncate on table "public"."config" to "authenticated";

grant update on table "public"."config" to "authenticated";

grant delete on table "public"."config" to "service_role";

grant insert on table "public"."config" to "service_role";

grant references on table "public"."config" to "service_role";

grant select on table "public"."config" to "service_role";

grant trigger on table "public"."config" to "service_role";

grant truncate on table "public"."config" to "service_role";

grant update on table "public"."config" to "service_role";


  create policy "config_policy"
  on "public"."config"
  as permissive
  for all
  to authenticated
using (true);



