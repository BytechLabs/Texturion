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
-- (`ring_beacons`) within 15 seconds of `attempted_at`, the moment the send
-- started (push-attempts.ts timedPush). The beacon's time is the device's own
-- clock where the route kept it, and arrival otherwise.
--
-- WHICH DEVICE. A push names its channel row; that row names the auth session
-- it was registered from, and a beacon names the auth session that posted it.
-- Where both are known they must match, so a member's tablet ringing does not
-- count for the push sent to their phone. Where either is unknown (a channel
-- registered before sessions were recorded) the member's beacon on the same
-- platform for the same call counts.
--
-- WHICH VERSION. The version the channel's session last sent the API, and
-- nothing else. A beacon's version is known only for a push that produced a
-- beacon, so using it would file a device's rings under one version and its
-- missed rings under another. A push whose session or version is unknown is
-- 'unknown' and is never judged: verdict 'unattributed'.
--
-- WHICH VERSIONS CAN ANSWER. A build from before the beacons shipped never
-- sends `ringing_shown`, so its pushes would all count as missed rings. The
-- platform's floor is the lowest version that has sent any beacon in the 14
-- days kept; a version below it is 'not_instrumented' and never judged. A
-- version above it is judged even if it has sent no beacon at all, which is
-- what a new release that stopped ringing looks like. A version below the
-- floor that once could ring and now cannot is the case this misses.
--
-- 'GONE' IS NOT AN ATTEMPT. The provider said the channel no longer exists
-- and the fan-out deleted it. There was no device to ring, and counting it
-- would charge a stale registration to whichever bucket it fell in.
--
-- WINDOW AND BASELINE. The window is the 24 hours ending a minute ago, so a
-- push from the last minute has had its 15 seconds and its beacon time to
-- land. The baseline is the same platform's judged versions over the 7 days
-- before the window. Both fit inside the 14 days the evidence is kept.
--
-- THE VERDICT, first match wins: unattributed, not_instrumented,
-- insufficient_sample (under 30 window attempts), no_baseline (under 30
-- baseline attempts), drop, pass. Only 'pass' is a pass.
--
-- THE THRESHOLD. t = baseline rate minus 5 points; a drop is a window rate
-- below t - 3 * sqrt(t(1-t)(1/n_window + 1/n_baseline)). The 5 points keep a
-- drop nobody would act on from alarming; the rest counts both samples'
-- error. The variance is taken at t because at rates near 100% the observed
-- variance collapses: 3 standard errors at the observed rate and the window's
-- n alone fire by chance on 11.7% of windows at a steady 95%, 30 against 30.
-- Exactly from the binomial (rates 30-99%, window 30-1,000, baseline
-- 30-2,000), this rule fires by chance on at most 0.28% of windows, and 0.05%
-- once the baseline holds 100. One window catches 95% falling to 75% 28-40%
-- of the time at 30 attempts and 88% at 100 against 700; a 10-point fall needs
-- hundreds of attempts.
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
  floors as (
    select b.platform                            as f_platform,
           min(public.version_key(b.app_version)) as f_key
      from public.ring_beacons b, bounds bd
     where b.app_version is not null
       and b.created_at <= bd.window_end
     group by 1
  ),
  ring_pushes as (
    select pa.platform                                  as push_platform,
           pa.attempted_at                              as pushed_at,
           coalesce(us.app_version, 'unknown')          as push_version,
           seen.rang                                    as rang
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
        select coalesce(bool_or(
                 b.stage = 'ringing_shown'
                 and coalesce(b.occurred_at, b.created_at)
                     <= pa.attempted_at + interval '15 seconds'), false) as rang
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
  answered as (
    select b.platform                                         as a_platform,
           coalesce(us.app_version, b.app_version, 'unknown') as a_version,
           count(distinct (b.call_session_id, b.user_id))::int as a_sessions
      from public.ring_beacons b
      cross join bounds bd
      left join public.user_sessions us
        on us.session_id = b.auth_session_id
     where b.stage = 'answered'
       and b.created_at > bd.window_start
       and b.created_at <= bd.window_end
     group by 1, 2
  ),
  -- Classified once, so the baseline and the output cannot disagree.
  buckets as (
    select v.s_platform,
           v.s_version,
           case
             when v.s_version = 'unknown' then 'unattributed'
             when not coalesce(public.version_key(v.s_version) >= f.f_key, false)
               then 'not_instrumented'
             else 'judged'
           end as s_status
      from (select rp.push_platform, rp.push_version from ring_pushes rp
            union
            select a.a_platform, a.a_version from answered a) v(s_platform, s_version)
      left join floors f
        on f.f_platform = v.s_platform
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
      from ring_pushes rp
      join buckets bk
        on bk.s_platform = rp.push_platform and bk.s_version = rp.push_version
      cross join bounds bd
     where rp.pushed_at <= bd.window_start
       and bk.s_status = 'judged'
     group by 1
  ),
  rates as (
    select bk.s_platform                                      as r_platform,
           bk.s_version                                       as r_version,
           bk.s_status                                        as r_status,
           coalesce(w.w_attempts, 0)                          as r_attempts,
           coalesce(w.w_rang, 0)                              as r_rang,
           case when w.w_attempts > 0
                then w.w_rang::numeric / w.w_attempts end     as r_rate,
           coalesce(bl.b_attempts, 0)                         as r_baseline_attempts,
           case when bl.b_attempts >= 30
                then bl.b_rang::numeric / bl.b_attempts end   as r_baseline_rate,
           coalesce(a.a_sessions, 0)                          as r_answered
      from buckets bk
      left join windowed w
        on w.w_platform = bk.s_platform and w.w_version = bk.s_version
      left join answered a
        on a.a_platform = bk.s_platform and a.a_version = bk.s_version
      left join baseline bl
        on bl.b_platform = bk.s_platform
     where w.w_attempts is not null or a.a_sessions is not null
  ),
  thresholds as (
    select r.*,
           case when r.r_status = 'judged'
                 and r.r_attempts >= 30
                 and r.r_baseline_rate is not null
                then t.t - 3 * sqrt(t.t * (1 - t.t)
                                    * (1.0 / r.r_attempts + 1.0 / r.r_baseline_attempts))
           end as r_threshold
      from rates r
      cross join lateral (select greatest(r.r_baseline_rate - 0.05, 0) as t) t
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
           when t.r_status = 'unattributed' then 'unattributed'
           when t.r_status = 'not_instrumented' then 'not_instrumented'
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
  'app version over 24 h, against the platform''s prior 7 days. Versions below '
  'the first that sends ring beacons, and pushes of unknown version, are counted '
  'but never judged. Counts and rates only. Service role only.';

revoke execute on function public.api_ring_success(timestamptz)
  from public, anon, authenticated;
grant execute on function public.api_ring_success(timestamptz) to service_role;
