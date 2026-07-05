-- #3 Pinning — message-level pin state, mirroring the D14 done model's storage
-- and broadcast (20260702010000_message_done_state.sql) but WITHOUT an audit
-- event: a pin is an organizational convenience (surface an important message
-- at the top of the thread — the address, the quote, the key fact), NOT an
-- audited state transition like done. So it needs no conversation_events row
-- and no new conversation_event_type enum values.
--
--   messages.pinned_at          when it was pinned (NULL = not pinned)
--   messages.pinned_by_user_id  who pinned it (FK profiles, ON DELETE RESTRICT)
--
-- Shared / team-wide: any member can pin or unpin any message and everyone in
-- the company sees it, exactly like done (this is a shared business inbox).

alter table public.messages
  add column pinned_at timestamptz,
  add column pinned_by_user_id uuid references public.profiles(user_id) on delete restrict;

-- Pinning never happens without an actor; unpinning clears both (mirrors the
-- messages_done_consistency check).
alter table public.messages
  add constraint messages_pinned_consistency
  check ((pinned_at is null) = (pinned_by_user_id is null));

-- Extend the change broadcast so a pin toggle reaches open clients, the same
-- way 20260702010000 extended it for done. The UPDATE branch now also fires
-- when the pin fields change, and the payload always carries them so every open
-- client patches its cache purely — no refetch (SPEC §8). Re-created whole
-- (never edit a shipped migration); keeps the done fields verbatim.
create or replace function public.broadcast_message_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform realtime.send(
      jsonb_build_object('conversation_id', new.conversation_id,
                         'message_id', new.id, 'direction', new.direction),
      'message.created', 'company:' || new.company_id::text, true);
  elsif tg_op = 'UPDATE'
        and (new.status is distinct from old.status
             or new.done_at is distinct from old.done_at
             or new.done_by_user_id is distinct from old.done_by_user_id
             or new.pinned_at is distinct from old.pinned_at
             or new.pinned_by_user_id is distinct from old.pinned_by_user_id) then
    -- One event for delivery-state, done-state, AND pin-state changes; the
    -- payload always carries the current done + pin fields so any of the three
    -- kinds of change keeps every open client's cache exact.
    perform realtime.send(
      jsonb_build_object('message_id', new.id, 'status', new.status,
                         'done_at', new.done_at,
                         'done_by_user_id', new.done_by_user_id,
                         'pinned_at', new.pinned_at,
                         'pinned_by_user_id', new.pinned_by_user_id),
      'message.status', 'company:' || new.company_id::text, true);
  end if;
  return null;
end $$;

-- Atomic, company-scoped, idempotent pin toggle — mirrors set_message_done
-- (20260702100000 + the 20260703000000 cast fix) MINUS the audit insert. The
-- row is locked so a concurrent toggle can't interleave; an already-in-state
-- request is a no-op (no write, no broadcast). Service-role only.
create or replace function public.set_message_pinned(
  p_company_id    uuid,
  p_message_id    uuid,
  p_pinned        boolean,
  p_actor_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_msg  public.messages%rowtype;
  v_now  timestamptz := now();
begin
  select * into v_msg
    from public.messages m
   where m.company_id = p_company_id
     and m.id = p_message_id
   for update;
  if not found then
    return jsonb_build_object('outcome', 'not_found', 'message', null);
  end if;

  -- Idempotent no-op: already in the requested state → no write, no broadcast.
  if p_pinned = (v_msg.pinned_at is not null) then
    return jsonb_build_object('outcome', 'unchanged',
                              'message', to_jsonb(v_msg));
  end if;

  if p_pinned then
    update public.messages
       set pinned_at = v_now, pinned_by_user_id = p_actor_user_id
     where id = v_msg.id
    returning * into v_msg;
  else
    update public.messages
       set pinned_at = null, pinned_by_user_id = null
     where id = v_msg.id
    returning * into v_msg;
  end if;

  return jsonb_build_object('outcome', 'updated', 'message', to_jsonb(v_msg));
end $$;
revoke execute on function public.set_message_pinned(uuid, uuid, boolean, uuid)
  from public, anon, authenticated;
grant execute on function public.set_message_pinned(uuid, uuid, boolean, uuid)
  to service_role;
