-- #380: AI is metered per company per feature and was absent from the "is this
-- tenant costing us more than they pay" model. Every ingredient already existed
-- in company_ai_usage; what was missing was a reader and a price.
--
-- PERIOD MISMATCH, stated plainly: company_ai_usage buckets by CALENDAR MONTH
-- ('YYYY-MM'), because that is what the caps reset on. Billing periods do not
-- align with calendar months. This reader therefore sums every month the
-- billing period TOUCHES, which slightly OVER-counts at both boundaries (it
-- includes days of the first month that fall before p_since).
--
-- That direction is deliberate and matches costs.ts: a never-lose-money model
-- must not under-count. Attributing exactly would need a per-request ledger
-- rather than a monthly counter, which is a bigger change than the question
-- warrants — at current volumes the whole AI line is cents.
create or replace function public.api_period_ai_requests(
  p_company_id uuid,
  p_since      timestamptz
) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    jsonb_object_agg(t.feature, t.requests),
    '{}'::jsonb
  )
  from (
    select u.feature, sum(u.request_count)::bigint as requests
      from public.company_ai_usage u
     where u.company_id = p_company_id
       -- Every calendar month from the one containing p_since to the current
       -- one, compared as 'YYYY-MM' text (the column's own format).
       and u.period >= to_char(p_since at time zone 'utc', 'YYYY-MM')
       and u.period <= to_char(now() at time zone 'utc', 'YYYY-MM')
     group by u.feature
  ) t
$$;

revoke execute on function public.api_period_ai_requests(uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.api_period_ai_requests(uuid, timestamptz)
  to service_role;
