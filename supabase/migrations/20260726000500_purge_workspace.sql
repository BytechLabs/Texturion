-- ===========================================================================
-- [#341 / D48] Erasing a closed workspace — phase 2.
--
-- The ordered teardown from docs/DELETION.md, one batch at a time, so an
-- interrupted run resumes instead of restarting or stranding a workspace
-- half-erased. Resumability needs no cursor column: each call deletes rows, so
-- the database state IS the position and re-running is idempotent by
-- construction.
--
-- The caller (apps/api/src/workspace/purge.ts) drives the loop because three
-- of the steps must remove Storage objects BEFORE their rows go — the rows are
-- where the paths live.
--
-- The `companies` row is NOT deleted. It is anonymised: `opt_outs.company_id`
-- is NOT NULL and a STOP outlives the business that received it, so the row
-- stays as the anchor that keeps those enforceable and gives the CASL consent
-- artifact somewhere to hang, carrying none of the business's identity.
-- ===========================================================================

-- When the erasure finished. NULL on everything that has not been purged.
alter table public.companies
  add column if not exists purged_at timestamptz;

comment on column public.companies.purged_at is
  'D48 phase 2: when this workspace was erased. The row survives, anonymised, because opt_outs and the CASL consent artifact hang off it.';

-- ---------------------------------------------------------------------------
-- [#341] Delete up to p_limit rows from the FIRST non-empty table in the
-- teardown order, and report what happened.
--
-- Returns jsonb:
--   { "step": "<table>", "deleted": n, "done": false }
--   { "step": null,      "deleted": 0, "done": true }   -- nothing left to cut
--
-- `done` means the row-deleting phase is over; the caller then anonymises.
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
  -- The order is forced by restrict edges BETWEEN company-scoped tables: a
  -- child goes before its parent whatever the company-level policy says.
  -- Mirrors docs/DELETION.md; a new company-scoped table missing from both is
  -- a workspace that cannot be erased.
  v_tables text[] := array[
    'usage_events', 'tasks', 'message_mentions', 'message_attachments',
    'attachments', 'messages', 'conversation_events', 'conversations',
    'call_records', 'calls', 'port_requests', 'text_enablement_orders',
    'contacts', 'phone_numbers', 'tags',
    'templates', 'invites', 'messaging_registrations', 'grace_notices',
    'inbound_notification_days', 'usage_alerts', 'egress_events', 'audit_log',
    'company_members',
    -- Formerly cascading with the companies row; explicit now that it survives.
    'call_member_legs', 'company_ai_settings', 'company_ai_usage',
    'company_modules', 'email_ledger', 'member_telephony_credentials',
    'notification_prefs', 'notification_read_items', 'notification_reads',
    'number_access', 'outbound_call_authorizations', 'outbound_dial_leases',
    'provider_costs'
  ];
  v_table text;
  v_deleted int;
begin
  if p_limit is null or p_limit <= 0 then
    raise exception 'purge_workspace_step: p_limit must be > 0';
  end if;
  -- Refuse to erase a workspace that is not closed, or whose window has not
  -- passed. The window is the customer's chance to change their mind, and a
  -- purge that ignores it is the one bug this whole design exists to prevent.
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

-- ---------------------------------------------------------------------------
-- [#341] The last step: strip the workspace row of everything that identifies
-- the business, and stamp when.
--
-- What stays is the minimum a regulator's question needs an answer to — was
-- there consent, on what date, in what jurisdiction — plus the anchor
-- `opt_outs` hangs off. Nothing here says who the business was.
-- ---------------------------------------------------------------------------
create or replace function public.anonymize_purged_workspace(p_company_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.companies
     where id = p_company_id and deleted_at is not null
       and purge_after is not null and purge_after <= now()
  ) then
    raise exception 'anonymize_purged_workspace: % is not past its purge window', p_company_id;
  end if;

  update public.companies
     set name = 'Closed workspace',
         stripe_customer_id = null,
         stripe_subscription_id = null,
         telnyx_messaging_profile_id = null,
         chosen_number_e164 = null,
         away_message = null,
         mctb_message = null,
         voicemail_greeting = null,
         cnam_display_name = null,
         business_hours = '{}'::jsonb,
         purged_at = now()
   where id = p_company_id;

  return jsonb_build_object('outcome', 'anonymized');
end $$;

revoke execute on function public.anonymize_purged_workspace(uuid)
  from public, anon, authenticated;
grant execute on function public.anonymize_purged_workspace(uuid) to service_role;
