-- ---------------------------------------------------------------------------
-- #246 — two contacts for the same customer, merged into one.
--
-- Import has had a merge-duplicates path since the beginning; nothing handled
-- duplicates AFTER the door, and they are the steady state rather than an edge
-- case: a customer texts from their mobile and calls from the landline, a tech
-- saves "Mike — furnace" the same week the office imports "Michael Chen", a
-- number changes and the history splits in two.
--
-- # A tombstone with a forwarding address, not a deletion
--
-- The loser row SURVIVES, carrying `merged_into`. Three reasons, and the first
-- is the one that decides it:
--
--   1. `contacts` is unique on (company_id, phone_e164), and the loser's number
--      has to keep resolving. If the row went away, the next inbound text from
--      that number would create the duplicate again — the merge would undo
--      itself on the customer's next message.
--   2. Undo is then a single UPDATE rather than a resurrection.
--   3. It is honest. That number really was a separate record; the merge says
--      the two are one person, not that one of them never existed.
--
-- Everything that reads contacts filters `merged_into is null`, exactly as it
-- already filters `deleted_at is null`.
--
-- # Conversations MOVE; they are never fused
--
-- The two threads were exchanges with two different personal numbers. Fusing
-- their messages into one conversation would produce a thread whose messages
-- went to different destinations, and "which number did we text" would stop
-- being answerable for every message in it. So each conversation moves intact.
--
-- `conversations_open_uq (company_id, phone_number_id, contact_id)` allows one
-- OPEN conversation per workspace number per contact, so a move can collide.
-- On collision the loser's thread is CLOSED rather than fused: its history
-- stays whole and readable under the surviving contact, and the crew is left
-- with one open thread to answer instead of two.
--
-- # Opt-out is a union, and it is NEVER upgraded to a carrier fact
--
-- #246 is right that a STOP on either side must hold for the merged contact.
-- But `opt_outs` is keyed on the PHONE, not the contact, and both numbers
-- survive the merge — so the union is achieved by writing the opt-out across
-- to the other number, not by moving a row.
--
-- The source is recorded as a MANUAL opt-out attributed to the merge, never
-- copied as `carrier`. A carrier STOP is a thing the customer did from a
-- specific handset ([[opt-out-carrier-truth]]); stamping that source onto a
-- number they never texted from would be inventing a carrier event, and the
-- one thing worse than missing an opt-out is fabricating the record of one.
-- The protection is identical either way — the send gate reads the row, not
-- its source.
-- ---------------------------------------------------------------------------

alter table public.contacts
  add column if not exists merged_into uuid references public.contacts(id) on delete restrict,
  add column if not exists merged_at   timestamptz,
  add column if not exists merged_by   uuid references auth.users(id) on delete set null;

comment on column public.contacts.merged_into is
  '#246: this contact was merged into another. The row survives so the number '
  'keeps resolving — deleting it would let the next inbound text recreate the '
  'duplicate. Readers filter it out the way they filter deleted_at.';

-- A merged row must not be a merged row's target: one hop, always.
alter table public.contacts
  drop constraint if exists contacts_merge_consistency;
alter table public.contacts
  add constraint contacts_merge_consistency
  check ((merged_into is null) = (merged_at is null));

alter table public.contacts
  drop constraint if exists contacts_merge_not_self;
alter table public.contacts
  add constraint contacts_merge_not_self
  check (merged_into is null or merged_into <> id);

-- Resolving an inbound number to its surviving contact is the hot path this
-- column exists for.
create index if not exists contacts_merged_into_idx
  on public.contacts (merged_into)
  where merged_into is not null;

