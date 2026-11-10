-- #692: a job that is finished, reassigned, unassigned, undated or deleted
-- leaves the member's calendar; connecting only seeds open jobs.
--
-- D137 amendment (finished jobs leave the calendar). The calendar mirrors work
-- still to do. A task is "off the calendar" when it is deleted OR done, where
-- done is the effective done state (task_done_at): messages.done_at for a
-- message-anchored task (D17), tasks.done_at for a call-anchored or anchorless
-- one (D64). Becoming off the calendar queues the existing 'unlink' action,
-- which the worker now fulfils by deleting the provider event (falling back to
-- the old note-and-leave only when deleting is impossible or refused).
-- Reopening a job that is still assigned, dated and in the sync window takes
-- the ordinary create path on the unlinked mapping.

-- The whole task-to-outbox decision, for a task row. The task trigger and the
-- message done-state trigger both call it, so a finished job is decided in one
-- place whichever row owns its done state.
create or replace function public.calendar_enqueue_task_sync(p_task public.tasks)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  p     public.tasks := p_task;
  v_off boolean;
begin
  v_off := p.deleted_at is not null
        or public.task_done_at(p) is not null;

  -- A newly connected calendar has create intents before links exist.  They
  -- are still transactional task mirrors: a move rebuilds the one live body,
  -- and deletion/reassignment cancels creation instead of producing a ghost
  -- event from the stale queue row.
  update public.calendar_outbox o
     set state = 'cancelled', cancelled_at = now(),
         lease_owner = null, lease_expires_at = null,
         generation = o.generation + 1,
         updated_at = now()
    from public.calendar_connections c
   where o.connection_id = c.id
     and o.company_id = p.company_id
     and o.task_id = p.id
     and o.action = 'create'
     and o.state = 'queued'
     and not o.provider_effect_ambiguous
     and (
       v_off
       or p.due_at is null
       or not public.calendar_task_in_sync_window(p.due_at)
       or p.assigned_user_id is distinct from c.user_id
       or not public.calendar_task_access_allowed(
         c.user_id, p.company_id, p.conversation_id
       )
     );

  -- A leased create may already exist remotely.  Never cancel its DB record
  -- out from under the worker: bumping generation tells commit-create to map
  -- the returned event and immediately queue the now-current follow-up.
  update public.calendar_outbox o
     set generation = o.generation + 1,
         attempts = 0,
         updated_at = now()
    from public.calendar_connections c
   where o.connection_id = c.id
     and o.company_id = p.company_id
     and o.task_id = p.id
     and o.action = 'create'
     and o.state = 'leased'
     and (
       v_off
       or p.due_at is null
       or not public.calendar_task_in_sync_window(p.due_at)
       or p.assigned_user_id is distinct from c.user_id
       or not public.calendar_task_access_allowed(
         c.user_id, p.company_id, p.conversation_id
       )
     );

  update public.calendar_outbox o
     set requested_snapshot = public.calendar_task_snapshot(
           p.due_at, p.title, p.description, null, c.selected_calendar_timezone
         ),
         generation = o.generation + 1,
         attempts = 0,
         available_at = least(o.available_at, now()),
         last_error_code = null,
         last_error_detail = null,
         updated_at = now()
    from public.calendar_connections c
   where o.connection_id = c.id
     and o.company_id = p.company_id
     and o.task_id = p.id
     and o.action = 'create'
     and o.state in ('queued', 'leased')
     and not o.provider_effect_ambiguous
     and not v_off
     and p.due_at is not null
     and public.calendar_task_in_sync_window(p.due_at)
     and p.assigned_user_id = c.user_id
     and public.calendar_task_access_allowed(
       c.user_id, p.company_id, p.conversation_id
     );

  insert into public.calendar_outbox (
    company_id, connection_id, task_id, link_id, action,
    requested_snapshot, provider_precondition
  )
  select
    p.company_id,
    l.connection_id,
    p.id,
    l.id,
    case
      when not public.calendar_task_access_allowed(
        c.user_id, p.company_id, p.conversation_id
      ) then 'scrub'
      when v_off
        or p.due_at is null
        or not public.calendar_task_in_sync_window(p.due_at)
        or p.assigned_user_id is distinct from c.user_id
      then 'unlink'
      else 'upsert'
    end,
    case
      when v_off
        or p.due_at is null
        or not public.calendar_task_in_sync_window(p.due_at)
        or p.assigned_user_id is distinct from c.user_id
        or not public.calendar_task_access_allowed(
          c.user_id, p.company_id, p.conversation_id
        )
      then null
      else public.calendar_task_snapshot(
        p.due_at, p.title, p.description, l.base_snapshot, co.timezone
      )
    end,
    l.provider_version
  from public.task_calendar_links l
  join public.calendar_connections c
    on c.id = l.connection_id and c.company_id = l.company_id
  join public.companies co on co.id = p.company_id
  where l.company_id = p.company_id
    and l.task_id = p.id
    and l.link_state <> 'unlinked'
    and (
      l.link_state = 'active'
      or v_off
      or p.due_at is null
      or not public.calendar_task_in_sync_window(p.due_at)
      or p.assigned_user_id is distinct from c.user_id
      or not public.calendar_task_access_allowed(
        c.user_id, p.company_id, p.conversation_id
      )
    )
    and c.revoked_at is null
  on conflict (connection_id, task_id)
    where state in ('queued', 'leased')
  do update set
    link_id = case when public.calendar_outbox.provider_effect_ambiguous
      then public.calendar_outbox.link_id else excluded.link_id end,
    action = case when public.calendar_outbox.provider_effect_ambiguous
      then public.calendar_outbox.action else excluded.action end,
    requested_snapshot = case when public.calendar_outbox.provider_effect_ambiguous
      then public.calendar_outbox.requested_snapshot else excluded.requested_snapshot end,
    provider_precondition = case when public.calendar_outbox.provider_effect_ambiguous
      then public.calendar_outbox.provider_precondition else excluded.provider_precondition end,
    generation = public.calendar_outbox.generation + 1,
    attempts = case when public.calendar_outbox.provider_effect_ambiguous
      then public.calendar_outbox.attempts else 0 end,
    available_at = least(public.calendar_outbox.available_at, now()),
    last_error_code = null,
    last_error_detail = null,
    updated_at = now();

  -- Tasks can become calendar-eligible after the connection exists: both a
  -- brand-new assigned/due task and a reassignment to this member need their
  -- first provider occurrence.  A non-unlinked mapping remains authoritative
  -- (including attention states), while an unlinked mapping is deliberately
  -- reused so the connection/task uniqueness and attention identity survive.
  insert into public.calendar_outbox (
    company_id, connection_id, task_id, link_id, action,
    requested_snapshot, provider_precondition
  )
  select
    p.company_id,
    c.id,
    p.id,
    l_unlinked.id,
    'create',
    public.calendar_task_snapshot(
      p.due_at, p.title, p.description, null,
      c.selected_calendar_timezone
    ),
    null
  from public.calendar_connections c
  left join public.task_calendar_links l_unlinked
    on l_unlinked.connection_id = c.id
   and l_unlinked.task_id = p.id
   and l_unlinked.link_state = 'unlinked'
  where not v_off
    and p.due_at is not null
    and public.calendar_task_in_sync_window(p.due_at)
    and p.assigned_user_id = c.user_id
    and public.calendar_task_access_allowed(
      c.user_id, p.company_id, p.conversation_id
    )
    and c.company_id = p.company_id
    and c.status = 'active'
    and c.revoked_at is null
    and not exists (
      select 1
        from public.task_calendar_links l
       where l.connection_id = c.id
         and l.task_id = p.id
         and l.link_state <> 'unlinked'
    )
    and not exists (
      select 1
        from public.calendar_outbox o
       where o.connection_id = c.id
         and o.task_id = p.id
         and o.state in ('queued', 'leased')
    )
  on conflict (connection_id, task_id)
    where state in ('queued', 'leased')
  do nothing;
