-- Erasure has to reach everything, and it did not.
--
-- `purge_workspace_step` deletes from a hand-written array of table names, and
-- because D48 ANONYMISES the `companies` row instead of deleting it, the
-- `on delete cascade` every company-scoped table declares never fires. So a
-- table that is not named in that array is not deleted by anything — it simply
-- stays, for the life of the install, after the customer has been emailed a
-- receipt telling them their workspace was erased.
--
-- Twenty-one tables were in that state. The list was not written by hand for
-- this migration either; it was derived from `information_schema`, by taking
-- every base table with a `company_id`, subtracting what the function already
-- names, and subtracting what is reachable by cascade from something it names.
-- `supabase/tests/purge_coverage.test.sql` now runs that same derivation on
-- every CI run, so the next table cannot be forgotten in silence.
--
-- What was being kept, to be concrete about why this matters more than a list
-- of names suggests: `blocked_senders` holds a phone number and the free-text
-- reason a member typed about a person; `cancellation_reasons.detail` is up to
-- two thousand characters of exit interview; `voicemail_greetings` points at a
-- recording of the owner's own voice.
--
-- TWO TABLES ARE DELIBERATELY NOT ADDED and the test names both, so that the
-- exception is a decision rather than an oversight:
--
--   `opt_outs`             — a STOP belongs to the person who sent it, not to
--                            the business it was sent to, and it has to keep
--                            working after that business is gone (DELETION.md,
--                            "kept whole, forever").
--   `contact_consent_events` — the CASL artifact, kept to the statutory floor.
--
-- Recoverable, which is why this is a fix rather than an incident: the function
-- gates on `deleted_at` / `purge_after` and NOT on `purged_at`, so once this
-- ships an operator can re-run it over workspaces already purged and the
-- leftovers go then.
--
-- The `voicemail-greetings` bucket is added to the object sweep in the same
-- change (apps/api/src/workspace/purge.ts). Deleting the row without that would
-- strand the audio in storage permanently, with nothing left pointing at it.

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
    -- #247: before `messages`, which it hangs off.
    'conversation_summaries',
    'messages', 'conversation_events', 'conversations',
    'call_records', 'calls', 'port_requests', 'text_enablement_orders',
    'contacts', 'phone_numbers',
    -- #475: before `templates`, so the batch loop drains the ledger rather
    -- than leaving one cascade to delete an unbounded number of rows.
    'template_uses',
    'tags',
    'templates', 'invites', 'messaging_registrations', 'grace_notices',
    'inbound_notification_days', 'usage_alerts', 'egress_events', 'audit_log',
    'company_members',
    'call_member_legs', 'company_ai_settings', 'company_ai_usage',
    'company_modules', 'email_ledger', 'member_telephony_credentials',
    'notification_prefs', 'notification_read_items', 'notification_reads',
    'number_access', 'outbound_call_authorizations', 'outbound_dial_leases',
    -- #581: everything in this block survived erasure entirely. `v_tables` is a
    -- hand-written list, and because the `companies` row is ANONYMISED rather
    -- than deleted (D48) the `on delete cascade` these tables declare never
    -- fires — so they simply stayed, after the customer was emailed a receipt
    -- saying their workspace had been erased. Among them: the free-text reason
    -- a member typed about a blocked person, a 2,000-character exit interview,
    -- and a recording of the owner's own voice.
    --
    -- A pgTAP test now DERIVES this list from `information_schema` and fails on
    -- any company-scoped table that is neither named here nor reachable by
    -- cascade, so the next one cannot be forgotten in silence. `opt_outs` and
    -- `contact_consent_events` are the two deliberate exceptions and the test
    -- names them: a STOP belongs to the person who sent it and outlives the
    -- business (DELETION.md), and the consent artifact is kept to the CASL floor.
    --
    -- No foreign keys run between these and nothing restricts them, so the
    -- order inside the block does not matter; alphabetical to stay readable.
    'activation_stall_state', 'appointment_reminder_rules', 'billing_disputes',
    'blocked_senders', 'call_silence_state', 'cancellation_reasons',
    'contact_field_defs', 'data_exports', 'feature_flag_overrides',
    'high_priority_push_budget', 'high_priority_push_days', 'lead_sources',
    'number_port_outs', 'ownership_confirmations', 'ownership_transfers',
    'prepayments', 'public_links', 'referrals', 'retention_notices',
    'saved_views',
    -- The bucket behind this one is swept by the same change. Adding the row
    -- without that would strand the audio in storage permanently.
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
