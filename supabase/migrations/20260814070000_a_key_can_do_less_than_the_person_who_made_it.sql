-- ===========================================================================
-- #243 — scoped API keys.
--
-- The second half of the public surface, and the half #243's own devil's
-- advocate calls a launch blocker rather than a follow-up: *"treat key scoping
-- as a launch blocker rather than a follow-up."*
--
-- ## The token is never stored
--
-- `token_hash` is a SHA-256 of the whole token and nothing here can reverse it.
-- A fast hash rather than a slow one, deliberately: this is not a password. It
-- is 256 bits from a CSPRNG, so there is no dictionary to run and no rainbow
-- table to build — what bcrypt buys against a human-chosen secret it cannot buy
-- here, and it would cost a KDF on every single API request.
--
-- `token_prefix` is the first twelve characters, kept in the clear so the owner
-- can tell three keys apart, and so a leaked key found in a log can be matched
-- to a row without anybody having to hold the whole thing.
--
-- ## A key can do LESS than the person who made it, never more
--
-- Two mechanisms, and both are needed:
--
-- 1. **Scopes** bound what the key may touch at all. The vocabulary lives in
--    `packages/shared/src/api-keys.ts` and reaches nothing that could take the
--    account over — no billing, no roster, no numbers, no settings.
-- 2. **`created_by`** is what the number-access filter resolves against at
--    request time, not at creation time. #106 gives each member a per-number
--    visibility set; a key inherits its creator's, live. So an admin who
--    later loses sight of a number takes their key's sight of it with them,
--    and a key can never be a way to keep an access that has been withdrawn.
--
-- That second one is why `created_by` is NOT NULL and why the FK restricts
-- rather than nullifies: a key whose creator is gone is a key answering to
-- nobody's access, and the honest answer is that it stops working.
-- ===========================================================================

create table public.api_keys (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete restrict,
  -- What the owner called it. Their label, so they can revoke the right one.
  name          text not null check (length(name) between 1 and 120),
  -- The first twelve characters, in the clear, for identification only.
  token_prefix  text not null check (length(token_prefix) between 8 and 24),
  -- SHA-256 hex of the whole token. 64 characters, always.
  token_hash    text not null check (length(token_hash) = 64),
  -- Least privilege by resource. An empty array is a key that can do nothing,
  -- which is a mistake rather than a preference.
  scopes        text[] not null check (cardinality(scopes) > 0),
  -- Whose access this key borrows. See the header — resolved live.
  created_by    uuid not null references auth.users(id) on delete restrict,
  created_at    timestamptz not null default now(),
  -- #243 asks for "last-used visible". Stamped best-effort on use rather than
  -- transactionally: an integrator asking "is this key still in use before I
  -- delete it" needs the answer to the nearest minute, not the nearest request,
  -- and a synchronous write per API call would make every request pay for a
  -- question nobody asks per request.
  last_used_at  timestamptz,
  -- Revocation is a stamp, not a delete. "When did we turn that off, and who"
  -- is the first question after an incident, and a deleted row cannot answer
  -- it. The lookup treats a stamped row as absent.
  revoked_at    timestamptz,
  revoked_by    uuid references auth.users(id) on delete restrict,
  -- Optional expiry. A key that is going to be pasted into a contractor's
  -- laptop for one migration should be able to stop working by itself.
  expires_at    timestamptz
);

-- The lookup on every public request: one row, by hash. Unique because two
-- rows answering to one token is a state with no correct behaviour.
create unique index api_keys_token_hash_idx on public.api_keys (token_hash);

create index api_keys_company_idx on public.api_keys (company_id, created_at desc);

alter table public.api_keys enable row level security;
revoke all on table public.api_keys
  from public, anon, authenticated, service_role;
-- No policy and no grant below service_role, for the same reason
-- `webhook_endpoints` has none: anything that can read `token_hash` can check
-- a stolen token against it offline, and anything that can WRITE this table can
-- mint itself a credential. The only path in is the Worker, behind /v1
-- authorization.
grant select, insert, update, delete on table public.api_keys to service_role;

-- ---------------------------------------------------------------------------
-- A workspace may not own an unbounded number of keys.
--
-- Blast radius, not tidiness: every live key is another credential that can
-- leak, and a workspace holding fifty of them cannot tell which one to revoke.
-- Counts only the LIVE ones, so revoking makes room — otherwise the cap would
-- punish the very thing we want somebody to do after a leak.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_api_key_cap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  select count(*) into v_count
    from public.api_keys
   where company_id = new.company_id
     and revoked_at is null;
  if v_count >= 10 then
    raise exception 'api key cap reached for company %', new.company_id
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

revoke execute on function public.enforce_api_key_cap()
  from public, anon, authenticated;

create trigger api_keys_cap
  before insert on public.api_keys
  for each row execute function public.enforce_api_key_cap();

-- ---------------------------------------------------------------------------
-- Resolve a presented token to a live key, or to nothing.
--
-- One round trip, and it answers the whole question: is this hash known, is
-- the key un-revoked, is it un-expired, and is the workspace itself still
-- live. A route doing those four as separate reads is a route where one of
-- them eventually gets skipped.
--
-- Deliberately returns NOTHING rather than a reason. The caller answers 401
-- either way, and a public endpoint that distinguishes "no such key" from
-- "revoked key" tells an attacker which of their guesses was once real.
--
-- The `last_used_at` stamp rides along here rather than in a second statement,
-- so "when was this last used" cannot drift from "when was this last accepted".
-- ---------------------------------------------------------------------------
create or replace function public.api_resolve_key(p_token_hash text)
returns table (
  id uuid,
  company_id uuid,
  scopes text[],
  created_by uuid
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  update public.api_keys k
     set last_used_at = now()
    from public.companies c
   where k.token_hash = p_token_hash
     and k.revoked_at is null
     and (k.expires_at is null or k.expires_at > now())
     and c.id = k.company_id
     and c.deleted_at is null
  returning k.id, k.company_id, k.scopes, k.created_by;
end $$;

revoke execute on function public.api_resolve_key(text)
  from public, anon, authenticated;
grant execute on function public.api_resolve_key(text) to service_role;

-- ---------------------------------------------------------------------------
-- The workspace teardown has to reach this table.
--
-- Body copied forward from 20260814060000 with `api_keys` added.
-- `purge_workspace.test.sql` derives the expected set from the catalogue, so
-- this is the same change as creating the table rather than a follow-up.
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
    'widget_verifications',
    -- #243: the delivery log carries the payloads we sent out, which is the
    -- workspace's own message and contact content. The child goes first.
    'webhook_deliveries', 'webhook_endpoints',
    -- #243: the credentials themselves. A workspace that has been erased must
    -- not leave a live token behind that still resolves to its id.
    'api_keys'
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
