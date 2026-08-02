-- [#296 ask 2] Which marketing pages produce customers.
--
-- The columns landed in 20260802060000. This is the half that answers the
-- question: signups and ACTIVATIONS grouped by the page the owner first
-- landed on.
--
-- Activation, not signup, is the number that decides anything. #296 gates
-- per-competitor alternative pages on "attribution shows /compare converts",
-- and a page that produces signups who never send a message has not converted
-- anything — it has produced support load. So the activation definition here
-- is deliberately NOT a new one: it is D12's, the same pair of facts
-- 20260730003900_activation_stall.sql judges on, which is `first_sent_at`
-- (an outbound message that reached Telnyx) AND `first_inbound_reply_at`.
-- Two definitions of activation in one codebase is how two dashboards start
-- disagreeing in a meeting.
--
-- WHY A SMALL-COHORT FLOOR. Same reason as api_retention_cohorts (#327): at
-- our base size a landing page with three signups and two activations reads as
-- "67%, our best page" and would move real money. `is_small` marks the rows
-- that cannot carry a decision, and the reporting script refuses to rank them.
--
-- WHY UNATTRIBUTED IS A ROW RATHER THAN AN OMISSION. Every workspace created
-- before this shipped has a null landing path, as does anyone with storage
-- blocked or an expired window. Dropping them silently would make the
-- attributed pages look like they account for all growth. It is reported as
-- '(unattributed)' so the coverage is visible on the same screen as the
-- conclusion.

create or replace function public.api_signup_attribution(
  p_days int default 90,
  p_small_cohort int default 10
)
returns table (
  landing_path text,
  referrer_hosts text[],
  signups bigint,
  activated bigint,
  activation_rate numeric,
  is_small boolean,
  first_signup_at timestamptz,
  last_signup_at timestamptz
)
language sql
security definer
set search_path = ''
stable
as $$
  with scoped as (
    select
      coalesce(c.signup_landing_path, '(unattributed)') as landing_path,
      nullif(c.signup_first_touch ->> 'referrer_host', '') as referrer_host,
      c.created_at,
      -- D12 activation, unchanged: they sent, and somebody answered.
      (c.first_inbound_reply_at is not null
        and exists (
          select 1
            from public.messages m
           where m.company_id = c.id
             and m.direction = 'outbound'
             and m.telnyx_message_id is not null
        )) as activated
    from public.companies c
    where c.deleted_at is null
      and c.created_at >= now() - make_interval(days => greatest(p_days, 1))
  )
  select
    s.landing_path,
    -- Where the traffic came from, so a page that only converts from one
    -- source is not read as a page that converts.
    array_remove(array_agg(distinct s.referrer_host), null) as referrer_hosts,
    count(*) as signups,
    count(*) filter (where s.activated) as activated,
    case
      when count(*) = 0 then null
      else round(count(*) filter (where s.activated)::numeric / count(*), 4)
    end as activation_rate,
    count(*) < greatest(p_small_cohort, 1) as is_small,
    min(s.created_at) as first_signup_at,
    max(s.created_at) as last_signup_at
  from scoped s
  group by s.landing_path
  order by count(*) filter (where s.activated) desc, count(*) desc;
$$;

comment on function public.api_signup_attribution(int, int) is
  '#296: signups and D12 activations grouped by the marketing page the owner '
  'FIRST landed on. Activation reuses the activation-stall definition (sent '
  'via Telnyx AND received a reply) rather than defining a second one. '
  'is_small marks rows too thin to rank. Workspaces with no recorded touch — '
  'including every one created before attribution shipped — are reported as '
  '''(unattributed)'' rather than dropped, so coverage stays visible.';

revoke all on function public.api_signup_attribution(int, int) from public, anon, authenticated;
grant execute on function public.api_signup_attribution(int, int) to service_role;
