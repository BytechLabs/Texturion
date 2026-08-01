-- #399 — referrals: a link per workspace, and the accounting behind it.
--
-- The product supplies a LINK and the record of what it did. It never
-- distributes anything: an "invite your contacts" flow would be the mass-texting
-- D4 and D11 exclude, turning a crew's consented customer list into an
-- acquisition funnel. The owner sends their link however they like.
--
-- ---------------------------------------------------------------------------
-- WHERE THE FRAUD RULES LIVE, AND WHY THEY ARE SPLIT
--
-- The decision is `decideReferral` in packages/shared — one function, so the
-- rules cannot drift between the route that applies them and any surface that
-- explains them. But one rule has to be atomic: "a workspace may be referred
-- once, ever". Two concurrent signups claiming the same referee would both pass
-- a read-then-decide check and both insert.
--
-- So that one rule is a UNIQUE INDEX, and the shared function is the decision
-- everywhere else. The database is the arbiter of the thing that races; the
-- code is the arbiter of the things that do not. This is the same split the
-- prepayments claim uses.

alter table public.companies
  add column if not exists referral_code text;

-- The code is what a stranger types, so it has to be unique across the product.
-- Partial, because most rows have none until the workspace looks at the screen.
create unique index if not exists companies_referral_code_uq
  on public.companies (referral_code)
  where referral_code is not null;

comment on column public.companies.referral_code is
  '#399: this workspace''s own referral code, minted on first use. Drawn from an '
  'alphabet with no 0/O or 1/I/L, because a code''s job is to survive being read '
  'aloud at a supply counter and typed by somebody else.';

create table if not exists public.referrals (
  id                   uuid primary key default gen_random_uuid(),
  -- The REFERRER owns this row. Named company_id rather than
  -- referrer_company_id so it is an ordinary tenant-scoped table: it is their
  -- referral, on their screen, earning their reward, and the #347 query scanner
  -- can see the scope. The referee is a foreign key, not the owner.
  company_id           uuid not null references public.companies(id) on delete cascade,
  -- The workspace that was referred. UNIQUE below: this is the rule that races.
  referee_company_id   uuid not null references public.companies(id) on delete cascade,
  -- The code as it was used, kept even if the referrer later changes theirs —
  -- otherwise the record of how somebody arrived becomes unreadable.
  code                 text not null,
  created_at           timestamptz not null default now(),

  -- When the referee ACTIVATED: sent a real message from a paid workspace.
  -- Nothing is owed before this. Paying on signup funds both standard attacks,
  -- because a signup costs an attacker nothing but an email address.
  qualified_at         timestamptz,

  -- When each side's free month was actually issued, and what issued it.
  referrer_rewarded_at timestamptz,
  referee_rewarded_at  timestamptz,
  referrer_coupon_id   text,
  referee_coupon_id    text,

  -- Set when a reward is refused after the fact (a refunded referee, an abuse
  -- finding). Distinguishes "not yet" from "never", which support needs.
  voided_at            timestamptz,
  voided_reason        text,

  constraint referrals_not_self check (company_id <> referee_company_id)
);

comment on table public.referrals is
  '#399: one row per referred workspace. The referee side is UNIQUE — a '
  'workspace may be referred once, ever, because without that one signup can be '
  'claimed by an unbounded number of codes.';

-- THE RULE THAT RACES. Everything else is decided by `decideReferral` in shared.
create unique index if not exists referrals_referee_uq
  on public.referrals (referee_company_id);

-- "What has this workspace earned, and how far along is each one" — the
-- referrer's own screen, and the annual cap.
create index if not exists referrals_referrer_idx
  on public.referrals (company_id, created_at desc);

alter table public.referrals enable row level security;
revoke all on public.referrals from public, anon, authenticated;
grant select, insert, update, delete on public.referrals to service_role;

-- ---------------------------------------------------------------------------
-- The facts a referral decision needs, in one read.
--
-- Returns null for an unknown code rather than raising: a mistyped code must
-- not block a signup. A customer who arrives without attribution is a customer
-- we still have; one blocked on a typo is not.
--
-- `rewards_this_year` counts REWARDED referrals rather than recorded ones, so a
-- referrer whose referees never activated is not penalised for their choices.
-- ---------------------------------------------------------------------------
create or replace function public.referral_claim_facts(
  p_code             text,
  p_referee_company  uuid
) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'referrer_company_id', r.id,
    'referrer_owner_user_id', r.owner_user_id,
    'referrer_rewards_this_year', coalesce((
      select count(*) from public.referrals x
       where x.company_id = r.id
         and x.referrer_rewarded_at is not null
         and x.referrer_rewarded_at > now() - interval '1 year'), 0),
    'referee_already_referred', exists(
      select 1 from public.referrals y where y.referee_company_id = p_referee_company))
  from public.companies r
  where r.referral_code = p_code
    and r.deleted_at is null
  limit 1
$$;

revoke execute on function public.referral_claim_facts(text, uuid)
  from public, anon, authenticated;
grant execute on function public.referral_claim_facts(text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Record a referral. The unique index is the arbiter, not this function.
--
-- `on conflict do nothing` means a second claim for the same referee is a
-- silent no-op rather than an error: by the time two requests race here the
-- decision has already been made twice and one of them has to lose quietly.
-- ---------------------------------------------------------------------------
create or replace function public.record_referral(
  p_company_id       uuid,
  p_referee_company  uuid,
  p_code             text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_company_id = p_referee_company then
    return jsonb_build_object('outcome', 'self_referral');
  end if;
  insert into public.referrals (company_id, referee_company_id, code)
  values (p_company_id, p_referee_company, p_code)
  on conflict (referee_company_id) do nothing
  returning id into v_id;

  if v_id is null then
    return jsonb_build_object('outcome', 'already_referred');
  end if;
  return jsonb_build_object('outcome', 'recorded', 'referral_id', v_id);
end $$;

revoke execute on function public.record_referral(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.record_referral(uuid, uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- The referee activated. Stamps once and reports whether this call was the one
-- that did it, so the caller only issues rewards on the transition.
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
