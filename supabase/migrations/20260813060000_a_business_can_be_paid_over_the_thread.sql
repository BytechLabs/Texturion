-- #224 / D133 — text-to-pay: the tradesperson collects from their customer in
-- the thread the job was arranged in.
--
-- ## The decision this table encodes, because it is not an engineering one
--
-- Collecting on somebody else's behalf is a liability question before it is a
-- feature. The issue asked three things and this is the answer to all three:
--
--   1. Do we take on Connect at all?          Yes. Getting paid is the last of
--      the trade's five money jobs with zero coverage, and it is the one that
--      makes a $29 tool feel like it pays for itself.
--
--   2. Standard, Express or Custom?           EXPRESS, with DIRECT charges.
--      This is the load-bearing half. A direct charge is created ON the
--      connected account: the tradesperson is the merchant of record, their
--      name is on the customer's statement, and a chargeback, a refund and a
--      negative balance settle against THEIR balance. Stripe owns the
--      onboarding, the KYC, and the dashboard where they refund. We are not in
--      the money's path, which is exactly the exposure the issue asked about.
--      A destination charge would have moved every one of those onto us.
--
--   3. Platform fee?                          ZERO. No `application_fee_amount`
--      anywhere in the code. The value stays in the subscription, the
--      customer-facing amount is exactly the amount the business typed, and we
--      never hold or route their money.
--
-- ## Two tables, and why the account is not a column on `companies`
--
-- `companies` is read on virtually every request. The connect account is read
-- on a settings page and a payment request, carries seven fields that Stripe
-- owns and we only mirror, and is absent for most workspaces. It is its own
-- row so that a workspace that never takes a payment carries no columns for
-- one, and so the mirror can be replaced wholesale from an `account.updated`
-- webhook without touching the company record.
--
-- ## Everything Stripe owns is a MIRROR
--
-- Every column below the account id is Stripe's answer, copied. Nothing here
-- is authoritative and nothing decides anything on its own: the send path
-- re-reads `charges_enabled` from this mirror, and the mirror is refreshed
-- from the webhook AND on demand, because a business that just finished
-- onboarding in another tab should not have to wait for a webhook to send
-- their first request.

-- ---------------------------------------------------------------------------
-- 1. The connected account.
-- ---------------------------------------------------------------------------

create table if not exists public.stripe_connect_accounts (
  company_id        uuid primary key references public.companies(id) on delete cascade,
  -- `acct_...`. Unique because one Stripe account belongs to one workspace: two
  -- rows pointing at the same account would let a webhook for one workspace
  -- resolve to the other, which is the worst failure this table can have.
  stripe_account_id text not null unique,
  -- The country the account was created in. Fixed at creation by Stripe and
  -- never editable, which is why it also decides the currency below.
  country           text not null,
  default_currency  text,
  -- Stripe's three onboarding facts, mirrored verbatim. `charges_enabled` is
  -- the ONE that gates sending: details_submitted can be true while charges are
  -- still off pending review, and a request sent then would take the customer
  -- to a page that cannot accept a card.
  charges_enabled   boolean not null default false,
  payouts_enabled   boolean not null default false,
  details_submitted boolean not null default false,
  -- Why Stripe has switched the account off, if it has. Shown to the owner
  -- verbatim-ish (mapped to a sentence) because "we can't take payments" with
  -- no reason is the state that generates a support email.
  disabled_reason   text,
  -- What Stripe is still waiting for, so the settings page can say what is
  -- outstanding rather than "pending". Text, not jsonb: it is a flat list of
  -- requirement identifiers and a list is what the UI renders.
  requirements_due  text[] not null default '{}',
  -- When the outstanding requirements stop being a warning and start disabling
  -- the account.
  requirements_deadline timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid references auth.users(id) on delete set null
);

comment on table public.stripe_connect_accounts is
  '#224/D133: the workspace''s Stripe Express account. Every column below the '
  'account id is a MIRROR of Stripe''s answer, refreshed by account.updated and '
  'on demand. charges_enabled is the only one that gates a send.';

create index if not exists stripe_connect_accounts_account_idx
  on public.stripe_connect_accounts (stripe_account_id);

-- ---------------------------------------------------------------------------
-- 2. The request itself.
-- ---------------------------------------------------------------------------

