ALTER TABLE "public"."parts" DROP CONSTRAINT "parts_projectId_fkey";

ALTER TABLE "public"."projects" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "public"."projects" ALTER COLUMN "id" TYPE text USING substring(id::text from 1 for 5);

ALTER TABLE "public"."parts" ALTER COLUMN "projectId" TYPE text USING substring("projectId"::text from 1 for 5);

ALTER TABLE "public"."parts" ADD CONSTRAINT "parts_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES public.projects(id) ON DELETE CASCADE;
