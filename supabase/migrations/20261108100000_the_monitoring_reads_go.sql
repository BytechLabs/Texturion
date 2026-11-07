-- D146: the four reads that only fed our own monitoring go.
--
-- api_telnyx_spend_since and api_voice_capacity_read fed the Telnyx spend and
-- concurrent-call gauges, api_fleet_stored_bytes fed the storage gauge, and
-- api_dispute_health had no caller at all. Telnyx enforces its own daily spend
-- limits and emails the account when one is reached, Supabase's Usage page
-- shows storage, and the Stripe Dashboard shows disputes, so nothing here has
-- a reader left.
--
-- Until the Worker deployed right after this migration is live, the old
-- Worker's hourly spend gauge fails its cron run and its usage-alerts job
-- reports the storage read as an exception. Both are only reported.

drop function public.api_telnyx_spend_since(timestamptz, timestamptz);
drop function public.api_voice_capacity_read();
drop function public.api_fleet_stored_bytes();
drop function public.api_dispute_health(timestamptz, int);
