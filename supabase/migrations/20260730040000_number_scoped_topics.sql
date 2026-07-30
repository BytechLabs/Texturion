-- #480 step 4 — the number-scoped events start publishing to a per-number topic.
--
-- ===========================================================================
-- THIS IS THE EXPAND HALF, AND IT CLOSES NO LEAK YET. ON PURPOSE.
-- ===========================================================================
--
-- D88 made `company:{id}:number:{n}` authorizable: the topic policy admits it
-- only when `member_number_level` is not 'none'. Nothing published to it. This
-- migration starts publishing — to BOTH topics.
--
-- Removing the company-topic send is what actually closes D85's leak, and it
-- cannot happen here. The three clients subscribe to `company:{id}` today, and
-- two of them are STORE-DISTRIBUTED: an iOS or Android user who has not updated
-- would simply stop receiving realtime. So the sequence has to be
--
--   expand (this migration)  →  clients adopt  →  contract (one edit, below)
--
-- and the contract step is one line in `broadcast_number_scoped`, not eight
-- edits across six trigger functions. That is the whole reason this helper
-- exists: the transition lives in ONE place, so ending it is a decision rather
-- than an archaeology exercise.
--
-- Meanwhile nothing regresses. A client joined only to `company:{id}` receives
-- exactly what it received before, and the extra per-number send goes to a topic
-- with no subscribers.
--
-- ===========================================================================
-- WHICH EVENTS, AND WHY TWO ARE LEFT ALONE
-- ===========================================================================
--
-- Eight of the ten broadcast events belong to a number:
--
--   conversation.updated   new.phone_number_id           (NOT NULL)
--   number.updated         new.id — the row IS the number
--   port.updated           new.phone_number_id           (NOT NULL; note the row
--                          also carries a NULLABLE bridge_number_id — the D16
--                          tide-me-over number — which is NOT the subject here)
--   call.updated           new.phone_number_id           (NULLABLE — see below)
--   message.created        join conversations on new.conversation_id
--   message.status         same join, same function
--   task.changed           join conversations on the coalesced conversation_id
--   read.conversation      the function ALREADY joins conversations for the
--                          company id, so the number costs nothing
--
-- Two are genuinely company-wide and stay on the company topic:
--
--   registration.updated   `messaging_registrations` is unique (company_id, kind)
--                          — one 10DLC brand and one campaign per company, and it
--                          authorizes EVERY number the company has. There is no
--                          single number to scope it to.
--   read.notifications     `notification_reads` is primary key (user_id,
--                          company_id) — one unread watermark per person across
--                          every number. Scoping it to a number would be
--                          scoping the wrong object.
--
-- `broadcast_provisioning_change` emits one of each, so it branches: the
-- phone_numbers arm goes through the helper, the registrations arm does not.
--
-- ===========================================================================
-- THE NULLABLE NUMBER, WHICH THE ISSUE ASKED TO HAVE DECIDED
-- ===========================================================================
--
-- `calls.phone_number_id` is `on delete set null`, so a call whose number was
-- deleted still fires `call.updated` with no number. #480 called this a real
-- design question and warned that falling back to the company topic "quietly
-- reopens the leak for exactly the rows most likely to be interesting".
--
-- Two foreign keys settle it, and they settle it cleanly rather than as a
-- compromise:
--
--   number_access.phone_number_id   on delete CASCADE
--   calls.phone_number_id           on delete SET NULL
--
-- A call with a null number is a call whose number is gone — which means the
-- access rule that would have hidden it is gone too. There is no restriction
-- left to honour: a leak requires a restriction, and this one cascaded away with
-- the number. Dropping the event instead would lose a state update to protect
-- nothing, and it would be the kind of silent loss that surfaces as a stuck
-- call card weeks later.
--
-- So a null number falls back to the company topic, deliberately, and
-- `supabase/tests/number_scoped_topics.test.sql` NT-4 pins it.

