-- #288 — ask a crew to recommend us only after the product has worked for them.
--
-- ## The moment, and why it was wrong
--
-- The referral link sat in Settings > Billing behind `billing.manage`, with no
-- moment attached: it was there on day one and it was there forever, which means
-- in practice it was there on the day somebody signed up and never again after.
-- #288 is explicit about both halves of that being wrong — "obvious placement at
-- a moment of demonstrated satisfaction rather than buried in settings", and
-- "asking at signup is asking someone to vouch for something they have not used,
-- which costs credibility and converts badly".
--
-- So this adds the facts a prompt needs to know whether it has been earned. The
-- DECISION is `referralAskDecision` in packages/shared, not here: three clients
-- have to agree about it, it has five branches worth unit-testing without a
-- database, and a copy of it in plpgsql would be a second opinion.
--
-- ## What counts as demonstrated value
--
-- Distinct customers the crew has REPLIED to in the last thirty days. Not
-- messages sent, which one chatty thread inflates; not conversations, because a
-- returning customer with two threads is one customer and the sentence on the
-- card says "customers".
--
-- Automated replies are excluded. An auto-reply is the product working, not the
-- crew working, and a workspace whose only outbound traffic is machine-generated
-- has demonstrated nothing about whether anybody there would recommend it.
--
-- So are sends the carrier never accepted, and internal notes. Both would make
-- the card claim a customer heard from them when nobody did — and the number is
-- the first thing an owner would check against their own memory.
--
-- This is deliberately NOT the #239 response-time measure. That one asks how
-- fast a lead was answered and carries a whole apparatus of business hours,
-- baselines and honest-unknown states; borrowing its number here would either
-- duplicate its rules or make a dashboard prompt wait on a 5000-row aggregate.
-- "Customers you replied to" is its own plain fact, and the card says exactly
-- what it counts.

alter table public.companies
  add column if not exists referral_prompt_dismissed_at timestamptz;

comment on column public.companies.referral_prompt_dismissed_at is
  '#288: when the owner last said "Not now" to the referral prompt. Holds for '
  'REFERRAL_ASK_QUIET_DAYS in packages/shared. One column rather than a row per '
  'dismissal because the prompt is one prompt and the only question ever asked '
  'of it is "how long ago".';

-- ---------------------------------------------------------------------------
-- The facts. No decision, no copy, no formatting.
-- ---------------------------------------------------------------------------
create or replace function public.api_referral_ask_facts(
  p_company_id uuid,
  p_now timestamptz
)
returns jsonb
language sql
security definer
set search_path = ''
stable
as $$
  select jsonb_build_object(
    -- D12, through the one named definition (#288). Never a second copy.
    'activated', public.company_is_activated(c.id),
    'activated_at', c.first_inbound_reply_at,
    'dismissed_at', c.referral_prompt_dismissed_at,
    'replied_customers', (
      -- Driven from `messages` rather than from `conversations`, so it rides
      -- messages_outbound_accepted_period_idx — (company_id, created_at) where
      -- outbound and carrier-accepted — as one range scan over thirty days
      -- instead of an index probe per thread the workspace has ever had.
      select count(distinct cv.contact_id)
        from public.messages m
        join public.conversations cv on cv.id = m.conversation_id
       where m.company_id = c.id
         and m.direction = 'outbound'
         -- CARRIER-ACCEPTED, which is the same bar the referral payout itself
         -- uses. A send that failed in the queue is not a customer who heard
         -- back, and a note is not a reply at all — neither has this id.
         and m.telnyx_message_id is not null
         -- A machine answering is the product working, not the crew.
         and m.automated = false
         and m.created_at >= p_now - interval '30 days'
    ),
    'rewards_this_year', (
      select count(*)
        from public.referrals r
       where r.company_id = c.id
         and r.referrer_rewarded_at is not null
         and r.referrer_rewarded_at >= p_now - interval '1 year'
    )
  )
    from public.companies c
   where c.id = p_company_id
     and c.deleted_at is null;
$$;

comment on function public.api_referral_ask_facts(uuid, timestamptz) is
  '#288: the five facts referralAskDecision() needs to judge whether a workspace '
  'has earned the referral ask — D12 activation and when it happened, distinct '
  'customers replied to in the last 30 days (human replies only), when the owner '
  'last dismissed the prompt, and rewards already earned this rolling year. '
  'Returns null for a workspace that does not exist or was deleted, which the '
  'caller reads as "do not ask". The decision itself lives in packages/shared so '
  'web, Android and iOS cannot disagree about it.';

revoke all on function public.api_referral_ask_facts(uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.api_referral_ask_facts(uuid, timestamptz)
  to service_role;
