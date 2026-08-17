-- #228 — why a scheduled message did not send, in the reader's language.
--
-- `held_reason` carries an English sentence composed by the API from
-- `SCHEDULED_HOLD_REASONS`, and all three clients render it verbatim. A
-- workspace working in French is told, in English, that its message did not go
-- out — and this is one of the few places the product volunteers bad news, so
-- it is exactly the wrong sentence to leave untranslated.
--
-- EXPAND AND CONTRACT, the same shape #339 used for payout readiness. The row
-- gains a KEY beside the sentence; the sentence stays. Clients that know the
-- key translate it, clients that do not keep rendering what they always did,
-- and rows written before today still say something rather than nothing.
--
-- The sentence comes off the wire in a later, separate change, once no build
-- reads it. That is a decision about installed builds and does not belong in a
-- migration.

alter table public.scheduled_messages
  add column if not exists held_reason_key text;

comment on column public.scheduled_messages.held_reason_key is
  'The catalogue key for held_reason (#228). Null on rows written before '
  '2026-08-17, and on any reason the API has no key for — clients fall back to '
  'the English held_reason, which is why that column is not going away yet.';

-- The two writers. Both gain the key as a REQUIRED third argument rather than a
-- defaulted one: a defaulted parameter creates a second overload, and PostgREST
-- then has two candidates for the same call and refuses both.
--
-- Dropping first for the same reason — `create or replace` cannot change a
-- signature, so without the drop these would become overloads of themselves.
drop function if exists public.api_hold_scheduled_message(uuid, text);
drop function if exists public.api_fail_scheduled_message(uuid, text);

create or replace function public.api_hold_scheduled_message(
  p_id         uuid,
  p_reason     text,
  p_reason_key text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.scheduled_messages;
begin
  update public.scheduled_messages s
     set status = 'held',
         held_reason = p_reason,
         held_reason_key = p_reason_key,
         held_at = coalesce(s.held_at, now()),
         claimed_at = null,
         updated_at = now()
   where s.id = p_id
     and s.status in ('pending', 'held')
  returning * into v_row;

  if not found then
    return jsonb_build_object('outcome', 'gone');
  end if;

  return jsonb_build_object('outcome', 'held',
                            'scheduled_message', to_jsonb(v_row));
end;
$$;

create or replace function public.api_fail_scheduled_message(
  p_id         uuid,
  p_reason     text,
  p_reason_key text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.scheduled_messages;
begin
  update public.scheduled_messages s
     set status = 'failed',
         held_reason = p_reason,
         held_reason_key = p_reason_key,
         claimed_at = null,
         updated_at = now()
   where s.id = p_id
     and s.status in ('pending', 'held')
  returning * into v_row;

  if not found then
    return jsonb_build_object('outcome', 'gone');
  end if;

  return jsonb_build_object('outcome', 'failed',
                            'scheduled_message', to_jsonb(v_row));
end;
$$;

-- REVOKE BEFORE GRANT. A recreated function is handed the default PUBLIC
-- execute grant, which `anon` and `authenticated` inherit — so recreating a
-- security-definer function without this widens it, silently, every time.
revoke execute on function public.api_hold_scheduled_message(uuid, text, text)
  from public, anon, authenticated;
revoke execute on function public.api_fail_scheduled_message(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.api_hold_scheduled_message(uuid, text, text) to service_role;
grant execute on function public.api_fail_scheduled_message(uuid, text, text) to service_role;
