-- Enable public read access for the Thumbnails bucket
CREATE POLICY "Public Read Access"
ON storage.objects FOR SELECT
USING (bucket_id = 'Thumbnails');

-- Enable public upload access for the Thumbnails bucket
CREATE POLICY "Public Upload Access"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'Thumbnails');

-- Enable public update access for the Thumbnails bucket
CREATE POLICY "Public Update Access"
ON storage.objects FOR UPDATE
USING (bucket_id = 'Thumbnails');

-- Enable public delete access for the Thumbnails bucket
CREATE POLICY "Public Delete Access"
ON storage.objects FOR DELETE
USING (bucket_id = 'Thumbnails');