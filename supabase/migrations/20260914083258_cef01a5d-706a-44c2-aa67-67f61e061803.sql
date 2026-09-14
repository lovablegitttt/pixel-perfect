REVOKE ALL ON FUNCTION public.create_screenshotguru_account() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_screenshotguru_account() TO service_role;
CREATE POLICY "Payment events are server only" ON public.payment_events FOR ALL TO authenticated USING (false) WITH CHECK (false);