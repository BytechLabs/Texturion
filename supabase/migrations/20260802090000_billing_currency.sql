-- [#328] A Canada-first product stops billing Canadians in US dollars.
--
-- SPEC §13 listed CAD as a fast-follow ("USD-only at launch keeps one price
-- book"). That was a sound launch decision and it never happened, while the
-- whole positioning moved to Canada-first — CASL, Canadian number handling, a
-- regions_ca module — and checkout kept contradicting the pitch at the worst
-- point in the funnel.
--
-- GRANDFATHERING IS THE DEFAULT, LITERALLY. Every existing row takes 'usd'
-- because that is the column default, so no workspace that is already paying
-- changes currency because of this migration. #328 asks that existing customers
-- switch only if they choose to, and the cheapest way to guarantee that is to
-- make the safe answer the one the database gives when nobody says otherwise.
--
-- The currency is CHOSEN AT SIGNUP and fixed once a subscription exists. Stripe
-- pins the currency on the subscription, so changing it afterwards means
-- cancelling and re-subscribing — a support conversation, not a toggle. The
-- API refuses the change once `stripe_subscription_id` is set rather than
-- letting a screen offer something Stripe will not honour.
--
-- WHY A COLUMN AND NOT AN INFERENCE FROM `country`. A workspace's country is
-- editable during onboarding and its number can be ported later, and neither of
-- those should silently reprice anybody. Country is the DEFAULT; this column is
-- the decision, and it stops moving the moment money changes hands.

alter table public.companies
  add column if not exists billing_currency text not null default 'usd';

-- Only the two we actually price. A third currency is a price book, a margin
-- model and a tax question, not a row value — so the constraint is the place
-- that says so.
alter table public.companies
  drop constraint if exists companies_billing_currency_check;
alter table public.companies
  add constraint companies_billing_currency_check
  check (billing_currency in ('usd', 'cad'));

comment on column public.companies.billing_currency is
  '#328: the currency this workspace is charged in. Defaulted from country at '
  'signup (CA -> cad) and changeable until a subscription exists, after which '
  'Stripe has pinned it. Existing workspaces are grandfathered onto usd by the '
  'column default rather than by a backfill.';

-- Reporting groups revenue by currency now, and #255's per-workspace margin
-- work has to be able to find the CAD rows without a full scan.
create index if not exists companies_billing_currency_idx
  on public.companies (billing_currency)
  where billing_currency <> 'usd';

-- ---------------------------------------------------------------------------
-- New workspaces get their currency from their country, at creation.
--
-- Set HERE rather than by a column default or a follow-up UPDATE from the
-- Worker, because this is the one place a company row comes into existence
-- transactionally with its owner, its tags and its prefs. A workspace that
-- existed for even a moment with the wrong currency is a workspace that could
-- have reached checkout with it.
--
-- CREATE OR REPLACE with the SAME signature, so no expand/contract dance is
-- needed and every existing call site binds unchanged. Body is otherwise
-- identical to 20260707160000.
create or replace function public.api_create_company(
  p_owner_user_id       uuid,
  p_name                text,
  p_country             text,
  p_requested_area_code text,
  p_us_texting_enabled  boolean,
  p_timezone            text default 'America/Toronto'
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company   public.companies;
  v_owned     int;
  -- #31 lifetime ceiling: 5 owned workspaces is far above any legitimate
  -- 1–10-person shop (one business, maybe a second brand) while making
  -- churn-a-tenant row spam pointless.
  v_owner_cap constant int := 5;
begin
  -- Serialize this user's creates (claim_* advisory-lock idiom) so the count
  -- below cannot race a concurrent create by the same user.
  perform pg_advisory_xact_lock(
    hashtext('company_create:' || p_owner_user_id::text));

  select count(*) into v_owned
    from public.company_members m
    join public.companies co on co.id = m.company_id
   where m.user_id = p_owner_user_id
     and m.role = 'owner'
     and m.deactivated_at is null
     and co.deleted_at is null;
  if v_owned >= v_owner_cap then
    return jsonb_build_object('outcome', 'owner_cap', 'limit', v_owner_cap);
  end if;

  insert into public.companies
    (name, owner_user_id, country, us_texting_enabled, requested_area_code,
     timezone, aup_accepted_at, billing_currency)
  values
    (p_name, p_owner_user_id, p_country, p_us_texting_enabled,
     p_requested_area_code, coalesce(p_timezone, 'America/Toronto'), now(),
     -- #328: mirrors currencyForCountry() in packages/shared. Anything that is
     -- not Canada bills in USD, which is also what the column defaults to — so
     -- the two agree even if this expression is ever reached with a country
     -- the price book has never heard of.
     case when upper(btrim(coalesce(p_country, ''))) = 'CA' then 'cad'
          else 'usd' end)
  returning * into v_company;

  insert into public.company_members (company_id, user_id, role)
  values (v_company.id, p_owner_user_id, 'owner');

  insert into public.tags (company_id, name)
  values (v_company.id, 'Quote sent'),
         (v_company.id, 'Scheduled'),
         (v_company.id, 'Won'),
         (v_company.id, 'Lost');

  insert into public.notification_prefs (user_id, company_id)
  values (p_owner_user_id, v_company.id);

  return to_jsonb(v_company);
end $$;

revoke execute on function
  public.api_create_company(uuid, text, text, text, boolean, text)
  from public, anon, authenticated;
grant execute on function
  public.api_create_company(uuid, text, text, text, boolean, text)
  to service_role;
