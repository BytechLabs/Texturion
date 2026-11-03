-- D146: the tables and functions that only served our own monitoring go.
--
-- The liveness ledger, the webhook rejection counter, the inbound canary, the
-- synthetic probes, call silence, the activation stall report, the ring success
-- watch and the email health check decided whether something was broken and
-- told somebody. That is PostHog's job now: the API sends an event and a
-- PostHog alert holds the threshold, so nothing here has a reader left.
--
-- Kept, because they still do product work or feed a gauge: api_telnyx_spend_since,
-- api_voice_capacity_read, api_fleet_stored_bytes, api_aup_signals,
-- email_events and email_suppressions.
--
-- destructive-ok: every row dropped here is our own bookkeeping about the
-- system (heartbeats, probe results, canary runs, counters and the two
-- workspace funnel states those reports kept), none of it customer data or
-- read by the product. The Worker deployed right after this migration calls
-- none of it; until it is live, the old Worker's calls are best effort or a
-- failed cron run, and either is only logged.

drop function public.record_heartbeat(text, timestamptz);
drop function public.api_liveness_check(jsonb, timestamptz, int);
drop function public.record_webhook_rejection(text, timestamptz);
drop function public.api_webhook_inbound_probe(timestamptz, timestamptz);
drop function public.confirm_inbound_canary(timestamptz, int);
drop function public.inbound_canary_unanswered(timestamptz);
drop function public.probe_runs_this_month(text);
drop function public.prune_probe_results(int);
drop function public.api_assess_call_silence();
drop function public.api_assess_activation_stall();
drop function public.api_ring_success(timestamptz);
drop function public.api_email_health(timestamptz, int);

drop table public.liveness_heartbeats;
drop table public.webhook_rejections;
drop table public.inbound_canary_runs;
drop table public.probe_results;
drop table public.call_silence_state;
drop table public.activation_stall_state;

