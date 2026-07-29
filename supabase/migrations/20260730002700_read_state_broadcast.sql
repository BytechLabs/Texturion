-- #358 - read state does not cross a person's own devices.
--
-- Seven events are broadcast from the database and all seven have handlers on
-- all three clients. READ STATE is not among them, so clearing the bell on a
-- phone leaves the dot on the laptop until something unrelated triggers a
-- refetch.
--
-- That matters more here than in most products because these users are
-- multi-device by design: the tech works from a personal cell, the owner works
-- from a desktop all day, and the same person routinely uses both within
-- minutes. Read the message in the truck, come back to the desk, and the badge
-- is still there.
--
-- ---------------------------------------------------------------------------
-- WHY THIS IS SAFE, GIVEN THE HISTORY.
--
-- Every previous change to read state produced a subtle bug, and the risk
-- named in #358 is resurrecting the #201 race where a refetch reconciled away
-- locally-cleared dots. It cannot happen here, and the reason is structural:
--
--   * `unread` is DERIVED server-side from a watermark, not stored per row.
--     A refetch returns whatever the watermark says.
--   * These are AFTER triggers, so the broadcast is emitted only once the
--     watermark write has COMMITTED.
--
-- So a refetch caused by this event is guaranteed to observe the new
-- watermark. It is strictly safer than the five-minute poll that already
-- exists, which can fire at any moment including mid-write.
--
-- ---------------------------------------------------------------------------
-- SCOPED TO THE PERSON, ON THE COMPANY TOPIC.
--
-- The payload carries `user_id` and every client ignores an event that is not
-- its own. The alternative - a per-user topic - is the open question in #349,
-- and inventing one here would mean a second subscription on three clients for
-- an event that is already cheap to filter. What must NOT happen is a client
-- refetching its counts because a COLLEAGUE read something, which is both
-- wasteful and slightly creepy; the filter is what prevents it, and it is
-- asserted on all three.

create or replace function public.broadcast_conversation_read() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid;
begin
  -- conversation_reads has no company_id of its own; the topic needs one.
  select c.company_id into v_company
    from public.conversations c
   where c.id = new.conversation_id;
  if v_company is null then return null; end if;

  perform realtime.send(
    jsonb_build_object('conversation_id', new.conversation_id,
                       'user_id', new.user_id),
    'read.conversation', 'company:' || v_company::text, true);
  return null;
end $$;

create trigger conversation_reads_broadcast
  after insert or update on public.conversation_reads
  for each row execute function public.broadcast_conversation_read();

create or replace function public.broadcast_notifications_read() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform realtime.send(
    jsonb_build_object('user_id', new.user_id),
    'read.notifications', 'company:' || new.company_id::text, true);
  return null;
end $$;

create trigger notification_reads_broadcast
  after insert or update on public.notification_reads
  for each row execute function public.broadcast_notifications_read();
