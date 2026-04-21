-- Public bucket for cart preview images (the customer's exact editor render
-- shown as the line-item thumbnail in Shopify cart).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('cart-previews', 'cart-previews', true, 5242880, ARRAY['image/png','image/jpeg','image/webp'])
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Public read
DROP POLICY IF EXISTS "cart-previews public read" ON storage.objects;
CREATE POLICY "cart-previews public read"
ON storage.objects FOR SELECT
USING (bucket_id = 'cart-previews');

-- Public insert (anyone may upload — files are randomly named UUIDs)
DROP POLICY IF EXISTS "cart-previews public insert" ON storage.objects;
CREATE POLICY "cart-previews public insert"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'cart-previews');