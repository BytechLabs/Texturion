-- #245 — the workspace purge takes the calendar feed credentials with it.
--
-- `calendar_feed_tokens` already has an `on delete cascade` from companies,
-- which is the right belt: dropping the company row drops the tokens. This is
-- the braces, and it is the one that actually runs — a teardown deletes a
-- workspace's rows in bounded steps rather than dropping the company outright,
-- so a table missing from this list is a table that survives the erasure.
--
-- purge_coverage.test.sql caught it, which is the guard doing its job: exactly
-- two tables are allowed to outlive a workspace and both have a reason written
-- down (an opt-out belongs to the person who sent it, not the business it was
-- sent to; the consent ledger answers a regulator). A calendar credential is
-- neither, and one left behind would keep resolving to a company id that no
-- longer exists.
--
-- The body below is the CURRENT function copied whole, with one entry added.
-- Restating it in full is the point rather than the cost: a partial
-- redefinition would silently stop purging whichever tables the copy forgot.
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
    'api_keys',
    -- #245: a member's calendar subscription credential. A workspace that
    -- has been erased must not leave a feed behind that still resolves to
    -- its id and answers with somebody's schedule.
    'calendar_feed_tokens'
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

revoke execute on function public.purge_workspace_step(uuid, int)
  from public, anon, authenticated;
grant execute on function public.purge_workspace_step(uuid, int) to service_role;
