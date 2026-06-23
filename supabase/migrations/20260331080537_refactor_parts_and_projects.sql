alter table "public"."parts" drop column "brand";

alter table "public"."parts" drop column "estimatedWeight";

alter table "public"."parts" drop column "length";

alter table "public"."parts" drop column "materialCost";

alter table "public"."parts" drop column "ownFilament";

alter table "public"."parts" drop column "serviceCost";

alter table "public"."parts" drop column "useSupport";

alter table "public"."parts" drop column "weight";

alter table "public"."parts" add column "primaryBrand" text;

alter table "public"."parts" add column "primaryEstimatedWeight" numeric;

alter table "public"."parts" add column "primaryLength" numeric;

alter table "public"."parts" add column "primaryMaterialCost" numeric;

alter table "public"."parts" add column "primaryOwnFilament" boolean default false;

alter table "public"."parts" add column "primaryServiceCost" numeric;

alter table "public"."parts" add column "primaryWeight" numeric;

alter table "public"."projects" add column "invoiceNumber" text;

alter table "public"."projects" add column "needsPayment" boolean not null default false;




