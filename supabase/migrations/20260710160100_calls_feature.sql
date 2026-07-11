-- #129 Calls feature (docs/CALLS-FEATURE.md): every inbound call becomes a
-- visible, actionable item. Session-grain read model + the RPCs the voice
-- webhook and GET /v1/calls use:
--
--   * public.calls — ONE row per call session, merged across webhook events
--     (AMD verdict, per-leg hangups) by api_upsert_call. call_records stays
--     the per-LEG billing substrate (D36) — its ignoreDuplicates upsert can
--     never host merge semantics (the AMD event arrives before the hangup and
--     carries no duration).
--   * api_upsert_call — the merge writer. Outcome rules: 'voicemail' (an AMD
--     machine verdict) always wins; otherwise the first verdict sticks
--     (webhooks arrive out of order); forward_seconds/ended_at take the max,
--     started_at the min.
--   * api_thread_call — find(-or-create, for missed calls) the caller's
--     conversation, insert ONE idempotent 'call_completed' event per call
--     session, bump last_message_at. Missed calls create conversations (a
--     miss is actionable and must reach the inbox even with text-back off);
--     answered/voicemail calls only join an OPEN conversation (never reopen
--     or create — an answered call is not a work item).
--   * api_list_calls — the #106-filtered list read for GET /v1/calls: the
--     deny-list runs INSIDE the SQL before the keyset window, and rows with a
--     NULL phone_number_id (released numbers) stay visible, matching the
--     conversations semantics.

create table public.calls (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id) on delete restrict,
  phone_number_id  uuid references public.phone_numbers(id) on delete set null,
  call_session_id  text not null unique,          -- the merge key (both legs + AMD carry it)
  caller_e164      text,                          -- null = anonymous/CLIR caller
  contact_id       uuid references public.contacts(id) on delete set null,
  conversation_id  uuid references public.conversations(id) on delete set null,
  -- null = still in flight (or a leg that carried no verdict).
  outcome          text check (outcome in ('answered', 'voicemail', 'missed')),
  -- Talk time: the forward leg's billable seconds (0 for misses). NEVER ring time.
  forward_seconds  int not null default 0 check (forward_seconds >= 0),
  started_at       timestamptz not null default now(),
  ended_at         timestamptz,
  created_at       timestamptz not null default now()
);

create index calls_company_recency_idx
  on public.calls (company_id, started_at desc, id desc);
create index calls_conversation_idx
  on public.calls (conversation_id) where conversation_id is not null;

-- Service-role only, like call_records: the rls.sql default-privilege revoke
-- strips anon/authenticated; RLS with no end-user policy makes it explicit.
alter table public.calls enable row level security;

-- The merge writer (SECURITY DEFINER, service-role): one row per session,
-- convergent under replays and out-of-order webhook delivery. Returns the
-- merged row so the caller can thread with the FINAL outcome + duration.
create or replace function public.api_upsert_call(
  p_company_id      uuid,
  p_phone_number_id uuid,
  p_call_session_id text,
  p_caller_e164     text,
  p_outcome         text,
  p_forward_seconds int,
  p_started_at      timestamptz,
  p_ended_at        timestamptz
) returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.calls as c
    (company_id, phone_number_id, call_session_id, caller_e164, outcome,
     forward_seconds, started_at, ended_at)
  values
    (p_company_id, p_phone_number_id, p_call_session_id, p_caller_e164,
     nullif(p_outcome, ''), coalesce(p_forward_seconds, 0),
     coalesce(p_started_at, now()), p_ended_at)
  on conflict (call_session_id) do update set
    -- 'voicemail' is a strictly better verdict than the hangup-cause
    -- fallback 'answered' and may arrive after it — it always wins.
    outcome = case
      when excluded.outcome = 'voicemail' then 'voicemail'
      when c.outcome is null then excluded.outcome
      else c.outcome
    end,
    forward_seconds = greatest(c.forward_seconds, excluded.forward_seconds),
    caller_e164     = coalesce(c.caller_e164, excluded.caller_e164),
    phone_number_id = coalesce(c.phone_number_id, excluded.phone_number_id),
    started_at      = least(c.started_at, excluded.started_at),
    ended_at        = greatest(coalesce(c.ended_at, excluded.ended_at),
                               coalesce(excluded.ended_at, c.ended_at))
  returning to_jsonb(c.*)