end $$;

revoke execute on function public.calendar_enqueue_task_sync(public.tasks)
  from public, anon, authenticated;

create or replace function public.calendar_enqueue_mapped_task_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(current_setting('loonext.calendar_provider_apply', true), '') = 'on' then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.due_at is not distinct from old.due_at
       and new.title is not distinct from old.title
       and new.description is not distinct from old.description
       and new.deleted_at is not distinct from old.deleted_at
       and new.done_at is not distinct from old.done_at
       and new.assigned_user_id is not distinct from old.assigned_user_id then
      return new;
    end if;
  end if;

  perform public.calendar_enqueue_task_sync(new);
  return new;
end $$;

revoke execute on function public.calendar_enqueue_mapped_task_change()
  from public, anon, authenticated;

-- A message-anchored task is finished or reopened on messages.done_at (D17);
-- the task row itself does not change, so the task trigger never sees it.
create or replace function public.calendar_message_done_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.tasks%rowtype;
begin
  for v_task in
    select * from public.tasks where message_id = new.id
  loop
    perform public.calendar_enqueue_task_sync(v_task);
  end loop;
  return null;
end $$;

revoke execute on function public.calendar_message_done_changed()
  from public, anon, authenticated;

drop trigger if exists calendar_message_done_changed on public.messages;
create trigger calendar_message_done_changed
after update of done_at on public.messages
for each row when (old.done_at is distinct from new.done_at)
execute function public.calendar_message_done_changed();


