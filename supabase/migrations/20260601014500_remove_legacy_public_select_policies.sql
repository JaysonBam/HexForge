-- Remove legacy public-read policies that were created under different names.
DROP POLICY IF EXISTS "Allow public SELECT on parts" ON public.parts;
DROP POLICY IF EXISTS "Allow public SELECT on projects" ON public.projects;

-- Harden table privileges for anonymous clients.
REVOKE ALL PRIVILEGES ON TABLE public.parts FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.projects FROM anon;
