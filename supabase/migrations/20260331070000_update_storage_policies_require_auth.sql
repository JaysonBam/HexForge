-- Restrict upload/update/delete on Thumbnails bucket to authenticated users

DROP POLICY IF EXISTS "Public Read Access" ON storage.objects;
DROP POLICY IF EXISTS "Public Upload Access" ON storage.objects;
DROP POLICY IF EXISTS "Public Update Access" ON storage.objects;
DROP POLICY IF EXISTS "Public Delete Access" ON storage.objects;

-- Public read remains open for Thumbnails
CREATE POLICY "Public Read Access"
ON storage.objects FOR SELECT
USING (lower(bucket_id) = 'thumbnails');

-- Only authenticated users can INSERT into Thumbnails
CREATE POLICY "Authenticated Upload Access"
ON storage.objects FOR INSERT
WITH CHECK (lower(bucket_id) = 'thumbnails' AND auth.role() = 'authenticated');

-- Only authenticated users can UPDATE objects in Thumbnails
CREATE POLICY "Authenticated Update Access"
ON storage.objects FOR UPDATE
USING (lower(bucket_id) = 'thumbnails' AND auth.role() = 'authenticated');

-- Only authenticated users can DELETE objects in Thumbnails
CREATE POLICY "Authenticated Delete Access"
ON storage.objects FOR DELETE
USING (lower(bucket_id) = 'thumbnails' AND auth.role() = 'authenticated');