create table if not exists public.payment_requests (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  contact_id      uuid not null references public.contacts(id) on delete cascade,
  -- The outbound message that carried the link. Nullable only for the instant
  -- between minting and sending; `on delete set null` because a message can be
  -- erased under D48 while the money fact stays.
  message_id      uuid references public.messages(id) on delete set null,

  amount_cents    int not null check (amount_cents > 0),
  -- The connected account's own currency. Not the platform's, and not chosen
  -- per request: a Canadian business bills in CAD because their Stripe account
  -- is Canadian, and letting a request pick would produce a charge their
  -- account cannot settle.
  currency        text not null check (currency in ('usd', 'cad')),
  -- What the money is for, in the business's words. This is what the customer
  -- reads on the payment page and on their card statement line, so it is
  -- required rather than optional.
  description     text not null check (length(btrim(description)) between 1 and 200),

  -- Stripe's side. The account is stored ON the request rather than joined from
  -- the workspace, because it is the fact a webhook has to match against: a
  -- connected-account event arrives carrying an account id, and matching it to
  -- what the request was created with is what stops one connected account's
  -- event resolving against another workspace's request.
  stripe_account_id        text not null,
  stripe_payment_link_id   text,
  stripe_checkout_session_id text,
  stripe_payment_intent_id text,
  stripe_charge_id         text,

  -- The D75 link the customer opens. Ours, not Stripe's, so the page can say
  -- "already paid" instead of showing a card form for money already taken, and
  -- so the request can be killed by revoking one row.
  public_link_id  uuid references public.public_links(id) on delete set null,

  status          text not null default 'requested'
                    check (status in ('requested', 'paid', 'cancelled', 'expired')),
  -- Refund and dispute are NOT statuses, deliberately. Both happen to a request
  -- that is and stays paid, both are the connected account's to resolve in
  -- their own Stripe dashboard, and collapsing them into `status` would lose
  -- the fact that money did change hands.
  amount_received_cents int,
  paid_at         timestamptz,
  refunded_at     timestamptz,
  amount_refunded_cents int,
  disputed_at     timestamptz,
  cancelled_at    timestamptz,
  cancelled_by    uuid references auth.users(id) on delete set null,
  expires_at      timestamptz not null,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references auth.users(id) on delete set null
);

comment on table public.payment_requests is
  '#224/D133: one ask for money, sent into a thread as an ordinary outbound '
  'message. Direct charge on the connected account — refunds and disputes '
  'settle against the business, never the platform.';

-- The thread card reads this: every request on one conversation, newest first.
create index if not exists payment_requests_conversation_idx
  on public.payment_requests (company_id, conversation_id, created_at desc);

-- The webhook reads this. Partial, because a null link id is the pre-send
-- instant and never something a webhook looks up.
create index if not exists payment_requests_payment_link_idx
  on public.payment_requests (stripe_payment_link_id)
  where stripe_payment_link_id is not null;

-- The expiry sweeper reads this.
create index if not exists payment_requests_open_idx
  on public.payment_requests (expires_at)
  where status = 'requested';

-- ---------------------------------------------------------------------------
-- Neither table is reachable by anyone but the API.
--
-- RLS on with NO policies is the deny-everything default, and it is the right
-- shape here rather than a gap: every read and write goes through a route that
-- has already resolved a workspace and a capability, and `service_role`
-- bypasses RLS. A policy would be a second, weaker copy of a rule the routes
-- already enforce — and the one table where a mistake would expose a bank
-- account mirror is not the place to keep two.
--
-- The explicit REVOKE matters as much as the enable: a table created here
-- inherits nothing dangerous today, but `anon` and `authenticated` both
-- inherit from PUBLIC, and a future `grant ... on all tables in schema public`
-- would hand them these two. Stated once, here, so it cannot.
-- ---------------------------------------------------------------------------
alter table public.stripe_connect_accounts enable row level security;
revoke all on table public.stripe_connect_accounts from public, anon, authenticated;
grant select, insert, update, delete on table public.stripe_connect_accounts to service_role;

alter table public.payment_requests enable row level security;
revoke all on table public.payment_requests from public, anon, authenticated;
grant select, insert, update, delete on table public.payment_requests to service_role;

-- (The five `conversation_event_type` values this feature writes are added in
-- 20260813040000, in their own migration: a new enum value cannot be used in
-- the transaction that adds it.)