-- ---------------------------------------------------------------------------
-- api_merge_contacts — fold `p_from` into `p_into`, losing nothing.
--
-- Returns a jsonb report rather than a row: the caller needs to TELL somebody
-- what happened ("3 conversations moved, 1 closed, the merged contact is opted
-- out"), and an audit entry needs the same shape.
-- ---------------------------------------------------------------------------
create or replace function public.api_merge_contacts(
  p_company_id uuid,
  p_from       uuid,
  p_into       uuid,
  p_actor      uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from      public.contacts;
  v_into      public.contacts;
  v_moved     int := 0;
  v_closed    int := 0;
  v_optout    boolean := false;
  v_conv      record;
begin
  if p_from = p_into then
    return jsonb_build_object('outcome', 'same_contact');
  end if;

  select * into v_from from public.contacts
   where id = p_from and company_id = p_company_id;
  select * into v_into from public.contacts
   where id = p_into and company_id = p_company_id;

  if v_from.id is null or v_into.id is null then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  -- Neither side may already be a tombstone. Merging into one would build a
  -- chain, and every reader would then need to follow it an unknown depth.
  if v_from.merged_into is not null or v_into.merged_into is not null then
    return jsonb_build_object('outcome', 'already_merged');
  end if;

  -- ---- Conversations -----------------------------------------------------
  -- Moved one at a time so a collision on the open-thread index is handled
  -- rather than aborting the whole merge. A bulk UPDATE would fail the first
  -- time a customer had an open thread under both records, which is exactly
  -- the case somebody is merging to fix.
  for v_conv in
    select id, phone_number_id, closed_at
      from public.conversations
     where company_id = p_company_id and contact_id = p_from
  loop
    if v_conv.closed_at is null and exists (
      select 1 from public.conversations c
       where c.company_id = p_company_id
         and c.contact_id = p_into
         and c.phone_number_id = v_conv.phone_number_id
         and c.closed_at is null
    ) then
      -- The survivor already has an open thread on this number. Close the
      -- one arriving: its history stays whole and readable, and the crew is
      -- left with one thread to answer rather than two.
      update public.conversations
         set contact_id = p_into,
             status = 'closed',
             closed_at = now(),
             updated_at = now()
       where id = v_conv.id;
      v_closed := v_closed + 1;
    else
      update public.conversations
         set contact_id = p_into, updated_at = now()
       where id = v_conv.id;
    end if;
    v_moved := v_moved + 1;
  end loop;

  -- Tasks, notes, tags, attachments and events all hang off the CONVERSATION,
  -- so they moved with it. Nothing addresses a contact directly except calls.
  update public.calls set contact_id = p_into
   where company_id = p_company_id and contact_id = p_from;

  -- ---- Opt-out union ------------------------------------------------------
  -- If either number is opted out, both are afterwards. Written as a manual
  -- opt-out attributed to the merge; see the header for why it is never
  -- recorded as a carrier STOP.
  if exists (
    select 1 from public.opt_outs
     where company_id = p_company_id
       and phone_e164 in (v_from.phone_e164, v_into.phone_e164)
       and revoked_at is null
  ) then
    v_optout := true;
    insert into public.opt_outs (company_id, phone_e164, source, created_by)
    select p_company_id, n.phone, 'manual'::public.opt_out_source, p_actor
      from (values (v_from.phone_e164), (v_into.phone_e164)) as n(phone)
    on conflict (company_id, phone_e164) do update
      set revoked_at = null, updated_at = now();
  end if;

  -- ---- The tombstone ------------------------------------------------------
  update public.contacts
     set merged_into = p_into,
         merged_at = now(),
         merged_by = p_actor,
         updated_at = now()
   where id = p_from;

  -- The survivor inherits anything it was missing. A merge should never lose a
  -- fact, and an empty field on the survivor is not a decision anybody made.
  update public.contacts
     set name = coalesce(nullif(btrim(coalesce(name, '')), ''), v_from.name),
         address = coalesce(nullif(btrim(coalesce(address, '')), ''), v_from.address),
         notes = case
           when coalesce(btrim(coalesce(notes, '')), '') = '' then v_from.notes
           when coalesce(btrim(coalesce(v_from.notes, '')), '') = '' then notes
           -- Both wrote something. Keeping one and discarding the other would
           -- silently lose what somebody typed about this customer.
           else notes || E'\n\n' || v_from.notes
         end,
         consent_source = coalesce(consent_source, v_from.consent_source),
         consent_at = coalesce(consent_at, v_from.consent_at),
         updated_at = now()
   where id = p_into;

  return jsonb_build_object(
    'outcome', 'merged',
    'moved', v_moved,
    'closed', v_closed,
    'opted_out', v_optout,
    'from_phone', v_from.phone_e164,
    'into_phone', v_into.phone_e164);
end;
$$;

revoke execute on function public.api_merge_contacts(uuid, uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.api_merge_contacts(uuid, uuid, uuid, uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- api_unmerge_contact — put it back.
--
-- #246 asks for undo OR a full audit record. Both, because a merge is the kind
-- of destructive act people get wrong: the API writes the audit entry and this
-- restores the tombstone.
--
-- What it does NOT do is move the conversations back. Which thread came from
-- which record is not recoverable once they are under one contact — and a
-- guess would be worse than the honest limit. The undo restores the SECOND
-- CONTACT and its number; the crew re-splits history by hand if they need to,
-- which is the rare case inside an already-rare one.
-- ---------------------------------------------------------------------------
create or replace function public.api_unmerge_contact(
  p_company_id uuid,
  p_contact_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_row public.contacts;
begin
  select * into v_row from public.contacts
   where id = p_contact_id and company_id = p_company_id;

  if v_row.id is null then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  if v_row.merged_into is null then
    return jsonb_build_object('outcome', 'not_merged');
  end if;

  update public.contacts
     set merged_into = null, merged_at = null, merged_by = null, updated_at = now()
   where id = p_contact_id;

  -- The opt-out union is deliberately NOT undone. If the customer said stop,
  -- they said stop; an undo of a bookkeeping mistake is not consent to text
  -- them again ([[opt-out-carrier-truth]]).
  return jsonb_build_object('outcome', 'unmerged', 'phone', v_row.phone_e164);
end;
$$;

revoke execute on function public.api_unmerge_contact(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.api_unmerge_contact(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- api_duplicate_contacts — the workspace's likely duplicates, without anybody
-- having to know they exist.
--
-- Two signals, both cheap and both explainable to the person looking at the
-- result. Anything cleverer (fuzzy address matching, phonetic names) produces
-- pairs a crew cannot judge, and a suggestion somebody cannot verify is one
-- they learn to dismiss.
-- ---------------------------------------------------------------------------
create or replace function public.api_duplicate_contacts(
  p_company_id uuid,
  p_limit      int default 50
)
returns table (
  contact_a uuid,
  name_a    text,
  phone_a   text,
  contact_b uuid,
  name_b    text,
  phone_b   text,
  reason    text
)
language sql
stable
security definer
set search_path = ''
as $$
  with live as (
    select id, name, phone_e164, btrim(lower(coalesce(name, ''))) as norm_name
      from public.contacts
     where company_id = p_company_id
       and deleted_at is null
       and merged_into is null
  )
  select a.id, a.name, a.phone_e164, b.id, b.name, b.phone_e164,
         'same name'::text
    from live a
    join live b
      on b.norm_name = a.norm_name
     and b.id > a.id
   where a.norm_name <> ''
  union all
  -- The same ten digits reached by different prefixes: "+15555550100" and a
  -- row somebody typed without the country code. The unique index on
  -- (company_id, phone_e164) treats those as different customers.
  select a.id, a.name, a.phone_e164, b.id, b.name, b.phone_e164,
         'same digits'::text
    from live a
    join live b
      on right(regexp_replace(b.phone_e164, '[^0-9]', '', 'g'), 10)
       = right(regexp_replace(a.phone_e164, '[^0-9]', '', 'g'), 10)
     and b.id > a.id
   order by 2, 5
   limit p_limit
$$;

revoke execute on function public.api_duplicate_contacts(uuid, int)
  from public, anon, authenticated;
grant execute on function public.api_duplicate_contacts(uuid, int) to service_role;
