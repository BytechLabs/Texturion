-- D38 (#130): outbound calling — click-to-call bridging. The app dials the
-- member's cell FROM the business number (agent leg), then connects them to
-- the customer (customer leg), so the customer sees one number and personal
-- cells stay private. Reverses the D37 "no outbound calling" non-goal on
-- founder direction. Substrate:
--
--   1. calls.direction — the session's direction ('inbound' backfills every
--      existing row). Outcome semantics for outbound: 'answered' = customer
--      connected; 'missed' = never connected (customer didn't pick up, or
--      the agent leg itself failed).
--   2. call_records.leg gains 'out_agent' / 'out_customer'. The BILLED
--      measure stays "the far-party leg": 'forward' (inbound calls) and
--      'out_customer' (outbound calls) — both feed the voice meter and the
--      fair-use allowance; agent/inbound legs are cost-analysis only.
--   3. api_period_forward_seconds / api_period_forwarded_calls re-created to
--      count the out_customer legs (same D36 pool: ONE calling-minutes
--      allowance both directions; the per-dial fee projection counts
--      out_agent too — outbound runs two dial commands, and over-counting
--      cost is the safe direction).
--   4. company_members.call_cell_e164 — the member's own cell the agent leg
--      rings (self-service, NANP like companies.forward_to_cell).
--   5. api_upsert_call / api_thread_call gain p_direction (old signatures
--      DROPPED first — PostgREST errors on two candidates).

alter table public.calls
  add column direction text not null default 'inbound'
    check (direction in ('inbound', 'outbound'));

alter table public.call_records
  drop constraint call_records_leg_check;
alter table public.call_records
  add constraint call_records_leg_check
    check (leg in ('inbound', 'forward', 'out_agent', 'out_customer'));

alter table public.company_members
  add column call_cell_e164 text
    constraint company_members_call_cell_e164
      check (call_cell_e164 is null or call_cell_e164 ~ '^\+1[2-9]\d{2}[2-9]\d{6}$');

-- The billed measure: far-party seconds, both directions (D36 pool).
create or replace function public.api_period_forward_seconds(
  p_company_id uuid,
  p_since      timestamptz
) returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(cr.billable_seconds), 0)::bigint
  from public.call_records cr
  where cr.company_id = p_company_id
    and cr.leg in ('forward', 'out_customer')
    and cr.created_at >= p_since
$$;

-- Per-dial fee counter (#98): every dial command costs ~10¢ — inbound
-- transfers ('forward') and BOTH outbound dials ('out_agent' initiates,
-- 'out_customer' transfers). Over-counting cost is the safe direction.
create or replace function public.api_period_forwarded_calls(
  p_company_id uuid,
  p_since      timestamptz
) returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::bigint
  from public.call_records cr
  where cr.company_id = p_company_id
    and cr.leg in ('forward', 'out_agent', 'out_customer')
    and cr.created_at >= p_since
$$;

-- Signature change → drop the old overloads FIRST (PostgREST candidate rule).
drop function if exists public.api_upsert_call(uuid, uuid, text, text, text, int, timestamptz, timestamptz);
create function public.api_upsert_call(
  p_company_id      uuid,
  p_phone_number_id uuid,
  p_call_session_id text,
  p_caller_e164     text,
  p_outcome         text,
  p_forward_seconds int,
  p_started_at      timestamptz,
  p_ended_at        timestamptz,
  p_direction       text default 'inbound'
) returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.calls as c
    (company_id, phone_number_id, call_session_id, caller_e164, outcome,
     forward_seconds, started_at, ended_at, direction)
  values
    (p_company_id, p_phone_number_id, p_call_session_id, p_caller_e164,
     nullif(p_outcome, ''), coalesce(p_forward_seconds, 0),
     coalesce(p_started_at, now()), p_ended_at,
     coalesce(nullif(p_direction, ''), 'inbound'))
  on conflict (call_session_id) do update set
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
    -- direction never changes after insert.
  returning to_jsonb(c.*)
$$;
revoke execute on function public.api_upsert_call(uuid, uuid, text, text, text, int, timestamptz, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.api_upsert_call(uuid, uuid, text, text, text, int, timestamptz, timestamptz, text)
  to service_role;

drop function if exists public.api_thread_call(uuid, uuid, text, text, text, int, boolean);
create function public.api_thread_call(
  p_company_id       uuid,
  p_phone_number_id  uuid,
  p_caller_e164      text,
  p_call_session_id  text,
  p_outcome          text,
  p_forward_seconds  int,
  p_create_if_missing boolean,
  p_direction        text default 'inbound'
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

  select conv.* into v_conv
    from public.conversations conv
   where conv.company_id = p_company_id
     and conv.phone_number_id = p_phone_number_id
     and conv.contact_id = v_contact_id
     and conv.closed_at is null
   for update;

  if not found then
    if not p_create_if_missing then
      return '{}'::jsonb;
    end if;

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
         'caller', p_caller_e164,
         'direction', coalesce(nullif(p_direction, ''), 'inbound')));
    update public.conversations
       set last_message_at = greatest(coalesce(last_message_at, v_now), v_now)
     where id = v_conv.id;
  end if;

  return jsonb_build_object('contact_id', v_contact_id, 'conversation_id', v_conv.id);
end;
$$;
revoke execute on function public.api_thread_call(uuid, uuid, text, text, text, int, boolean, text)
  from public, anon, authenticated;
grant execute on function public.api_thread_call(uuid, uuid, text, text, text, int, boolean, text)
  to service_role;

-- The list row gains direction (same signature → replace in place).
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
    'direction', c.direction,
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
