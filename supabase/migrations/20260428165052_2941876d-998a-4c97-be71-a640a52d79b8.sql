CREATE POLICY "Public read ai-references"
ON storage.objects FOR SELECT
USING (bucket_id = 'ai-references');

CREATE POLICY "Anyone can upload ai-references"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'ai-references');

CREATE POLICY "Anyone can update ai-references"
ON storage.objects FOR UPDATE
USING (bucket_id = 'ai-references');

CREATE POLICY "Anyone can delete ai-references"
ON storage.objects FOR DELETE
USING (bucket_id = 'ai-references');