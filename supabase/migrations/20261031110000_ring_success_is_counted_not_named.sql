-- D142 P01: how often a ring push becomes a ring on the device, per platform
-- and app version, judged against the same platform's own recent history.
--
-- Read hourly by apps/api/src/observability/ring-success.ts, which alerts
-- ['ops','ring-success-<platform>'] on a 'drop'. Counts only: the function
-- returns platforms, versions, counts, rates and a verdict, never a member, a
-- workspace, a session id or a device.
--
-- WHAT IS COUNTED. One ring push (`push_attempts`, purpose 'ring') is one
-- attempt. It succeeded when the device it went to reported `ringing_shown`
-- (`ring_beacons`) within 15 seconds of the push leaving. The push left at
-- `attempted_at - latency_ms`: the row is written after the fan-out returns,
-- so `attempted_at` alone would give a slow push extra time. The beacon's time
-- is the device's own clock where the route kept it, and arrival otherwise.
--
-- WHICH DEVICE. A push names its channel row; that row names the auth session
-- it was registered from, and a beacon names the auth session that posted it.
-- Where both are known they must match, so a member's tablet ringing does not
-- count for the push sent to their phone. Where either is unknown (a channel
-- registered before sessions were recorded) the member's beacon on the same
-- platform for the same call counts.
--
-- WHICH VERSION. The version the device reported while handling this ring,
-- else the version its session last sent the API, else 'unknown'. A push
-- that produced no beacon at all usually lands in 'unknown'.
--
-- 'GONE' IS NOT AN ATTEMPT. The provider said the channel no longer exists
-- and the fan-out deleted it. There was no device to ring, and counting it
-- would charge a stale registration to whichever bucket it fell in.
--
-- WINDOW AND BASELINE. The window is the 24 hours ending a minute ago, so a
-- push from the last minute has had its 15 seconds and its beacon time to
-- land. The baseline is the same platform, all versions, over the 7 days
-- before the window. Both fit inside the 14 days the evidence is kept.
--
-- THE VERDICT.
--   insufficient_sample  fewer than 30 attempts in the window. Never a pass.
--   no_baseline          30 or more, but the platform has fewer than 30
--                        attempts in the baseline: nothing to compare with.
--   drop                 the window's rate is below the baseline rate minus
--                        max(5 points, 3 standard errors at the window's n).
--   pass                 otherwise.
-- Three standard errors, one-sided, is crossed by chance about once in 700
-- independent windows at an unchanged rate. The hourly reads of one 24-hour
-- window are not independent, so that is about once in two years per version.
-- The 5-point floor keeps a large sample from alarming on a drop nobody would
-- act on. At n = 30 and a 90% baseline the margin is 16 points, which is what
-- 30 rings can honestly show.
--
-- MEDIA. "Share of answered sessions with media" is not computable yet: no
-- table records whether audio flowed on an answered call. `answered_sessions`
-- is the count it would be a share of; ring-success.ts reports media as not
-- measured.

create or replace function public.api_ring_success(p_now timestamptz default now())
returns table (
  platform          text,
  app_version       text,
  attempts          int,
  rang_in_time      int,
  ring_rate         numeric,
  baseline_attempts int,
  baseline_rate     numeric,
  threshold         numeric,
  answered_sessions int,
  verdict           text
)
language sql
stable
set search_path = ''
as $$
  with bounds as (
    select p_now - interval '1 minute'                                     as window_end,
           p_now - interval '1 minute' - interval '24 hours'               as window_start,
           p_now - interval '1 minute' - interval '24 hours' - interval '7 days' as baseline_start
  ),
  ring_pushes as (
    select pa.platform                                          as push_platform,
           pa.attempted_at                                      as pushed_at,
           coalesce(seen.first_version, us.app_version, 'unknown') as push_version,
           seen.rang                                            as rang
      from bounds bd
      join public.push_attempts pa
        on pa.attempted_at > bd.baseline_start
       and pa.attempted_at <= bd.window_end
      left join public.device_push_tokens dpt
        on pa.channel = 'fcm' and dpt.id = pa.target_id
      left join public.push_subscriptions ps
        on pa.channel = 'webpush' and ps.id = pa.target_id
      left join public.user_sessions us
        on us.session_id = coalesce(dpt.session_id, ps.session_id)
      cross join lateral (
        select (array_agg(b.app_version order by b.created_at)
                  filter (where b.app_version is not null))[1] as first_version,
               coalesce(bool_or(
                 b.stage = 'ringing_shown'
                 and coalesce(b.occurred_at, b.created_at)
                     <= pa.attempted_at - pa.latency_ms * interval '1 millisecond'
                        + interval '15 seconds'), false)        as rang
          from public.ring_beacons b
         where b.call_session_id = pa.call_session_id
           and b.company_id = pa.company_id
           and b.user_id = pa.user_id
           and b.platform = pa.platform
           and (coalesce(dpt.session_id, ps.session_id) is null
                or b.auth_session_id is null
                or b.auth_session_id = coalesce(dpt.session_id, ps.session_id))
      ) seen
     where pa.purpose = 'ring'
       and pa.call_session_id is not null
       and pa.response_class <> 'gone'
  ),
  windowed as (
    select rp.push_platform                       as w_platform,
           rp.push_version                        as w_version,
           count(*)::int                          as w_attempts,
           count(*) filter (where rp.rang)::int   as w_rang
      from ring_pushes rp, bounds bd
     where rp.pushed_at > bd.window_start
     group by 1, 2
  ),
  baseline as (
    select rp.push_platform                       as b_platform,
           count(*)::int                          as b_attempts,
           count(*) filter (where rp.rang)::int   as b_rang
      from ring_pushes rp, bounds bd
     where rp.pushed_at <= bd.window_start
     group by 1
  ),
  answered as (
    select b.platform                                         as a_platform,
           coalesce(b.app_version, 'unknown')                 as a_version,
           count(distinct (b.call_session_id, b.user_id))::int as a_sessions
      from public.ring_beacons b, bounds bd
     where b.stage = 'answered'
       and b.created_at > bd.window_start
       and b.created_at <= bd.window_end
     group by 1, 2
  ),
  rates as (
    select coalesce(w.w_platform, a.a_platform)              as r_platform,
           coalesce(w.w_version, a.a_version)                as r_version,
           coalesce(w.w_attempts, 0)                         as r_attempts,
           coalesce(w.w_rang, 0)                             as r_rang,
           case when w.w_attempts > 0
                then w.w_rang::numeric / w.w_attempts end    as r_rate,
           coalesce(bl.b_attempts, 0)                        as r_baseline_attempts,
           case when bl.b_attempts >= 30
                then bl.b_rang::numeric / bl.b_attempts end  as r_baseline_rate,
           coalesce(a.a_sessions, 0)                         as r_answered
      from windowed w
      full join answered a
        on a.a_platform = w.w_platform and a.a_version = w.w_version
      left join baseline bl
        on bl.b_platform = coalesce(w.w_platform, a.a_platform)
  ),
  thresholds as (
    select r.*,
           case when r.r_attempts >= 30 and r.r_baseline_rate is not null
                then r.r_baseline_rate - greatest(
                       0.05,
                       3 * sqrt(r.r_baseline_rate * (1 - r.r_baseline_rate) / r.r_attempts))
           end as r_threshold
      from rates r
  )
  select t.r_platform,
         t.r_version,
         t.r_attempts,
         t.r_rang,
         round(t.r_rate, 4),
         t.r_baseline_attempts,
         round(t.r_baseline_rate, 4),
         round(t.r_threshold, 4),
         t.r_answered,
         case
           when t.r_attempts < 30 then 'insufficient_sample'
           when t.r_baseline_rate is null then 'no_baseline'
           when t.r_rate < t.r_threshold then 'drop'
           else 'pass'
         end
    from thresholds t
   order by t.r_platform, t.r_version;
$$;

comment on function public.api_ring_success(timestamptz) is
  'D142 P01: ring pushes that became a shown ring within 15 s, per platform and '
  'app version over 24 h, against the platform''s prior 7 days. Counts and '
  'rates only. Service role only.';

revoke execute on function public.api_ring_success(timestamptz)
  from public, anon, authenticated;
grant execute on function public.api_ring_success(timestamptz) to service_role;
