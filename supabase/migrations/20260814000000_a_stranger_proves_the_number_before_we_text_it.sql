-- #232 / D124 — the one primitive the "Text us" widget needs and the product
-- does not have: proving that an anonymous visitor owns the number they typed.
--
-- ===========================================================================
-- WHY NOTHING EXISTING CAN BE REUSED
-- ===========================================================================
--
-- The repo already has two things that look like this and are not:
--
--   * the 6-digit code in onboarding is Telnyx's 10DLC SOLE-PROPRIETOR
--     REGISTRATION OTP — it proves a business owns a brand, on a carrier's
--     lifecycle, not that a person holds a handset;
--   * `VERIFY_RATE_LIMITER` bounds how often we text a number a COMPANY CLAIMS
--     TO OWN during the keep-your-number check.
--
-- Neither verifies a stranger. This is a new lifecycle: a hashed code, an
-- expiry, an attempt ceiling, a resend throttle, and budgets of its own.
--
-- ===========================================================================
-- THE CAP BOUNDS CODES SENT, NOT CONVERSATIONS OPENED
-- ===========================================================================
--
-- The distinction is the whole cost story and it is easy to get backwards. A
-- visitor who abandons after the code still cost us a segment, so a cap
-- counting conversations would protect the number nobody is spending. Every
-- budget below counts ROWS IN THIS TABLE, which is one row per text sent.
--
-- Three budgets, because they stop three different things:
--
--   per company per day  a bot pointed at one customer's widget cannot spend
--                        that customer's goodwill or our money past a ceiling
--   per number per day   somebody cannot be texted repeatedly by cycling
--                        through the widgets of different workspaces
--   resend throttle      the ordinary "I didn't get it" press, bounded so it
--                        is not a free send button
--
-- ===========================================================================
-- WHAT IS NEVER STORED
-- ===========================================================================
--
-- The code itself. The row holds a hash, so a database read cannot be turned
-- into an accepted verification, and the comparison happens against the hash
-- the caller computes. The Worker owns the hashing, deliberately: putting a
-- digest function in SQL would mean a second implementation of the one rule
-- that must not vary.

create table if not exists public.widget_verifications (
  id           uuid primary key default gen_random_uuid(),
  -- CASCADE, and listed in the workspace teardown below for the reason #341
  -- found the hard way: the companies row is anonymised rather than deleted,
  -- so nothing cascades from it and a table missing from that list is deleted
  -- by nothing at all.
  company_id   uuid not null references public.companies(id) on delete cascade,
  -- E.164, as typed by a visitor and normalised by the Worker.
  phone_e164   text not null check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  -- Never the code. See the header.
  code_hash    text not null check (char_length(code_hash) between 16 and 128),
  expires_at   timestamptz not null,
  -- Wrong guesses. The ceiling is the caller's, so it can be tuned without a
  -- migration; the column is what makes it enforceable at all.
  attempts     int not null default 0 check (attempts >= 0),
  verified_at  timestamptz,
  -- CF-Connecting-IP as the Worker saw it. Abuse forensics only, and it is the
  -- reason this table is not readable by anyone but the service role.
  ip           text,
  created_at   timestamptz not null default now()
);

comment on table public.widget_verifications is
  '#232/D124: one row per verification code TEXTED to a website visitor. The '
  'budgets count rows here rather than conversations opened, because an '
  'abandoned code still cost a segment. Holds a hash, never a code.';

-- Both daily counts and the resend throttle read this.
create index if not exists widget_verifications_company_idx
  on public.widget_verifications (company_id, created_at desc);

-- The per-number budget spans companies on purpose: the point is that one
-- person cannot be texted repeatedly by cycling through workspaces.
create index if not exists widget_verifications_phone_idx
  on public.widget_verifications (phone_e164, created_at desc);

-- Deny-by-default, as every table in this schema: RLS on with no policies, and
-- the grants restated rather than inherited. `service_role` bypasses RLS; the
-- explicit revoke is what stops a future blanket grant handing this to anon.
alter table public.widget_verifications enable row level security;
revoke all on table public.widget_verifications
  from public, anon, authenticated, service_role;
