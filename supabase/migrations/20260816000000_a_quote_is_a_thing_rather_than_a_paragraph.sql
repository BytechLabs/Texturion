-- ===========================================================================
-- #287 — a quote becomes an object.
--
-- The commercial centre of a trades business is the quote, and in this product
-- it has been a paragraph in a text message: not findable, not comparable, not
-- followable, not acceptable except by somebody typing "yeah go ahead". The
-- expensive dispute in the trades is "what did we quote?", and the answer has
-- been buried in a thread from four months ago.
--
-- ## The boundary, written into the schema rather than left to discipline
--
-- #287's own devil's advocate is right that this is a doorway to invoicing,
-- accounting integration and tax handling, none of which we should build. So
-- the columns stop where the product stops:
--
--   * ONE amount, in cents, in one currency. No line-item table, no tax
--     column, no discount column. A quote that needs a tax breakdown is a
--     quote that wanted an estimating package, and that is a different product
--     with a ten-year head start.
--   * NO invoice number, no payment terms, no PO field. The accepted quote
--     leads to #224's payment request, which is where money is handled.
--
-- A schema is the honest place for a boundary: a column nobody added is a
-- feature nobody has to argue about later.
--
-- ## Why the link is not here
--
-- "Sent as a link the customer opens without an account" is already solved.
-- `public_links` (#335, D75) mints one token for one object with one purpose,
-- stores only its SHA-256, and its purpose check already names `quote_view`
-- and `quote_accept` against this issue number. This table therefore has no
-- token column, no secret, and no expiry-of-the-link — those belong to the
-- link, which can be reissued without touching the quote.
--
-- ## Why `status` is text and not an enum
--
-- The vocabulary lives in `packages/shared` and is validated there, the same
-- decision #243's event names took two migrations ago. Writing the list again
-- in SQL is the shape that has already cost this repo three rounds: two lists,
-- one authoritative, neither saying so. The check below is a floor against
-- garbage, not a second home for the rule.
--
-- ## Deletion, which is NOT just the cascade
--
-- The foreign keys cascade, but that is not what erases a workspace here.
-- `purge_workspace_step` walks an explicit, ORDERED list and deletes in
-- bounded batches, so a table absent from that array is a table a purge never
-- touches — and the ordering is load-bearing: this one references
-- `conversations` and `contacts`, so it has to go before them, exactly where
-- `payment_requests` sits for the same reason.
--
-- The function is therefore replaced below with `quotes` in position. Its
-- grants are restated afterwards because `create or replace` does not preserve
-- them: a recreated function is handed back the default PUBLIC execute grant
-- that anon and authenticated inherit.
-- ===========================================================================

create table public.quotes (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  -- The thread it was quoted in. A quote always has one: it is the answer to
  -- somebody asking how much, and losing that link is losing the context the
  -- dispute is actually about.
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  -- WHO it was quoted to, denormalised from the conversation on purpose. A
  -- conversation threads by contact-relationship (D7) and can outlive a
  -- contact edit; the quote records who the number belonged to when the money
  -- was named.
  contact_id      uuid not null references public.contacts(id) on delete cascade,

  -- One number. Cents, like every other amount in this schema, because a
  -- float that is a price is a rounding error waiting for a customer.
  amount_cents    bigint not null check (amount_cents > 0),
  -- Three letters, lowercased, matching the billing columns rather than
  -- inventing a second convention.
  currency        text not null check (currency in ('usd', 'cad')),

  -- What the money is for, in the crew's own words. Free text a person typed,
  -- which is why this table is in the personal-data inventory.
  description     text not null check (length(btrim(description)) > 0),

  -- 'draft' | 'sent' | 'viewed' | 'accepted' | 'declined' | 'expired'.
  -- A floor, not the vocabulary: see the header.
  status          text not null default 'draft' check (length(status) > 0),

  -- When it stops being offerable. NOT NULL on purpose: a quote with no expiry
  -- is a price the business is bound to forever, which is not what anyone
  -- means by quoting.
  expires_at      timestamptz not null,

  -- The three moments worth having a time for. Each nullable because each may
  -- never happen, and each set once.
  sent_at         timestamptz,
  viewed_at       timestamptz,
  decided_at      timestamptz,

  -- Who wrote it. `set null` rather than cascade: a crew member leaving does
  -- not retract a quote the business made, and the record of the amount has to
  -- survive them.
  created_by      uuid references auth.users(id) on delete set null,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- The queue the owner opens every morning: this workspace's quotes, newest
-- first, filtered by status. The index carries `status` because "what is still
-- outstanding" is the question this table exists to answer.
create index quotes_company_status_idx
  on public.quotes (company_id, status, created_at desc);

-- "What did we quote this customer?" — the dispute question, asked per contact.
create index quotes_contact_idx
  on public.quotes (contact_id, created_at desc);

-- The thread view asks for the quotes in one conversation.
create index quotes_conversation_idx
  on public.quotes (conversation_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Grants. Same shape as every other table here: the Worker is the only way in.
--
-- Row-level security is enabled and no policy is written, which is
-- deny-by-default for anon and authenticated. That stops anything reaching
-- this table outside the API; it does not second-guess the API's own queries,
-- because the Worker's key bypasses RLS. Tenant scoping is the API's job on
-- every request, and SPEC §10 is explicit that this is one layer rather than
-- two.
-- ---------------------------------------------------------------------------
alter table public.quotes enable row level security;
revoke all on table public.quotes
  from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.quotes
  to service_role;

-- ---------------------------------------------------------------------------
-- The purge walks an explicit list, so a new table has to join it.
--
-- Copied from the CURRENT definition (20260814070000) with one entry added,
-- rather than written from memory: a replace that silently dropped a table
-- would leave that table behind on every future purge, which is the failure
-- nobody sees until somebody asks whether the erase was complete.
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
    -- #287: references conversations and contacts, so it goes before both.
    'quotes',
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
