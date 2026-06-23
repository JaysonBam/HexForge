-- Public-read assets used inside outbound email signatures.
INSERT INTO storage.buckets (id, name, public)
VALUES ('email-assets', 'email-assets', true)
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public;

DROP POLICY IF EXISTS "Email Assets Public Read" ON storage.objects;
DROP POLICY IF EXISTS "Email Assets Authenticated Upload" ON storage.objects;
DROP POLICY IF EXISTS "Email Assets Authenticated Update" ON storage.objects;
DROP POLICY IF EXISTS "Email Assets Authenticated Delete" ON storage.objects;

CREATE POLICY "Email Assets Public Read"
ON storage.objects FOR SELECT
USING (bucket_id = 'email-assets');

CREATE POLICY "Email Assets Authenticated Upload"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'email-assets' AND auth.role() = 'authenticated');

CREATE POLICY "Email Assets Authenticated Update"
ON storage.objects FOR UPDATE
USING (bucket_id = 'email-assets' AND auth.role() = 'authenticated')
WITH CHECK (bucket_id = 'email-assets' AND auth.role() = 'authenticated');

CREATE POLICY "Email Assets Authenticated Delete"
ON storage.objects FOR DELETE
USING (bucket_id = 'email-assets' AND auth.role() = 'authenticated');