create or replace function public.broadcast_number_scoped(
  p_payload jsonb,
  p_event text,
  p_company uuid,
  p_number uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if p_company is null then
    -- No company means no topic to send on. Silently doing nothing is right
    -- here: every caller is a trigger, and raising would abort the write that
    -- the event is merely describing.
    return;
  end if;

  -- THE TRANSITION LIVES HERE. Deleting this one statement is the contract step
  -- that closes D85's leak, once the store-distributed clients have adopted the
  -- per-number topic. Until then, removing it would stop realtime for anyone who
  -- has not updated.
  perform realtime.send(p_payload, p_event, 'company:' || p_company::text, true);

  -- The real boundary. Authorized by `is_company_topic_member`, which admits
  -- this shape only when `member_number_level` is not 'none' (D88).
  --
  -- A NULL number falls back to the company topic alone — see the header: the
  -- number is deleted, so its access rules cascaded away and there is no
  -- restriction left to enforce.
  if p_number is not null then
    perform realtime.send(
      p_payload,
      p_event,
      'company:' || p_company::text || ':number:' || p_number::text,
      true);
  end if;
end;
$function$;

comment on function public.broadcast_number_scoped(jsonb, text, uuid, uuid) is
  '#480: publish a number-scoped event to the company topic AND the per-number '
  'topic. The company send is the transition and is meant to be deleted once '
  'the store-distributed clients have adopted the per-number topic; keeping it '
  'in one place makes that one edit instead of eight.';

revoke all on function public.broadcast_number_scoped(jsonb, text, uuid, uuid)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- messages: message.created + message.status
-- ---------------------------------------------------------------------------
-- `public.messages` carries no phone_number_id, so both arms join conversations.
-- The join is total and single-row: messages.conversation_id is NOT NULL and
-- conversations.phone_number_id is NOT NULL, both `on delete restrict`.
--
-- This is the hottest insert path in the product, which is why the lookup is one
-- primary-key read done ONCE for both arms rather than per branch.

create or replace function public.broadcast_message_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_number uuid;
begin
  select c.phone_number_id into v_number
  from public.conversations c
  where c.id = new.conversation_id;

  if tg_op = 'INSERT' then
    perform public.broadcast_number_scoped(
      jsonb_build_object('conversation_id', new.conversation_id,
                         'message_id', new.id, 'direction', new.direction),
      'message.created', new.company_id, v_number);
  elsif tg_op = 'UPDATE'
        and (new.status is distinct from old.status
             or new.done_at is distinct from old.done_at
             or new.done_by_user_id is distinct from old.done_by_user_id
             or new.pinned_at is distinct from old.pinned_at
             or new.pinned_by_user_id is distinct from old.pinned_by_user_id) then
    -- One event for delivery-state, done-state, AND pin-state changes; the
    -- payload always carries the current done + pin fields so any of the three
    -- kinds of change keeps every open client's cache exact.
    perform public.broadcast_number_scoped(
      jsonb_build_object('message_id', new.id, 'status', new.status,
                         'done_at', new.done_at,
                         'done_by_user_id', new.done_by_user_id,
                         'pinned_at', new.pinned_at,
                         'pinned_by_user_id', new.pinned_by_user_id),
      'message.status', new.company_id, v_number);
  end if;
  return null;
end $$;

-- ---------------------------------------------------------------------------
-- conversations: conversation.updated — the number is on NEW.
-- ---------------------------------------------------------------------------

create or replace function public.broadcast_conversation_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.broadcast_number_scoped(
    jsonb_build_object('conversation_id', new.id),
    'conversation.updated', new.company_id, new.phone_number_id);
  return null;
end $$;

-- ---------------------------------------------------------------------------
-- phone_numbers + messaging_registrations: one function, two audiences.
-- ---------------------------------------------------------------------------

create or replace function public.broadcast_provisioning_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'phone_numbers' then
    -- NEW *is* the number, so no lookup.
    perform public.broadcast_number_scoped(
      jsonb_build_object('number_id', new.id, 'status', new.status),
      'number.updated', new.company_id, new.id);
  else
    -- Company-wide by construction: unique (company_id, kind), and the
    -- registration authorizes every number the company has. Deliberately NOT
    -- routed through the helper.
    perform realtime.send(
      jsonb_build_object('kind', new.kind, 'status', new.status),
      'registration.updated', 'company:' || new.company_id::text, true);
  end if;
  return null;
end $$;

-- ---------------------------------------------------------------------------
-- tasks: task.changed — join through the conversation, including on DELETE.
-- ---------------------------------------------------------------------------

create or replace function public.broadcast_task_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  cid uuid := coalesce(new.conversation_id, old.conversation_id);
  co  uuid := coalesce(new.company_id, old.company_id);
  v_number uuid;
begin
  -- tasks.conversation_id is NOT NULL and `on delete restrict`, so the
  -- conversation cannot have been deleted under a live task — including in the
  -- DELETE branch, where `cid` comes from OLD.
  select c.phone_number_id into v_number
  from public.conversations c
  where c.id = cid;

  perform public.broadcast_number_scoped(
    jsonb_build_object('conversation_id', cid),
    'task.changed', co, v_number);
  return null;
end $$;

-- ---------------------------------------------------------------------------
-- port_requests: port.updated — phone_number_id, NOT bridge_number_id.
-- ---------------------------------------------------------------------------

create or replace function public.broadcast_port_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.broadcast_number_scoped(
    jsonb_build_object('port_request_id', new.id,
                       'status', new.status,
                       'messaging_port_status', new.messaging_port_status),
    'port.updated', new.company_id, new.phone_number_id);
  return null;
end $$;

-- ---------------------------------------------------------------------------
-- calls: call.updated — the one nullable number. See the header.
-- ---------------------------------------------------------------------------

create or replace function public.broadcast_call_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.broadcast_number_scoped(
    jsonb_build_object('call_id', new.id,
                       'conversation_id', new.conversation_id,
                       'call_session_id', new.call_session_id,
                       'state', new.state,
                       'answered_by_user_id', new.answered_by_user_id),
    'call.updated', new.company_id, new.phone_number_id);
  return null;
end $$;

-- ---------------------------------------------------------------------------
-- conversation_reads: read.conversation — the number is free here.
-- ---------------------------------------------------------------------------

create or replace function public.broadcast_conversation_read() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid;
  v_number uuid;
begin
  -- conversation_reads has no company_id of its own; the topic needs one. The
  -- number rides along in the SAME select, so scoping this event costs nothing.
  select c.company_id, c.phone_number_id into v_company, v_number
    from public.conversations c
   where c.id = new.conversation_id;
  if v_company is null then return null; end if;

  perform public.broadcast_number_scoped(
    jsonb_build_object('conversation_id', new.conversation_id,
                       'user_id', new.user_id),
    'read.conversation', v_company, v_number);
  return null;
end $$;

-- ---------------------------------------------------------------------------
-- #480 step 6 — revocation has to reach a LIVE connection.
-- ---------------------------------------------------------------------------
--
-- Realtime authorization is a JOIN-TIME handshake. The `realtime.messages`
-- policy is evaluated when the client sends `phx_join`, and again on a live
-- channel only when a refreshed JWT is pushed (realtime-js `setAuth`, roughly
-- hourly). It is NOT evaluated per broadcast.
--
-- So taking a member's access away does not drop their subscription: they keep
-- receiving that number's events until their token refreshes or they reconnect.
-- Up to an hour of a boundary the product believes it is enforcing.
--
-- The signal closes that. Any change to `number_access` announces itself on the
-- COMPANY topic — which every member may already join, so the announcement
-- needs no new authorization — and the clients respond by re-deriving their
-- number list and re-subscribing. A client that has lost a number then fails to
-- re-join its topic, which is exactly the intended outcome.
--
-- ID-ONLY, and not even that: the payload carries the company and nothing else.
-- Naming the number or the affected member would leak the shape of the
-- restriction to every member on the topic, which is the opposite of the point.
-- A client cannot tell from this event whether it was the subject; it just asks
-- again, and the answer is authoritative.

create or replace function public.broadcast_number_access_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  co uuid := coalesce(new.company_id, old.company_id);
begin
  if co is null then return null; end if;
  perform realtime.send(
    jsonb_build_object('company_id', co),
    'access.changed', 'company:' || co::text, true);
  return null;
end $$;

comment on function public.broadcast_number_access_changed() is
  '#480: tells every client in the company that number access changed, so they '
  're-derive their subscriptions. Needed because realtime authorization is a '
  'join-time handshake — without this, a revoked member keeps receiving a '
  'number''s events until their JWT refreshes. Payload is the company id and '
  'nothing else: naming the number would leak the restriction to everyone.';

drop trigger if exists number_access_broadcast on public.number_access;
create trigger number_access_broadcast
  after insert or update or delete on public.number_access
  for each row execute function public.broadcast_number_access_changed();
