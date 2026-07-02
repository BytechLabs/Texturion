-- D14 — message-level done state (DECISIONS.md, user decision 2026-07-01).
--
-- Any message in a thread can be marked Done / Not done by any member; the
-- message itself is the task (no job entity, no separate screen).
--
--   messages.done_at          when it was marked done (NULL = not done)
--   messages.done_by_user_id  who marked it (FK profiles, ON DELETE RESTRICT)
--
-- The existing broadcast_message_change trigger (20260701000400) fires the
-- `message.status` event only when `status` changes, so a done toggle would
-- never reach open clients. Replaced here (never edit old migrations) so the
-- UPDATE branch also fires when the done fields change, and the payload
-- carries them — clients patch their caches purely, no refetch (SPEC §8).

alter table public.messages
  add column done_at timestamptz,
  add column done_by_user_id uuid references public.profiles(user_id) on delete restrict;

-- Marking done never happens without an actor; clearing done clears both.
alter table public.messages
  add constraint messages_done_consistency
  check ((done_at is null) = (done_by_user_id is null));

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
             or new.done_by_user_id is distinct from old.done_by_user_id) then
    -- One event for both delivery-state and done-state changes (D14: the
    -- done toggle emits the realtime message.status broadcast). The payload
    -- always carries the current done fields so either kind of change keeps
    -- every open client's cache exact.
    perform realtime.send(
      jsonb_build_object('message_id', new.id, 'status', new.status,
                         'done_at', new.done_at,
                         'done_by_user_id', new.done_by_user_id),
      'message.status', 'company:' || new.company_id::text, true);
  end if;
  return null;
end $$;