-- ---------------------------------------------------------------------------
-- 3. Marking one paid, once.
--
-- A webhook can arrive twice, out of order, and again from the sweeper. This
-- function is the only writer of `paid_at` and it is idempotent by predicate,
-- not by hope: the update is conditioned on the row still being open, so the
-- second delivery changes nothing and returns the same answer as the first.
--
-- THE ACCOUNT CHECK IS THE SECURITY CONTROL. Connect events arrive on a shared
-- endpoint carrying `event.account`. Without matching it against the account
-- the request was created with, any connected account in the world could name
-- another workspace's payment link and have it marked paid.
-- ---------------------------------------------------------------------------
create or replace function public.api_mark_payment_request_paid(
  p_payment_link_id text,
  p_account         text,
  p_session         text,
  p_payment_intent  text,
  p_charge          text,
  p_amount_received int
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.payment_requests%rowtype;
begin
  select * into v_row
    from public.payment_requests
   where stripe_payment_link_id = p_payment_link_id
     and stripe_account_id = p_account
   limit 1;

  if v_row.id is null then
    return jsonb_build_object('outcome', 'unknown');
  end if;

  if v_row.paid_at is not null then
    -- Already paid. Report the row so the caller can be idempotent too, and
    -- change nothing: a second session against the same link is either a
    -- redelivery or a customer who paid twice, and the second is a refund
    -- conversation, not a second row.
    return jsonb_build_object(
      'outcome', 'already_paid',
      'payment_request_id', v_row.id,
      'company_id', v_row.company_id,
      'conversation_id', v_row.conversation_id);
  end if;

  update public.payment_requests
     set status = 'paid',
         paid_at = now(),
         amount_received_cents = p_amount_received,
         stripe_checkout_session_id = coalesce(p_session, stripe_checkout_session_id),
         stripe_payment_intent_id = coalesce(p_payment_intent, stripe_payment_intent_id),
         stripe_charge_id = coalesce(p_charge, stripe_charge_id),
         -- A cancelled request whose link somehow still took a payment is
         -- marked paid, because the money is real. The cancellation stamp stays
         -- so the thread can show both facts.
         updated_at = now()
   where id = v_row.id
     and paid_at is null
  returning * into v_row;

  if v_row.id is null then
    -- Lost a race with a concurrent delivery; the other one did the work.
    return jsonb_build_object('outcome', 'already_paid');
  end if;

  return jsonb_build_object(
    'outcome', 'paid',
    'payment_request_id', v_row.id,
    'company_id', v_row.company_id,
    'conversation_id', v_row.conversation_id,
    'contact_id', v_row.contact_id,
    'amount_cents', v_row.amount_cents,
    'currency', v_row.currency,
    'description', v_row.description,
    'public_link_id', v_row.public_link_id);
end $$;

comment on function public.api_mark_payment_request_paid(text, text, text, text, text, int) is
  '#224: the only writer of paid_at. Idempotent by predicate, and refuses any '
  'event whose connected account is not the one the request was created with.';

revoke all on function public.api_mark_payment_request_paid(text, text, text, text, text, int)
  from public, anon, authenticated;
grant execute on function public.api_mark_payment_request_paid(text, text, text, text, text, int)
  to service_role;

-- ---------------------------------------------------------------------------
-- 4. Refunded / disputed, by charge.
--
-- Both are things the BUSINESS does or receives in their own Stripe dashboard,
-- and both are matched on the charge rather than the link, because that is what
-- the events carry. Neither moves `status`: a refunded payment was still paid.
-- ---------------------------------------------------------------------------
create or replace function public.api_mark_payment_request_settled(
  p_charge   text,
  p_account  text,
  p_kind     text,              -- 'refunded' | 'disputed'
  p_amount   int default null   -- refunded amount, in cents
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.payment_requests%rowtype;
begin
  if p_kind not in ('refunded', 'disputed') then
    raise exception 'api_mark_payment_request_settled: unknown kind %', p_kind;
  end if;

  select * into v_row
    from public.payment_requests
   where stripe_charge_id = p_charge
     and stripe_account_id = p_account
   limit 1;

  if v_row.id is null then
    return jsonb_build_object('outcome', 'unknown');
  end if;

  if p_kind = 'refunded' then
    update public.payment_requests
       set refunded_at = coalesce(refunded_at, now()),
           amount_refunded_cents = p_amount,
           updated_at = now()
     where id = v_row.id
       and (refunded_at is null or amount_refunded_cents is distinct from p_amount)
    returning * into v_row;
  else
    update public.payment_requests
       set disputed_at = coalesce(disputed_at, now()),
           updated_at = now()
     where id = v_row.id
       and disputed_at is null
    returning * into v_row;
  end if;

  if v_row.id is null then
    return jsonb_build_object('outcome', 'noop');
  end if;

  return jsonb_build_object(
    'outcome', p_kind,
    'payment_request_id', v_row.id,
    'company_id', v_row.company_id,
    'conversation_id', v_row.conversation_id,
    'amount_cents', v_row.amount_cents,
    'amount_refunded_cents', v_row.amount_refunded_cents,
    'currency', v_row.currency,
    'description', v_row.description);
end $$;

revoke all on function public.api_mark_payment_request_settled(text, text, text, int)
  from public, anon, authenticated;
grant execute on function public.api_mark_payment_request_settled(text, text, text, int)
  to service_role;

-- ---------------------------------------------------------------------------
-- 5. Expiring the ones nobody paid.
--
-- A request whose link has expired must stop reading as "waiting" in the
-- thread, or the crew chases a customer over a page that no longer opens. Run
-- from the existing hourly cron; bounded so one workspace's backlog cannot
-- stall the pass.
-- ---------------------------------------------------------------------------
create or replace function public.expire_payment_requests(p_limit int default 500)
returns int
language sql
security definer
set search_path = ''
as $$
  -- One statement, and it has to be: a CTE is scoped to the statement that
  -- declares it, so counting `due` in a second `select` below the update reads
  -- as obvious and fails with "relation due does not exist". The count comes
  -- from the update's own RETURNING instead, which is also the more honest
  -- number — it is what actually moved, not what was selected to move.
  with due as (
    select id from public.payment_requests
     where status = 'requested'
       and expires_at <= now()
     order by expires_at
     limit p_limit
  ), moved as (
    update public.payment_requests p
       set status = 'expired', updated_at = now()
      from due
     where p.id = due.id
    returning p.id
  )
  select count(*)::int from moved;
$$;

revoke all on function public.expire_payment_requests(int) from public, anon, authenticated;
grant execute on function public.expire_payment_requests(int) to service_role;

-- ---------------------------------------------------------------------------
-- 6. Erasure reaches both tables.
--
-- D48 anonymises the `companies` row rather than deleting it, so the
-- `on delete cascade` above never fires and a table not named in
-- `purge_workspace_step` survives erasure forever. `supabase/tests/purge_coverage.test.sql`
-- derives the required list from information_schema and fails on any omission,
-- so this is the half of the feature that CI checks rather than trusts.
--
-- `payment_requests` goes BEFORE the tables it references so the batch loop
-- drains it rather than leaving a cascade to delete an unbounded number of rows
-- in one statement.
-- ---------------------------------------------------------------------------
create or replace function public.purge_workspace_step(
  p_company_id uuid,
  p_limit      int default 500
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tables text[] := array[
    'usage_events', 'tasks', 'message_mentions', 'message_attachments',
    'attachments',
    'conversation_summaries',
    -- #224: before `messages` and `conversations`, both of which it references.
    'payment_requests',
    'messages', 'conversation_events', 'conversations',
    'call_records', 'calls', 'port_requests', 'text_enablement_orders',
    'contacts', 'phone_numbers',
    'template_uses',
    'tags',
    'templates', 'invites', 'messaging_registrations', 'grace_notices',
    'inbound_notification_days', 'usage_alerts', 'egress_events', 'audit_log',
    'company_members',
    'call_member_legs', 'company_ai_settings', 'company_ai_usage',
    'company_modules', 'email_ledger', 'member_telephony_credentials',
    'notification_prefs', 'notification_read_items', 'notification_reads',
    'number_access', 'outbound_call_authorizations', 'outbound_dial_leases',
    'activation_stall_state', 'appointment_reminder_rules', 'billing_disputes',
    'blocked_senders', 'call_silence_state', 'cancellation_reasons',
    'contact_field_defs', 'data_exports', 'feature_flag_overrides',
    'high_priority_push_budget', 'high_priority_push_days', 'lead_sources',
    'number_port_outs', 'ownership_confirmations', 'ownership_transfers',
    'prepayments', 'public_links', 'referrals', 'retention_notices',
    'saved_views',
    -- #224: the Stripe account mirror. The account itself is NOT deleted at
    -- Stripe by this — it is the business's own legal entity with their own
    -- payout history, and deleting it would destroy records they are required
    -- to keep. What goes is our copy of it.
    'stripe_connect_accounts',
    'voicemail_greetings',
    'provider_costs'
  ];
  v_table text;
  v_deleted int;
begin
  if p_limit is null or p_limit <= 0 then
    raise exception 'purge_workspace_step: p_limit must be > 0';
  end if;
  if not exists (
    select 1 from public.companies
     where id = p_company_id
       and deleted_at is not null
       and purge_after is not null
       and purge_after <= now()
  ) then
    raise exception 'purge_workspace_step: % is not past its purge window', p_company_id;
  end if;

  foreach v_table in array v_tables loop
    execute format(
      'delete from public.%I where ctid in (
         select ctid from public.%I where company_id = $1 limit $2
       )', v_table, v_table)
      using p_company_id, p_limit;
    get diagnostics v_deleted = row_count;
    if v_deleted > 0 then
      return jsonb_build_object('step', v_table, 'deleted', v_deleted, 'done', false);
    end if;
  end loop;

  return jsonb_build_object('step', null, 'deleted', 0, 'done', true);
end $$;
