-- Restore public access policies for the Thumbnails bucket

DROP POLICY IF EXISTS "Public Read Access" ON storage.objects;
DROP POLICY IF EXISTS "Public Upload Access" ON storage.objects;
DROP POLICY IF EXISTS "Public Update Access" ON storage.objects;
DROP POLICY IF EXISTS "Public Delete Access" ON storage.objects;

-- Allow public read access for the Thumbnails bucket (case-insensitive)
CREATE POLICY "Public Read Access"
ON storage.objects FOR SELECT
USING (lower(bucket_id) = 'thumbnails');

-- Allow public upload access for the Thumbnails bucket (case-insensitive)
CREATE POLICY "Public Upload Access"
ON storage.objects FOR INSERT
WITH CHECK (lower(bucket_id) = 'thumbnails');

-- Allow public update access for the Thumbnails bucket (case-insensitive)
CREATE POLICY "Public Update Access"
ON storage.objects FOR UPDATE
USING (lower(bucket_id) = 'thumbnails');

-- Allow public delete access for the Thumbnails bucket (case-insensitive)
CREATE POLICY "Public Delete Access"
ON storage.objects FOR DELETE
USING (lower(bucket_id) = 'thumbnails');