create or replace function public.calendar_enqueue_connection_horizon(
  p_connection_id uuid
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  insert into public.calendar_outbox (
    company_id, connection_id, task_id, link_id, action,
    requested_snapshot, provider_precondition
  )
  select t.company_id, c.id, t.id, l_unlinked.id, 'create',
         public.calendar_task_snapshot(
           t.due_at, t.title, t.description, null,
           c.selected_calendar_timezone
         ),
         null
    from public.calendar_connections c
    join public.tasks t
      on t.company_id = c.company_id and t.assigned_user_id = c.user_id
    left join public.task_calendar_links l_unlinked
      on l_unlinked.connection_id = c.id and l_unlinked.task_id = t.id
     and l_unlinked.link_state = 'unlinked'
   where c.id = p_connection_id and c.status = 'active'
     and c.revoked_at is null
     and t.deleted_at is null
     and public.task_done_at(t) is null
     and public.calendar_task_in_sync_window(t.due_at)
     and public.calendar_task_access_allowed(
       c.user_id, t.company_id, t.conversation_id
     )
     and not exists (
       select 1 from public.task_calendar_links l
        where l.connection_id = c.id and l.task_id = t.id
          and l.link_state <> 'unlinked'
     )
     and not exists (
       select 1 from public.calendar_outbox o
        where o.connection_id = c.id and o.task_id = t.id
          and o.state in ('queued', 'leased')
     )
  on conflict (connection_id, task_id)
    where state in ('queued', 'leased')
  do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke execute on function public.calendar_enqueue_connection_horizon(uuid)
  from public, anon, authenticated;


create or replace function public.api_complete_calendar_connection(
  p_company_id                  uuid,
  p_user_id                     uuid,
  p_provider                    text,
  p_provider_account_id         text,
  p_provider_account_label      text,
  p_selected_calendar_id        text,
  p_selected_calendar_name      text,
  p_selected_calendar_timezone  text,
  p_credential_ciphertext       text,
  p_credential_iv               text,
  p_credential_key_version      text,
  p_provider_subscription_id    text,
  p_provider_resource_id        text,
  p_client_state_hash           text,
  p_webhook_expires_at          timestamptz,
  p_sync_cursor                 text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_connection_id  uuid;
  v_existing       public.calendar_connections%rowtype;
  v_reauthorizing  boolean := false;
  v_webhook_id     uuid;
  v_ics_revoked    integer := 0;
  v_creates        integer := 0;
begin
  -- Serialize against workspace close before the member/connection locks.  A
  -- callback for OAuth state minted before closure must not recreate a live
  -- watch inside the retention window.
  perform 1
    from public.companies
   where id = p_company_id and deleted_at is null
   for key share;
  if not found then
    return jsonb_build_object('outcome', 'workspace_closed');
  end if;

  -- Serialises reconnect races for the same member and proves membership in
  -- the same lock that protects the partial-unique replacement.
  perform 1
    from public.company_members
   where company_id = p_company_id and user_id = p_user_id
     and deactivated_at is null
   for update;
  if not found then
    return jsonb_build_object('outcome', 'not_member');
  end if;

  -- The callback creates a provisional remote watch BEFORE entering this
  -- transaction.  Validate every watch field before touching the prior setup;
  -- any later exception rolls the whole replacement back as one unit.
  if nullif(btrim(p_provider_subscription_id), '') is null
     or length(p_provider_subscription_id) > 1000 then
    raise exception 'calendar provider subscription id is required (max 1000 chars)';
  end if;
  if p_provider_resource_id is not null
     and length(p_provider_resource_id) > 2000 then
    raise exception 'calendar provider resource id exceeds 2000 chars';
  end if;
  if p_provider = 'google' and nullif(p_provider_resource_id, '') is null then
    raise exception 'Google calendar watch requires a provider resource id';
  end if;
  if p_client_state_hash is null
     or lower(p_client_state_hash) !~ '^[0-9a-f]{64}$' then
    raise exception 'calendar client state hash must be 64 lowercase hex chars';
  end if;
  if p_webhook_expires_at is null or p_webhook_expires_at <= now() then
    raise exception 'calendar webhook subscription must expire in the future';
  end if;
  if exists (
    select 1
      from public.webhook_subscriptions s
      join public.calendar_connections c on c.id = s.connection_id
     where s.provider_subscription_id = p_provider_subscription_id
       and s.revoked_at is null
       and (c.company_id, c.user_id) is distinct from (p_company_id, p_user_id)
  ) then
    return jsonb_build_object('outcome', 'webhook_conflict');
  end if;

  select * into v_existing
    from public.calendar_connections
   where company_id = p_company_id
     and user_id = p_user_id
     and revoked_at is null
   for update;
  if found then
    if v_existing.status = 'disconnected' then
      return jsonb_build_object(
        'outcome', 'disconnect_in_progress',
        'connection_id', v_existing.id
      );
    end if;
    -- Reauthorization is an in-place credential/watch rotation only.  A
    -- different provider account or calendar is a product-level replacement:
    -- returning before the first write lets the caller stop its provisional
    -- watch and require an explicit disconnect without damaging mappings.
    if v_existing.provider is distinct from p_provider
       or v_existing.provider_account_id is distinct from p_provider_account_id
       or v_existing.selected_calendar_id is distinct from p_selected_calendar_id then
      return jsonb_build_object(
        'outcome', 'replacement_requires_disconnect',
        'connection_id', v_existing.id,
        'provider', v_existing.provider,
        'provider_account_id', v_existing.provider_account_id,
        'selected_calendar_id', v_existing.selected_calendar_id
      );
    end if;
    v_connection_id := v_existing.id;
    v_reauthorizing := true;
  end if;

  update public.webhook_subscriptions s
     set status = 'revoking', revoked_at = null,
         renewal_generation = renewal_generation + 1,
         renewal_available_at = now(),
         renewal_lease_owner = null, renewal_lease_expires_at = null
   where s.revoked_at is null
     and s.connection_id = v_connection_id;

  if v_reauthorizing then
    update public.calendar_connections
       set provider_account_label = p_provider_account_label,
           selected_calendar_name = p_selected_calendar_name,
           selected_calendar_timezone = p_selected_calendar_timezone,
           credential_ciphertext = p_credential_ciphertext,
           credential_iv = p_credential_iv,
           credential_key_version = p_credential_key_version,
           credential_generation = credential_generation + 1,
           credential_refresh_lease_owner = null,
           credential_refresh_lease_expires_at = null,
           status = 'active',
           sync_cursor = p_sync_cursor,
           cursor_updated_at = case when p_sync_cursor is null then null else now() end,
           sync_due_at = now(),
           full_sync_due_at = now(),
           pull_full_sync = false,
           pull_followup_requested = false,
           pull_generation = pull_generation + 1,
           pull_lease_owner = null,
           pull_lease_expires_at = null,
           last_error_code = null,
           last_error_detail = null,
           last_error_at = null
     where id = v_connection_id;
  else
    insert into public.calendar_connections (
      company_id, user_id, provider, provider_account_id, provider_account_label,
      selected_calendar_id, selected_calendar_name, selected_calendar_timezone,
      credential_ciphertext, credential_iv, credential_key_version,
      status, sync_cursor, cursor_updated_at,
      sync_due_at, full_sync_due_at, pull_full_sync, pull_generation
    ) values (
      p_company_id, p_user_id, p_provider, p_provider_account_id,
      p_provider_account_label, p_selected_calendar_id, p_selected_calendar_name,
      p_selected_calendar_timezone, p_credential_ciphertext, p_credential_iv,
      p_credential_key_version, 'active', p_sync_cursor,
      case when p_sync_cursor is null then null else now() end,
      now(), now(), false, 1
    ) returning id into v_connection_id;
  end if;

  insert into public.webhook_subscriptions (
    company_id, connection_id, provider_subscription_id,
    provider_resource_id, provider_calendar_id, client_state_hash,
    status, expires_at, last_renewed_at
  ) values (
    p_company_id, v_connection_id, p_provider_subscription_id,
    p_provider_resource_id, p_selected_calendar_id,
    lower(p_client_state_hash), 'active', p_webhook_expires_at, now()
  ) returning id into v_webhook_id;

  -- Seed the OUTBOUND half only: dated live tasks already assigned to this
  -- member become provider-create intents.  Inbound provider events with no
  -- mapping remain ignored; a calendar event is not authority to manufacture
  -- a Loonext task.
  insert into public.calendar_outbox (
    company_id, connection_id, task_id, link_id, action,
    requested_snapshot, provider_precondition
  )
  select
    t.company_id,
    v_connection_id,
    t.id,
    l_unlinked.id,
    'create',
    public.calendar_task_snapshot(
      t.due_at, t.title, t.description, null, p_selected_calendar_timezone
    ),
    null
  from public.tasks t
  left join public.task_calendar_links l_unlinked
    on l_unlinked.connection_id = v_connection_id
   and l_unlinked.task_id = t.id
   and l_unlinked.link_state = 'unlinked'
  where t.company_id = p_company_id
    and t.assigned_user_id = p_user_id
    and t.due_at is not null
    and t.due_at >= now() - interval '90 days'
    and t.due_at <= now() + interval '365 days'
    and t.deleted_at is null
    and public.task_done_at(t) is null
    and public.calendar_task_access_allowed(
      p_user_id, p_company_id, t.conversation_id
    )
    and not exists (
      select 1
        from public.task_calendar_links l
       where l.connection_id = v_connection_id
         and l.task_id = t.id
         and l.link_state <> 'unlinked'
    )
    and not exists (
      select 1
        from public.calendar_outbox o
       where o.connection_id = v_connection_id
         and o.task_id = t.id
         and o.state in ('queued', 'leased')
    )
  on conflict (connection_id, task_id)
    where state in ('queued', 'leased')
  do nothing;
  get diagnostics v_creates = row_count;

  -- Rule 8: the read-only feed would show the same jobs a second time, and a
  -- user can drag that subscribed copy without any write reaching us.
  update public.calendar_feed_tokens
     set revoked_at = now()
   where company_id = p_company_id
     and user_id = p_user_id
     and revoked_at is null;
  get diagnostics v_ics_revoked = row_count;

  return jsonb_build_object(
    'outcome', 'connected',
    'connection_id', v_connection_id,
    'webhook_subscription_id', v_webhook_id,
    'reauthorized', v_reauthorizing,
    'ics_revoked', v_ics_revoked,
    'creates_queued', v_creates
  );
end $$;

revoke execute on function public.api_complete_calendar_connection(
  uuid, uuid, text, text, text, text, text, text, text, text, text,
  text, text, text, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.api_complete_calendar_connection(
  uuid, uuid, text, text, text, text, text, text, text, text, text,
  text, text, text, timestamptz, text)
  to service_role;


create or replace function public.api_commit_calendar_outbox_created(
  p_outbox_id             uuid,
  p_worker_id             text,
  p_generation            bigint,
  p_provider_event_id     text,
  p_provider_instance_id  text,
  p_provider_series_id    text,
  p_provider_version      text,
  p_start_at              timestamptz,
  p_end_at                timestamptz,
  p_time_zone             text,
  p_title                 text,
  p_description           text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_outbox       public.calendar_outbox%rowtype;
  v_task         public.tasks%rowtype;
  v_connection   public.calendar_connections%rowtype;
  v_sent         jsonb;
  v_requested    jsonb;
  v_current      jsonb;
  v_link_id      uuid;
  v_followup     text;
  v_finalized    boolean;
  v_observed_mismatch boolean;
  v_conflict     boolean;
begin
  select * into v_outbox
    from public.calendar_outbox
   where id = p_outbox_id
   for update;
  if not found
     or v_outbox.action <> 'create'
     or v_outbox.state <> 'leased'
     or v_outbox.lease_owner is distinct from p_worker_id
     or v_outbox.lease_expires_at is null
     or v_outbox.lease_expires_at <= now() then
    return jsonb_build_object('outcome', 'lease_lost');
  end if;
  if nullif(p_provider_event_id, '') is null
     or nullif(p_provider_instance_id, '') is null
     or p_provider_series_id is not distinct from p_provider_instance_id then
    raise exception 'calendar create commit requires an instance id, never a series id';
  end if;

  select * into v_task from public.tasks where id = v_outbox.task_id for update;
  select * into v_connection
    from public.calendar_connections where id = v_outbox.connection_id for update;
  v_sent := public.calendar_snapshot_from_fields(
    p_start_at, p_end_at, p_time_zone, p_title, p_description
  );
  v_requested := public.calendar_normalize_snapshot(
    v_outbox.requested_snapshot
  );
  v_observed_mismatch := v_sent is distinct from v_requested;
  v_current := public.calendar_task_snapshot(
    v_task.due_at, v_task.title, v_task.description,
    v_requested, v_connection.selected_calendar_timezone
  );
  v_conflict := v_observed_mismatch
    and v_connection.status = 'active'
    and v_connection.revoked_at is null
    and v_task.deleted_at is null
    and public.task_done_at(v_task) is null
    and v_task.due_at is not null
    and public.calendar_task_in_sync_window(v_task.due_at)
    and v_task.assigned_user_id = v_connection.user_id
    and public.calendar_task_access_allowed(
      v_connection.user_id, v_task.company_id, v_task.conversation_id
    );

  if v_outbox.link_id is null then
    insert into public.task_calendar_links (
      company_id, connection_id, task_id,
      provider_event_id, provider_instance_id, provider_series_id,
      provider_version, link_state, base_snapshot, last_sent_snapshot,
      last_sent_provider_version, last_sent_at,
      conflict_ours_snapshot, conflict_theirs_snapshot,
      conflict_detected_at, last_provider_seen_at
    ) values (
      v_outbox.company_id, v_outbox.connection_id, v_outbox.task_id,
      p_provider_event_id, p_provider_instance_id, p_provider_series_id,
      p_provider_version, case when v_conflict then 'conflict' else 'active' end,
      case when v_observed_mismatch then v_requested else v_sent end,
      case when v_observed_mismatch then null else v_sent end,
      case when v_observed_mismatch then null else p_provider_version end,
      case when v_observed_mismatch then null else now() end,
      case when v_conflict then v_current else null end,
      case when v_conflict then v_sent else null end,
      case when v_conflict then now() else null end,
      now()
    ) returning id into v_link_id;
  else
    -- "Moved" after a provider removal creates a new occurrence but keeps the
    -- same task/link identity used by the attention card.
    update public.task_calendar_links
       set provider_event_id = p_provider_event_id,
           provider_instance_id = p_provider_instance_id,
           provider_series_id = p_provider_series_id,
           provider_version = p_provider_version,
           link_state = case when v_conflict then 'conflict' else 'active' end,
           base_snapshot = case when v_observed_mismatch
             then v_requested else v_sent end,
           last_sent_snapshot = case when v_observed_mismatch
             then null else v_sent end,
           last_sent_provider_version = case when v_observed_mismatch
             then null else p_provider_version end,
           last_sent_at = case when v_observed_mismatch then null else now() end,
           last_provider_seen_at = now(),
           conflict_ours_snapshot = case when v_conflict then v_current else null end,
           conflict_theirs_snapshot = case when v_conflict then v_sent else null end,
           conflict_detected_at = case when v_conflict then now() else null end,
           event_removed_at = null,
           refusal_code = null, refusal_detail = null, refused_at = null,
           unlinked_at = null
     where id = v_outbox.link_id
       and company_id = v_outbox.company_id
       and connection_id = v_outbox.connection_id
       and task_id = v_outbox.task_id
    returning id into v_link_id;
    if not found then
      raise exception 'calendar recreate link disappeared after provider create';
    end if;
  end if;

  update public.calendar_outbox
     set state = 'completed', completed_at = now(), link_id = v_link_id,
         lease_owner = null, lease_expires_at = null,
         provider_effect_ambiguous = false,
         provider_effect_lease_generation = null
   where id = p_outbox_id;

  if v_conflict then
    perform public.calendar_record_connection_conflict(v_connection.id);
    return jsonb_build_object(
      'outcome', 'conflict',
      'reason', 'create_observed_mismatch',
      'link_id', v_link_id,
      'connection_finalized', false
    );
  end if;

  -- A task may move while the provider request is in flight.  The remote event
  -- now exists, so record it first, then queue the CURRENT truth; never retry
  -- create and duplicate the event.
  v_followup := case
    when v_connection.status = 'disconnected'
    then coalesce(v_connection.disconnect_cleanup_action, 'unlink')
    when not public.calendar_task_access_allowed(
      v_connection.user_id, v_task.company_id, v_task.conversation_id
    ) then 'scrub'
    when v_task.deleted_at is not null
      or public.task_done_at(v_task) is not null
      or v_task.due_at is null
      or not public.calendar_task_in_sync_window(v_task.due_at)
      or v_task.assigned_user_id is distinct from v_connection.user_id
    then 'unlink'
    -- A mismatched observation is never an agreed base.  If cleanup does not
    -- win above, the eligible case returned conflict before this expression.
    when not v_observed_mismatch and v_current is distinct from v_sent then 'upsert'
    else null
  end;
  if v_followup is not null then
    insert into public.calendar_outbox (
      company_id, connection_id, task_id, link_id, action,
      requested_snapshot, provider_precondition
    ) values (
      v_outbox.company_id, v_outbox.connection_id, v_outbox.task_id, v_link_id,
      v_followup,
      case when v_followup = 'upsert' then v_current else null end,
      p_provider_version
    );
  end if;

  v_finalized := public.calendar_finalize_disconnected_connection(
    v_connection.id
  );

  return jsonb_build_object(
    'outcome', case
      when v_outbox.generation is distinct from p_generation or v_followup is not null
      then 'followup_queued' else 'committed' end,
    'link_id', v_link_id,
    'connection_finalized', v_finalized
  );
end $$;

revoke execute on function public.api_commit_calendar_outbox_created(
  uuid, text, bigint, text, text, text, text,
  timestamptz, timestamptz, text, text, text)
  from public, anon, authenticated;
grant execute on function public.api_commit_calendar_outbox_created(
  uuid, text, bigint, text, text, text, text,
  timestamptz, timestamptz, text, text, text)
  to service_role;


create or replace function public.api_commit_calendar_outbox_sent(
  p_outbox_id        uuid,
  p_worker_id        text,
  p_generation       bigint,
  p_provider_version text,
  p_start_at         timestamptz,
  p_end_at           timestamptz,
  p_time_zone        text,
  p_title            text,
  p_description      text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_outbox     public.calendar_outbox%rowtype;
  v_task       public.tasks%rowtype;
  v_connection public.calendar_connections%rowtype;
  v_link       public.task_calendar_links%rowtype;
  v_sent       jsonb;
  v_current    jsonb;
  v_followup   text;
  v_finalized  boolean;
begin
  select * into v_outbox
    from public.calendar_outbox where id = p_outbox_id for update;
  if not found
     or v_outbox.action = 'create'
     or v_outbox.state <> 'leased'
     or v_outbox.lease_owner is distinct from p_worker_id
     or v_outbox.lease_expires_at is null
     or v_outbox.lease_expires_at <= now() then
    return jsonb_build_object('outcome', 'lease_lost');
  end if;

  select * into v_link
    from public.task_calendar_links where id = v_outbox.link_id for update;
  select * into v_task from public.tasks where id = v_outbox.task_id for update;
  select * into v_connection
    from public.calendar_connections where id = v_outbox.connection_id for update;

  if p_start_at is null then
    -- An unlink either deleted the provider event (no version left) or left
    -- it annotated; either way the mapping is unlinked.
    update public.task_calendar_links
       set link_state = 'unlinked', unlinked_at = now(),
           provider_version = p_provider_version,
           last_sent_snapshot = null,
           last_sent_provider_version = null,
           last_sent_at = null
     where id = v_link.id;
  else
    v_sent := public.calendar_snapshot_from_fields(
      p_start_at, p_end_at, p_time_zone, p_title, p_description
    );
    update public.task_calendar_links
       set link_state = 'active',
           base_snapshot = v_sent,
           last_sent_snapshot = v_sent,
           last_sent_provider_version = p_provider_version,
           provider_version = p_provider_version,
           last_sent_at = now(),
           conflict_ours_snapshot = null,
           conflict_theirs_snapshot = null,
           conflict_detected_at = null,
           event_removed_at = null,
           refusal_code = null,
           refusal_detail = null,
           refused_at = null,
           unlinked_at = null
     where id = v_link.id;
  end if;

  update public.calendar_outbox
     set state = 'completed', completed_at = now(),
         lease_owner = null, lease_expires_at = null,
         provider_effect_ambiguous = false,
         provider_effect_lease_generation = null
   where id = p_outbox_id;

  if v_connection.status = 'disconnected'
     and (
       v_connection.disconnect_cleanup_action = 'scrub'
       or not public.calendar_task_access_allowed(
         v_connection.user_id, v_task.company_id, v_task.conversation_id
       )
     )
     and v_outbox.action <> 'scrub' then
    v_followup := 'scrub';
  elsif v_connection.status = 'disconnected' then
    -- A successful phase-one unlink is terminal for ordinary disconnect.  It
    -- must never fall through to the active-task branch and resurrect an
    -- upsert merely because the task itself remains eligible in Loonext.
    if p_start_at is not null then
      v_followup := coalesce(v_connection.disconnect_cleanup_action, 'unlink');
    end if;
  elsif not public.calendar_task_access_allowed(
      v_connection.user_id, v_task.company_id, v_task.conversation_id
    ) and v_outbox.action <> 'scrub' then
    v_followup := 'scrub';
  elsif v_task.deleted_at is null
     and public.task_done_at(v_task) is null
     and v_task.due_at is not null
     and public.calendar_task_in_sync_window(v_task.due_at)
     and v_task.assigned_user_id = v_connection.user_id
     and public.calendar_task_access_allowed(
       v_connection.user_id, v_task.company_id, v_task.conversation_id
     ) then
    v_current := public.calendar_task_snapshot(
      v_task.due_at, v_task.title, v_task.description,
      case when p_start_at is null then v_link.base_snapshot else v_sent end,
      v_connection.selected_calendar_timezone
    );
    if p_start_at is null or v_current is distinct from v_sent then
      -- An unlink with no version left deleted (or found gone) the provider
      -- event: the job is back, so it needs a new event, never a patch of one
      -- that no longer exists.
      v_followup := case
        when p_start_at is null and p_provider_version is null then 'create'
        else 'upsert' end;
    end if;
  elsif p_start_at is not null then
    v_followup := 'unlink';
  end if;

  if v_followup is not null then
    insert into public.calendar_outbox (
      company_id, connection_id, task_id, link_id, action,
      requested_snapshot, provider_precondition
    ) values (
      v_outbox.company_id, v_outbox.connection_id, v_outbox.task_id,
      v_link.id, v_followup,
      case when v_followup in ('upsert', 'create') then v_current else null end,
      case when v_followup = 'create' then null else p_provider_version end
    );
  end if;

  v_finalized := public.calendar_finalize_disconnected_connection(
    v_connection.id
  );

  return jsonb_build_object(
    'outcome', case
      when v_followup is not null then 'followup_queued'
      when v_outbox.generation is distinct from p_generation then 'followup_checked'
      else 'committed' end,
    'connection_finalized', v_finalized
  );
end $$;

revoke execute on function public.api_commit_calendar_outbox_sent(
  uuid, text, bigint, text, timestamptz, timestamptz, text, text, text)
  from public, anon, authenticated;
grant execute on function public.api_commit_calendar_outbox_sent(
  uuid, text, bigint, text, timestamptz, timestamptz, text, text, text)
  to service_role;


create or replace function public.api_commit_calendar_outbox_scrubbed(
  p_outbox_id        uuid,
  p_worker_id        text,
  p_generation       bigint,
  p_provider_version text,
  p_provider_deleted boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_outbox public.calendar_outbox%rowtype;
  v_link public.task_calendar_links%rowtype;
  v_task public.tasks%rowtype;
  v_connection public.calendar_connections%rowtype;
  v_current jsonb;
  v_followup_id uuid;
  v_finalized boolean;
begin
  select * into v_outbox from public.calendar_outbox
   where id = p_outbox_id for update;
  if not found or v_outbox.action <> 'scrub'
     or v_outbox.state <> 'leased'
     or v_outbox.lease_owner is distinct from p_worker_id
     or v_outbox.lease_expires_at is null
     or v_outbox.lease_expires_at <= now() then
    return jsonb_build_object('outcome', 'lease_lost');
  end if;
  select * into v_link from public.task_calendar_links
   where id = v_outbox.link_id for update;
  select * into v_task from public.tasks
   where id = v_outbox.task_id for update;
  select * into v_connection from public.calendar_connections
   where id = v_outbox.connection_id for update;

  update public.task_calendar_links
     set link_state = 'unlinked', unlinked_at = now(),
         provider_version = case when p_provider_deleted then null
                                 else p_provider_version end,
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
   where id = v_link.id;
  update public.calendar_outbox
     set state = 'completed', completed_at = now(),
         lease_owner = null, lease_expires_at = null,
         provider_effect_ambiguous = false,
         provider_effect_lease_generation = null
   where id = v_outbox.id;

  -- Access may be restored while the conditional delete/neutralising PATCH is
  -- in flight.  The scrubbed occurrence is never re-adopted; create a fresh
  -- occurrence from current truth so a deleted resource cannot be PATCHed.
  if v_connection.status = 'active'
     and v_connection.revoked_at is null
     and v_task.deleted_at is null
     and public.task_done_at(v_task) is null
     and v_task.due_at is not null
     and public.calendar_task_in_sync_window(v_task.due_at)
     and v_task.assigned_user_id = v_connection.user_id
     and public.calendar_task_access_allowed(
       v_connection.user_id, v_task.company_id, v_task.conversation_id
     ) then
    v_current := public.calendar_task_snapshot(
      v_task.due_at, v_task.title, v_task.description, null,
      v_connection.selected_calendar_timezone
    );
    insert into public.calendar_outbox (
      company_id, connection_id, task_id, link_id, action,
      requested_snapshot, provider_precondition
    ) values (
      v_outbox.company_id, v_outbox.connection_id, v_outbox.task_id,
      v_link.id, 'create', v_current, null
    ) returning id into v_followup_id;
  end if;

  v_finalized := public.calendar_finalize_disconnected_connection(
    v_connection.id
  );
  return jsonb_build_object(
    'outcome', case when v_followup_id is null then 'committed'
                    else 'followup_queued' end,
    'provider_deleted', p_provider_deleted,
    'followup_outbox_id', v_followup_id,
    'connection_finalized', v_finalized
  );
end $$;

revoke execute on function public.api_commit_calendar_outbox_scrubbed(
  uuid, text, bigint, text, boolean)
  from public, anon, authenticated;
grant execute on function public.api_commit_calendar_outbox_scrubbed(
  uuid, text, bigint, text, boolean)
  to service_role;