$$;
revoke execute on function public.api_upsert_call(uuid, uuid, text, text, text, int, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.api_upsert_call(uuid, uuid, text, text, text, int, timestamptz, timestamptz)
  to service_role;

-- Thread a finished call into the caller's conversation and audit it. The
-- contact/conversation block is the claim_missed_call_text recipe (D7 rules
-- 2/4/5) — an inbound call is inbound contact, so consent stamps the same
-- way. Idempotent per call session via the payload key scan (the missed_call
-- precedent). Returns {} when unthreadable (anonymous caller, or a
-- non-missed call with no open conversation).
create or replace function public.api_thread_call(
  p_company_id       uuid,
  p_phone_number_id  uuid,
  p_caller_e164      text,
  p_call_session_id  text,
  p_outcome          text,
  p_forward_seconds  int,
  p_create_if_missing boolean
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_now        timestamptz := now();
  v_contact_id uuid;
  v_conv       public.conversations%rowtype;
begin
  if p_caller_e164 is null or length(p_caller_e164) = 0 then
    return '{}'::jsonb;
  end if;

  if p_create_if_missing then
    insert into public.contacts as ct (company_id, phone_e164, consent_source, consent_at)
    values (p_company_id, p_caller_e164, 'inbound_sms', v_now)
    on conflict (company_id, phone_e164) do update
      set deleted_at     = null,
          consent_source = coalesce(ct.consent_source, excluded.consent_source),
          consent_at     = coalesce(ct.consent_at, excluded.consent_at)
    returning ct.id into v_contact_id;
  else
    select ct.id into v_contact_id
      from public.contacts ct
     where ct.company_id = p_company_id
       and ct.phone_e164 = p_caller_e164
       and ct.deleted_at is null;
    if not found then
      return '{}'::jsonb;
    end if;
  end if;

  -- Rule 2: the open conversation for the triple.
  select conv.* into v_conv
    from public.conversations conv
   where conv.company_id = p_company_id
     and conv.phone_number_id = p_phone_number_id
     and conv.contact_id = v_contact_id
     and conv.closed_at is null
   for update;

  if not found then
    if not p_create_if_missing then
      -- Answered/voicemail: never reopen or create — not a work item.
      return '{}'::jsonb;
    end if;

    -- Rule 4: reopen the most recent closed (non-spam) conversation ≤30d,
    -- else Rule 5: create fresh (claim_missed_call_text recipe verbatim).
    select conv.* into v_conv
      from public.conversations conv
     where conv.company_id = p_company_id
       and conv.phone_number_id = p_phone_number_id
       and conv.contact_id = v_contact_id
       and conv.closed_at is not null
       and not conv.is_spam
     order by conv.closed_at desc
     limit 1
     for update;

    if found and v_conv.closed_at >= v_now - interval '30 days' then
      update public.conversations
         set status = 'new', closed_at = null
       where id = v_conv.id
      returning * into v_conv;
    else
      insert into public.conversations (company_id, contact_id, phone_number_id, status)
      values (p_company_id, v_contact_id, p_phone_number_id, 'new')
      on conflict (company_id, phone_number_id, contact_id) where closed_at is null
      do nothing
      returning * into v_conv;

      if v_conv.id is null then
        select conv.* into v_conv
          from public.conversations conv
         where conv.company_id = p_company_id
           and conv.phone_number_id = p_phone_number_id
           and conv.contact_id = v_contact_id
           and conv.closed_at is null
         for update;
        if not found then
          raise exception 'api_thread_call: lost conversation race for company %', p_company_id;
        end if;
      end if;
    end if;
  end if;

  -- ONE call_completed event per call session (webhook replays no-op).
  if not exists (
    select 1 from public.conversation_events e
     where e.company_id = p_company_id
       and e.conversation_id = v_conv.id
       and e.type = 'call_completed'
       and e.payload->>'call_session_id' = p_call_session_id
  ) then
    insert into public.conversation_events
      (company_id, conversation_id, actor_user_id, type, payload)
    values
      (p_company_id, v_conv.id, null, 'call_completed',
       jsonb_build_object(
         'call_session_id', p_call_session_id,
         'outcome', p_outcome,
         'forward_seconds', coalesce(p_forward_seconds, 0),
         'caller', p_caller_e164));
    -- A call is real activity: surface the conversation (fires the
    -- conversation.updated broadcast, which refreshes open timelines).
    update public.conversations
       set last_message_at = greatest(coalesce(last_message_at, v_now), v_now)
     where id = v_conv.id;
  end if;

  return jsonb_build_object('contact_id', v_contact_id, 'conversation_id', v_conv.id);
end;
$$;
revoke execute on function public.api_thread_call(uuid, uuid, text, text, text, int, boolean)
  from public, anon, authenticated;
grant execute on function public.api_thread_call(uuid, uuid, text, text, text, int, boolean)
  to service_role;

-- The #106-filtered calls list for GET /v1/calls. Deny-list semantics match
-- api_list_conversations exactly: null p_hidden_number_ids = unrestricted
-- (owner/admin short-circuit); a NULL phone_number_id row stays VISIBLE
-- (released numbers); the filter runs before the keyset window so cursors
-- never strand restricted members.
create or replace function public.api_list_calls(
  p_company_id         uuid,
  p_limit              int,
  p_outcome            text default null,
  p_cursor_ts          timestamptz default null,
  p_cursor_id          uuid default null,
  p_hidden_number_ids  uuid[] default null
) returns setof jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', c.id,
    'caller_e164', c.caller_e164,
    'contact_id', c.contact_id,
    'contact_name', ct.name,
    'phone_number_id', c.phone_number_id,
    'conversation_id', c.conversation_id,
    'outcome', c.outcome,
    'forward_seconds', c.forward_seconds,
    'started_at', c.started_at
  )
  from public.calls c
  left join public.contacts ct on ct.id = c.contact_id
  where c.company_id = p_company_id
    and (p_outcome is null or c.outcome = p_outcome)
    and (p_hidden_number_ids is null
         or c.phone_number_id is null
         or not (c.phone_number_id = any (p_hidden_number_ids)))
    and (p_cursor_ts is null
         or (c.started_at, c.id) < (p_cursor_ts, p_cursor_id))
  order by c.started_at desc, c.id desc
  limit greatest(p_limit, 0)
$$;
revoke execute on function public.api_list_calls(uuid, int, text, timestamptz, uuid, uuid[])
  from public, anon, authenticated;
grant execute on function public.api_list_calls(uuid, int, text, timestamptz, uuid, uuid[])
  to service_role;
