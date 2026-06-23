drop extension if exists "pg_net";

alter table "public"."parts" add column "secondaryEstimatedWeight" numeric;


