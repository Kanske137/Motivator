-- Public bucket for admin-curated AI face-swap reference images.
-- Public SELECT so the customer editor + edge function can fetch them; only
-- authenticated users (admins) may write.
INSERT INTO storage.buckets (id, name, public)
VALUES ('ai-references', 'ai-references', true)
ON CONFLICT (id) DO NOTHING;

-- Public read.
CREATE POLICY "ai-references public read"
ON storage.objects FOR SELECT
USING (bucket_id = 'ai-references');

-- Authenticated write/update/delete.
CREATE POLICY "ai-references authenticated insert"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'ai-references');

CREATE POLICY "ai-references authenticated update"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'ai-references');

CREATE POLICY "ai-references authenticated delete"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'ai-references');