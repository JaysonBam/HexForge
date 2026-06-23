create extension if not exists "pg_net" with schema "extensions";

alter table "public"."parts" add column "secondaryLength" numeric;

drop policy "Public Delete Access" on "storage"."objects";

drop policy "Public Read Access" on "storage"."objects";

drop policy "Public Update Access" on "storage"."objects";

drop policy "Public Upload Access" on "storage"."objects";


