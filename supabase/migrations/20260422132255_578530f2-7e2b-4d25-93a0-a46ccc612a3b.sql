-- TODO: When admin auth is in place, restrict these to has_role(auth.uid(), 'admin').
-- For now they are open so the admin designer can write without auth.
CREATE POLICY "Anyone can insert product configs (TODO admin auth)"
ON public.product_configs
FOR INSERT
WITH CHECK (true);

CREATE POLICY "Anyone can update product configs (TODO admin auth)"
ON public.product_configs
FOR UPDATE
USING (true)
WITH CHECK (true);