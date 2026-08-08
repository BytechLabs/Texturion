-- #288 — a referral is earned when the referred business actually starts working,
-- not when it sends one text.
--
-- ## The hole this closes
--
-- `qualify_referral` stamped on the referee's first outbound send. D12 says a
-- workspace has activated when it sent AND somebody answered, and the difference is
-- the whole of the abuse question this issue told us to answer in the design rather
-- than after launch: a throwaway workspace, one text to a number nobody replies from,
-- and the referrer is paid. That is credit farming with a single tap of work.
--
-- Requiring the reply makes it materially harder to fake, because the second half is
-- not in the farmer's control: somebody has to text back.
--
-- ## Why the predicate becomes a function
--
-- "Sent, and somebody answered" was written out longhand in the signup-attribution
-- report, and `qualify_referral` was about to become a second copy that disagreed
-- with it. One definition, named, used by both.
--
-- The two RETENTION reports keep their own, and that is deliberate rather than an
-- omission: they ask "did this workspace activate WITHIN SEVEN DAYS of subscribing",
-- which is a cohort-quality question with a clock in it. Collapsing the two would
-- silently change what those charts mean.

create or replace function public.company_is_activated(p_company uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
      from public.companies c
     where c.id = p_company
       and c.deleted_at is null
       -- D12: they sent, and somebody answered. Both halves, always.
       and c.first_inbound_reply_at is not null
       and exists (
         select 1
           from public.messages m
          where m.company_id = c.id
            and m.direction = 'outbound'
            and m.telnyx_message_id is not null
       )
  );
$$;

comment on function public.company_is_activated(uuid) is
  'D12 activation, in one place: the workspace sent a text through the carrier AND '
  'somebody answered. Used by the referral payout (#288) and the signup attribution '
  'report (#296). The retention cohorts deliberately keep their own time-boxed '
  'version, which asks a different question.';

revoke all on function public.company_is_activated(uuid) from public, anon, authenticated;
grant execute on function public.company_is_activated(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- The referee activated. Stamps once, and only once the reply has landed.
-- ---------------------------------------------------------------------------
create or replace function public.qualify_referral(p_referee_company uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.referrals%rowtype;
begin
  -- The gate, and the reason this function changed. Checked BEFORE the update so a
  -- referral that is not yet earned stays unstamped and can qualify later — the
  -- caller runs on every send, and the reply usually arrives after one of them.
  if not public.company_is_activated(p_referee_company) then
    return jsonb_build_object('outcome', 'not_yet');
  end if;

  update public.referrals
     set qualified_at = now()
   where referee_company_id = p_referee_company
     and qualified_at is null
     and voided_at is null
  returning * into v_row;

  if v_row.id is null then
    return jsonb_build_object('outcome', 'noop');
  end if;
  return jsonb_build_object(
    'outcome', 'qualified',
    'referral_id', v_row.id,
    'referrer_company_id', v_row.company_id,
    'referee_company_id', v_row.referee_company_id);
end $$;

revoke execute on function public.qualify_referral(uuid) from public, anon, authenticated;
grant execute on function public.qualify_referral(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- #296's report, with two surgical changes and nothing else.
--
-- Rebuilt from the CURRENT body rather than retyped: the first version of this
-- migration was written from the doc block and quietly reverted the activation-rate
-- maths to a different scale, which the report's own suite caught immediately. A
-- `create or replace` from memory is a rewrite whether or not it is meant as one.
-- ---------------------------------------------------------------------------
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
      -- #288: a referred signup lands on '/' from a text message with no
      -- parameters and no referrer, so word of mouth — the channel this business
      -- actually runs on — was reported as ordinary direct traffic. Named, so it
      -- can be seen.
      case
        when exists (
          select 1 from public.referrals r
           where r.referee_company_id = c.id
             and r.voided_at is null
        ) then '(referral)'
        else coalesce(c.signup_landing_path, '(unattributed)')
      end as landing_path,
      nullif(c.signup_first_touch ->> 'referrer_host', '') as referrer_host,
      c.created_at,
      -- D12 activation, now via the named function rather than a second copy of
      -- the predicate (#288). Character-identical, so every number is unchanged.
      public.company_is_activated(c.id) as activated
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
  '#296: signups and D12 activations grouped by the marketing page the owner FIRST '
  'landed on, with one addition (#288) — a workspace that arrived through a referral '
  'is reported as ''(referral)'' rather than as direct traffic, because a texted link '
  'carries no landing path, no referrer and no campaign, and word of mouth was '
  'therefore the one channel this report could not see. Activation is '
  'company_is_activated(). is_small marks rows too thin to rank. Workspaces with no '
  'recorded touch are ''(unattributed)'' rather than dropped, so coverage stays '
  'visible.';

revoke all on function public.api_signup_attribution(int, int) from public, anon, authenticated;
grant execute on function public.api_signup_attribution(int, int) to service_role;