-- DELETE is granted, and that is a retention decision rather than a
-- formality: this table holds a phone number and an IP for every code sent,
-- and a table like that with no way to shrink is a growing pile of personal
-- data whose only defence is that nobody has looked. `service_role_grants`
-- G1 asks for full DML on every public table and it was right to refuse the
-- first version of this file, which granted three of the four.
grant select, insert, update, delete on table public.widget_verifications
  to service_role;

-- ---------------------------------------------------------------------------
-- Claim the right to TEXT somebody, or refuse with a reason.
--
-- A guarded claim in the `api_claim_contact_message` shape, because the
-- read-check-insert this replaces races: two requests arriving together both
-- read a count under the cap and both send. The advisory lock serialises the
-- re-count and the insert into one transaction.
--
-- The lock is keyed on the COMPANY rather than globally. A global lock would
-- serialise every workspace's widget behind one another, which is a
-- self-inflicted queue at exactly the moment the feature is working.
--
-- Returns { allowed, id } or { allowed: false, reason } — a reason rather than
-- a bare false, because the caller answers three of them differently: a
-- throttled resend is a "wait a moment", a company cap is an honest "not
-- today", and a number cap must look identical to the caller so it cannot be
-- used to probe whether a number has been targeted elsewhere.
-- ---------------------------------------------------------------------------
create or replace function public.api_claim_widget_verification(
  p_company_id      uuid,
  p_phone           text,
  p_code_hash       text,
  p_ip              text,
  p_ttl_seconds     int,
  p_company_cap     int,
  p_number_cap      int,
  p_resend_seconds  int
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recent  timestamptz;
  v_company int;
  v_number  int;
  v_id      uuid;
begin
  if p_ttl_seconds is null or p_ttl_seconds < 30 then
    raise exception 'api_claim_widget_verification: p_ttl_seconds must be >= 30';
  end if;
  if p_company_cap is null or p_company_cap < 1
     or p_number_cap is null or p_number_cap < 1 then
    raise exception 'api_claim_widget_verification: caps must be >= 1';
  end if;

  -- Refuse a workspace that is closed or on hold before spending anything. A
  -- widget left embedded on a site outlives the account behind it.
  if not exists (
    select 1 from public.companies
     where id = p_company_id
       and deleted_at is null
  ) then
    return jsonb_build_object('allowed', false, 'reason', 'unknown_company');
  end if;

  perform pg_advisory_xact_lock(hashtext('widget_verifications:' || p_company_id::text));

  -- The resend throttle first: it is the cheapest check and the commonest
  -- reason to refuse.
  select max(created_at) into v_recent
    from public.widget_verifications
   where company_id = p_company_id
     and phone_e164 = p_phone;
  if v_recent is not null
     and v_recent > now() - make_interval(secs => greatest(p_resend_seconds, 0)) then
    return jsonb_build_object('allowed', false, 'reason', 'too_soon');
  end if;

  select count(*) into v_company
    from public.widget_verifications
   where company_id = p_company_id
     and created_at >= date_trunc('day', now());
  if v_company >= p_company_cap then
    return jsonb_build_object('allowed', false, 'reason', 'company_cap');
  end if;

  -- Across ALL companies. See the index comment.
  select count(*) into v_number
    from public.widget_verifications
   where phone_e164 = p_phone
     and created_at >= date_trunc('day', now());
  if v_number >= p_number_cap then
    return jsonb_build_object('allowed', false, 'reason', 'number_cap');
  end if;

  insert into public.widget_verifications
    (company_id, phone_e164, code_hash, expires_at, ip)
  values
    (p_company_id, p_phone, p_code_hash,
     now() + make_interval(secs => p_ttl_seconds), p_ip)
  returning id into v_id;

  return jsonb_build_object('allowed', true, 'id', v_id);
end $$;

revoke execute on function public.api_claim_widget_verification(
  uuid, text, text, text, int, int, int, int)
  from public, anon, authenticated;
grant execute on function public.api_claim_widget_verification(
  uuid, text, text, text, int, int, int, int)
  to service_role;

-- ---------------------------------------------------------------------------
-- Answer a code.
--
-- Every failure direction is the SAME answer to the caller (`{ ok: false }`
-- with a reason the caller may narrow), and the attempt is counted before the
-- comparison — so a wrong guess costs an attempt whether or not the row was
-- expired, and an attacker cannot tell "expired" from "wrong" by timing which
-- one increments.
--
-- One-shot: `verified_at` is set inside the same statement that matches, and
-- the predicate refuses a row already verified. A code cannot be spent twice.
-- ---------------------------------------------------------------------------
create or replace function public.api_answer_widget_verification(
  p_id           uuid,
  p_code_hash    text,
  p_max_attempts int
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.widget_verifications%rowtype;
begin
  if p_max_attempts is null or p_max_attempts < 1 then
    raise exception 'api_answer_widget_verification: p_max_attempts must be >= 1';
  end if;

  -- FOR UPDATE: two answers racing must not both spend the same code.
  select * into v_row
    from public.widget_verifications
   where id = p_id
   for update;

  if v_row.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unknown');
  end if;
  if v_row.verified_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'already_used');
  end if;

  -- Counted BEFORE the comparison, so a wrong guess costs an attempt on every
  -- path — including an expired row, which a patient attacker would otherwise
  -- use as a free oracle.
  update public.widget_verifications
     set attempts = attempts + 1
   where id = v_row.id
  returning * into v_row;

  if v_row.attempts > p_max_attempts then
    return jsonb_build_object('ok', false, 'reason', 'too_many_attempts');
  end if;
  if v_row.expires_at <= now() then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;
  if v_row.code_hash is distinct from p_code_hash then
    return jsonb_build_object('ok', false, 'reason', 'wrong');
  end if;

  update public.widget_verifications
     set verified_at = now()
   where id = v_row.id
     and verified_at is null
  returning * into v_row;

  if v_row.verified_at is null then
    -- Lost the race to a concurrent answer. Not an error, and not a success:
    -- the other caller holds the verification.
    return jsonb_build_object('ok', false, 'reason', 'already_used');
  end if;

  return jsonb_build_object(
    'ok', true,
    'company_id', v_row.company_id,
    'phone_e164', v_row.phone_e164);
end $$;

revoke execute on function public.api_answer_widget_verification(uuid, text, int)
  from public, anon, authenticated;
grant execute on function public.api_answer_widget_verification(uuid, text, int)
  to service_role;

-- ---------------------------------------------------------------------------
-- And it has to shrink on its own.
--
-- A verification is spent within minutes and worthless within a day. What it
-- leaves behind is a phone number, an IP and a timestamp — the shape of thing
-- that is fine for a week and indefensible after a year, so the window is
-- short by default rather than generous.
--
-- 30 DAYS, not the 365 `contact_messages` keeps, and the difference is the
-- point: a contact submission is a message somebody meant to send us and may
-- reference later, while this is a machine artifact nobody will ever ask
-- about. The only reason to keep one at all past its expiry is a few days of
-- abuse forensics.
--
-- Returns the count, like every other prune here, so a cron can report what it
-- did rather than claim it ran.
-- ---------------------------------------------------------------------------
create or replace function public.api_prune_widget_verifications(
  p_days int default 30
) returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  delete from public.widget_verifications
   where created_at < now() - make_interval(days => greatest(p_days, 1));
  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke execute on function public.api_prune_widget_verifications(int)
  from public, anon, authenticated;
grant execute on function public.api_prune_widget_verifications(int) to service_role;

-- ---------------------------------------------------------------------------
-- The workspace teardown has to reach this table.
--
-- #341 found twenty-one tables that survived an erasure permanently, and the
-- mechanism was exactly this: the companies row is ANONYMISED rather than
-- deleted, so nothing cascades from it, and a company-scoped table missing
-- from the list below is deleted by nothing at all. `purge_workspace.test.sql`
-- derives the expected set from the catalogue and fails the build by name, so
-- this is not optional — it is the same change as creating the table.
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
    'provider_costs',
    -- #232: one row per code texted to a website visitor. Carries a phone
    -- number and an IP, so it goes with the workspace like everything else.
    'widget_verifications'
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

-- Restated because a `create or replace` does NOT preserve them: dropping and
-- recreating a function hands it back the default PUBLIC execute grant that
-- anon and authenticated inherit.
revoke execute on function public.purge_workspace_step(uuid, int)
  from public, anon, authenticated;
grant execute on function public.purge_workspace_step(uuid, int) to service_role;
