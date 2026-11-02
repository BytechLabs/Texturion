-- #642 / #643: the two reads the Telnyx watches stand on.
--
-- 1. api_telnyx_spend_since: what production has spent at Telnyx in a window,
--    from the ground-truth ledgers #216 already fills. Voice is one account-wide
--    figure because production has one outbound voice profile, and its daily
--    limit is the account's. Messaging is per company because each company has
--    its own messaging profile, and Telnyx's daily limit is per profile.
--
-- 2. api_voice_capacity_read: how many calls' worth of Telnyx concurrency
--    production can need at once, to set against the account's concurrent call
--    limit. Same definitions the rig's reserve uses (ops_diag.ring_audience_
--    sizes_now): a number's ring audience is its text-level members with a
--    telephony credential, and the history figure is the most ring legs one
--    call opened.
--
-- Both return aggregates only: no number, name or message text.

-- Messaging cost rides messages.provider_cost, written at message.finalized, so
-- the figure trails a send by the carrier's delivery report. It is driven from
-- companies so the read rides messages_outbound_accepted_period_idx
-- (company_id, created_at) where outbound and carrier-accepted, one range scan
-- per company with a profile instead of a scan of every message in the window.
create or replace function public.api_telnyx_spend_since(
  p_since timestamptz,
  p_until timestamptz
) returns table (
  kind       text,
  company_id uuid,
  spend_usd  numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  select 'voice'::text, null::uuid,
         coalesce(sum(pc.cost_usd), 0)::numeric
    from public.provider_costs pc
   where pc.kind = 'voice'
     and pc.occurred_at >= p_since
     and pc.occurred_at < p_until
  union all
  select 'message'::text, c.id, s.spend
    from public.companies c
   cross join lateral (
     select coalesce(sum(m.provider_cost), 0)::numeric as spend
       from public.messages m
      where m.company_id = c.id
        and m.direction = 'outbound'
        and m.telnyx_message_id is not null
        and m.created_at >= p_since
        and m.created_at < p_until
        and m.provider_cost is not null
   ) s
   where c.telnyx_messaging_profile_id is not null
     and s.spend > 0;
$$;

revoke execute on function public.api_telnyx_spend_since(timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.api_telnyx_spend_since(timestamptz, timestamptz)
  to service_role;

-- Each answered call is +1 at its answer and -1 at its end; the running sum's
-- peak is the most that were up at once. An end sorts before a start at the same
-- instant, so calls that only touch are not counted as overlapping.
create or replace function public.api_voice_capacity_read()
returns table (
  numbers               int,
  largest_audience      int,
  peak_concurrent_calls int
)
language sql
stable
security definer
set search_path = ''
as $$
  with sizes as (
    select
      (select count(*)::int
         from public.number_member_levels(pn.id) lvl
         join public.member_telephony_credentials mtc
           on mtc.company_id = pn.company_id and mtc.user_id = lvl.user_id
        where lvl.level = 'text') as ceiling_legs,
      coalesce((
        select max(per_call.legs)::int
          from (select count(*) as legs
                  from public.call_member_legs l
                  join public.calls c on c.call_session_id = l.call_session_id
                 where c.phone_number_id = pn.id
                   and l.kind = 'ring'
                   and l.created_at >= now() - interval '28 days'
                 group by l.call_session_id) per_call
      ), 0) as peak_legs
    from public.phone_numbers pn
    where pn.status = 'active'
  ),
  edges as (
    select c.answered_at as at, 1 as delta
      from public.calls c
     where c.answered_at is not null and c.ended_at is not null
       and c.ended_at > c.answered_at
       and c.answered_at >= now() - interval '28 days'
    union all
    select c.ended_at, -1
      from public.calls c
     where c.answered_at is not null and c.ended_at is not null
       and c.ended_at > c.answered_at
       and c.answered_at >= now() - interval '28 days'
  ),
  running as (
    select sum(e.delta) over (order by e.at, e.delta rows unbounded preceding) as up
      from edges e
  )
  select
    (select count(*)::int from sizes),
    (select coalesce(max(greatest(s.ceiling_legs, s.peak_legs)), 0)::int from sizes s),
    (select coalesce(max(r.up), 0)::int from running r);
$$;

revoke execute on function public.api_voice_capacity_read()
  from public, anon, authenticated;
grant execute on function public.api_voice_capacity_read()
  to service_role;