-- The erasure roster deletes by table name, so a dropped table left in it would
-- make every purge step throw. The body is the current one from
-- 20260825020000_two_way_calendar_sync_outbox.sql, copied whole without
-- 'activation_stall_state' and 'call_silence_state'.
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
    -- #245: provider payload copies/credentials and pending external work.
    'calendar_reminder_replans',
    'calendar_outbox', 'task_calendar_links', 'webhook_subscriptions',
    'oauth_states', 'calendar_connections',
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
    'appointment_reminder_rules', 'billing_disputes',
    'blocked_senders', 'cancellation_reasons',
    'contact_field_defs', 'data_exports', 'feature_flag_overrides',
    'high_priority_push_budget', 'high_priority_push_days', 'lead_sources',
    'number_port_outs', 'ownership_confirmations', 'ownership_transfers',
    'prepayments', 'public_links', 'referrals', 'retention_notices',
    'saved_views',
    'stripe_connect_accounts',
    'voicemail_greetings',
    'provider_costs',
    'widget_verifications',
    'webhook_deliveries', 'webhook_endpoints',
    'api_keys',
    'calendar_feed_tokens'
  ];
  v_table text;
  v_deleted int;
  v_cleanup_count int;
  v_cleanup_unconfirmed boolean;
  v_cleanup_unconfirmed_count int;
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

  select c.calendar_cleanup_unconfirmed_at is not null,
         c.calendar_cleanup_unconfirmed_count
    into v_cleanup_unconfirmed, v_cleanup_unconfirmed_count
    from public.companies c where c.id = p_company_id;

  -- Provider cleanup is an external side effect and therefore cannot be
  -- replaced by cascading the local rows at the end of the retention window.
  -- A closed workspace remains purge-ineligible until every stopWatch and
  -- scrub intent is either committed or explicitly terminalized as the
  -- disclosed cleanup_abandoned state.
  if exists (
       select 1 from public.calendar_connections c
        where c.company_id = p_company_id and c.revoked_at is null
     ) or exists (
       select 1 from public.webhook_subscriptions s
        where s.company_id = p_company_id and s.revoked_at is null
     ) or exists (
       select 1 from public.calendar_outbox o
        where o.company_id = p_company_id and o.state in ('queued', 'leased')
     ) then
    -- The statutory retention deadline is also a privacy boundary: provider
    -- ambiguity cannot retain copied customer content forever.  Serialize and
    -- terminalize local recovery state, wipe credentials, and record an
    -- explicit UNCONFIRMED outcome for the already-captured purge receipt
    -- address.  Nothing here reports remote deletion as successful.
    select count(*) into v_cleanup_count
      from public.calendar_connections c
     where c.company_id = p_company_id and c.revoked_at is null;
    perform 1 from public.calendar_connections c
     where c.company_id = p_company_id order by c.id for update;
    update public.webhook_subscriptions
       set status = 'revoked', revoked_at = now(),
           renewal_generation = renewal_generation + 1,
           renewal_lease_owner = null, renewal_lease_expires_at = null,
           last_error_code = 'cleanup_abandoned_retention_deadline',
           last_error_detail = 'Remote stopWatch was not confirmed before local erasure.'
     where company_id = p_company_id and revoked_at is null;
    update public.calendar_outbox
       set state = 'cancelled', cancelled_at = now(),
           lease_owner = null, lease_expires_at = null,
           last_error_code = 'cleanup_abandoned_retention_deadline',
           last_error_detail = 'Remote calendar cleanup was not confirmed before local erasure.'
     where company_id = p_company_id and state in ('queued', 'leased');
    update public.task_calendar_links
       set link_state = 'unlinked', unlinked_at = now(),
           last_sent_snapshot = null,
           last_sent_provider_version = null,
           last_sent_at = null,
           conflict_ours_snapshot = null,
           conflict_theirs_snapshot = null,
           conflict_detected_at = null,
           event_removed_at = null,
           refusal_code = null,
           refusal_detail = null,
           refused_at = null
     where company_id = p_company_id and link_state <> 'unlinked';
    update public.calendar_connections
       set status = 'revoked', revoked_at = now(),
           remote_cleanup_unconfirmed = true,
           credential_ciphertext = null,
           credential_iv = null,
           credential_key_version = null,
           credential_generation = credential_generation + 1,
           credential_refresh_lease_owner = null,
           credential_refresh_lease_expires_at = null,
           disconnect_cleanup_action = null,
           sync_cursor = null, cursor_updated_at = null,
           sync_due_at = null, pull_full_sync = false,
           pull_followup_requested = false,
           pull_lease_owner = null, pull_lease_expires_at = null,
           last_error_code = 'cleanup_abandoned_retention_deadline',
           last_error_detail = 'Remote calendar cleanup was not confirmed before local erasure.',
           last_error_at = now()
     where company_id = p_company_id and revoked_at is null;
    update public.companies
       set calendar_cleanup_unconfirmed_at = coalesce(
             calendar_cleanup_unconfirmed_at, now()
           ),
           calendar_cleanup_unconfirmed_count =
             calendar_cleanup_unconfirmed_count + greatest(v_cleanup_count, 1)
     where id = p_company_id
    returning calendar_cleanup_unconfirmed_count
         into v_cleanup_unconfirmed_count;
    return jsonb_build_object(
      'step', 'calendar_cleanup_abandoned',
      'deleted', 0,
      'done', false,
      'remote_calendar_cleanup_unconfirmed', true,
      'remote_calendar_cleanup_unconfirmed_count',
        v_cleanup_unconfirmed_count
    );
  end if;

  foreach v_table in array v_tables loop
    execute format(
      'delete from public.%I where ctid in (
         select ctid from public.%I where company_id = $1 limit $2
       )', v_table, v_table)
      using p_company_id, p_limit;
    get diagnostics v_deleted = row_count;
    if v_deleted > 0 then
      return jsonb_build_object(
        'step', v_table, 'deleted', v_deleted, 'done', false,
        'remote_calendar_cleanup_unconfirmed', v_cleanup_unconfirmed,
        'remote_calendar_cleanup_unconfirmed_count',
          v_cleanup_unconfirmed_count
      );
    end if;
  end loop;

  return jsonb_build_object(
    'step', null, 'deleted', 0, 'done', true,
    'remote_calendar_cleanup_unconfirmed', v_cleanup_unconfirmed,
    'remote_calendar_cleanup_unconfirmed_count',
      v_cleanup_unconfirmed_count
  );
end $$;

revoke execute on function public.purge_workspace_step(uuid, int)
  from public, anon, authenticated;
grant execute on function public.purge_workspace_step(uuid, int) to service_role;
