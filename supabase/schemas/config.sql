CREATE TABLE public.config (key TEXT PRIMARY KEY, value JSONB);
ALTER TABLE public.config ENABLE ROW LEVEL SECURITY;
CREATE POLICY config_policy ON public.config FOR ALL TO authenticated USING (true);
