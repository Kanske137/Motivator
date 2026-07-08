-- Enable scheduling (pg_cron) + outbound HTTP (pg_net) so the daily
-- cleanup-previews edge function can be invoked on a schedule.
-- NOTE: the actual `cron.schedule(...)` call carries a shared secret header and
-- is therefore run out-of-band (not committed here). See cleanup-previews.
create extension if not exists pg_cron;
create extension if not exists pg_net;
