-- [#246] Merging two contacts for the same customer — assertion suite for
-- supabase/migrations/20260802020000_contact_merge.sql.
--
-- The compliance-critical assertion is CM-3: a STOP on either side holds for
-- the merged contact, and a CARRIER stop is never copied onto a number the
-- customer never texted from. The one thing worse than missing an opt-out is
-- fabricating the record of one.
--
-- psql-runnable: every test is a DO block that RAISEs EXCEPTION on failure.
-- Run with:
--   docker exec -i supabase_db_Loonext psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/contact_merge.test.sql
--
-- One transaction, rolled back. Fixtures use a '55' id prefix so the file runs
-- standalone OR after the other suites in one psql session.

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values
  ('55000000-0000-4000-8000-00000000000a'::uuid, 'merge-a@test.local');

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at)
values
  ('55000000-0000-4000-8000-0000000000c1'::uuid, 'Merge Plumbing',
   '55000000-0000-4000-8000-00000000000a'::uuid, 'US', '415', now());

insert into public.phone_numbers
  (id, company_id, status, provisioning_key, country, number_e164)
values
  ('55000000-0000-4000-8000-0000000000f1'::uuid,
   '55000000-0000-4000-8000-0000000000c1'::uuid, 'active', 'test', 'US',
   '+14155550400');

insert into public.contacts (id, company_id, phone_e164, name, notes) values
  ('55000000-0000-4000-8000-0000000000d1'::uuid,
   '55000000-0000-4000-8000-0000000000c1'::uuid, '+14155550501',
   'Mike', 'furnace out back'),
  ('55000000-0000-4000-8000-0000000000d2'::uuid,
   '55000000-0000-4000-8000-0000000000c1'::uuid, '+14155550502',
   'Michael Chen', null),
  -- A third, for the duplicate finder: same digits, different prefix habit.
  ('55000000-0000-4000-8000-0000000000d3'::uuid,
   '55000000-0000-4000-8000-0000000000c1'::uuid, '+4155550502',
   'M. Chen', null);

insert into public.conversations
  (id, company_id, contact_id, phone_number_id)
values
  ('55000000-0000-4000-8000-0000000000e1'::uuid,
   '55000000-0000-4000-8000-0000000000c1'::uuid,
   '55000000-0000-4000-8000-0000000000d1'::uuid,
   '55000000-0000-4000-8000-0000000000f1'::uuid),
  ('55000000-0000-4000-8000-0000000000e2'::uuid,
   '55000000-0000-4000-8000-0000000000c1'::uuid,
   '55000000-0000-4000-8000-0000000000d2'::uuid,
   '55000000-0000-4000-8000-0000000000f1'::uuid);

-- A carrier STOP on the LOSING side only. CM-3 turns on this: the survivor
-- must end up protected without its own number acquiring a fabricated carrier
-- event.
insert into public.opt_outs (company_id, phone_e164, source) values
  ('55000000-0000-4000-8000-0000000000c1'::uuid, '+14155550501', 'carrier');

-- ===========================================================================
-- CM-1: the loser becomes a tombstone that still points somewhere.
--
-- It is NOT deleted. `contacts` is unique on (company_id, phone_e164), so a
-- deleted row would let the next inbound text from that number recreate the
-- duplicate — the merge would undo itself on the customer's next message.
-- ===========================================================================
do $$
declare
  v_result jsonb;
  v_row    public.contacts;
begin
  v_result := public.api_merge_contacts(
    '55000000-0000-4000-8000-0000000000c1'::uuid,
    '55000000-0000-4000-8000-0000000000d1'::uuid,
    '55000000-0000-4000-8000-0000000000d2'::uuid,
    '55000000-0000-4000-8000-00000000000a'::uuid);

  if v_result->>'outcome' <> 'merged' then
    raise exception 'CM-1: merge reported %', v_result->>'outcome';
  end if;

  select * into v_row from public.contacts
   where id = '55000000-0000-4000-8000-0000000000d1'::uuid;
  if v_row.id is null then
    raise exception 'CM-1: the merged contact row was deleted';
  end if;
  if v_row.merged_into <> '55000000-0000-4000-8000-0000000000d2'::uuid then
    raise exception 'CM-1: the tombstone does not point at the survivor';
  end if;
  if v_row.merged_at is null then
    raise exception 'CM-1: the tombstone has no timestamp';
  end if;
end $$;

-- ===========================================================================
-- CM-2: conversations move, and a collision on the open-thread index CLOSES
-- the arriving one rather than aborting the merge.
--
-- Two open threads on one workspace number is exactly the state somebody is
-- merging to fix, so it must not be the state that makes the merge fail.
-- ===========================================================================
do $$
declare
  v_moved   int;
  v_open    int;
begin
  select count(*) into v_moved from public.conversations
   where contact_id = '55000000-0000-4000-8000-0000000000d2'::uuid;
  if v_moved <> 2 then
    raise exception 'CM-2: expected both conversations on the survivor, got %', v_moved;
  end if;

  select count(*) into v_open from public.conversations
   where contact_id = '55000000-0000-4000-8000-0000000000d2'::uuid
     and closed_at is null;
  if v_open <> 1 then
    raise exception 'CM-2: expected exactly one open thread, got %', v_open;
  end if;

  -- The arriving thread is the one closed; the survivor's own stays open.
  if exists (
    select 1 from public.conversations
     where id = '55000000-0000-4000-8000-0000000000e2'::uuid
       and closed_at is not null
  ) then
    raise exception 'CM-2: the survivor''s own open thread was closed';
  end if;
end $$;

-- ===========================================================================
-- CM-3: the opt-out is a union, and a CARRIER stop is never fabricated.
--
-- THE assertion in this file. #246 requires a STOP on either input to hold for
-- the merged contact. `opt_outs` is keyed on the phone and both numbers
-- survive, so the union is written across — as a MANUAL opt-out attributed to
-- the merge, because a carrier STOP is something the customer did from a
-- specific handset and stamping that source onto a number they never texted
-- from would invent a carrier event.
-- ===========================================================================
do $$
declare
  v_from public.opt_outs;
  v_into public.opt_outs;
begin
  select * into v_from from public.opt_outs
   where company_id = '55000000-0000-4000-8000-0000000000c1'::uuid
     and phone_e164 = '+14155550501';
  select * into v_into from public.opt_outs
   where company_id = '55000000-0000-4000-8000-0000000000c1'::uuid
     and phone_e164 = '+14155550502';

  if v_from.id is null or v_from.revoked_at is not null then
    raise exception 'CM-3: the original opt-out stopped protecting its number';
  end if;
  if v_from.source <> 'carrier' then
    raise exception 'CM-3: the original carrier stop was rewritten to %', v_from.source;
  end if;

  if v_into.id is null or v_into.revoked_at is not null then
    raise exception 'CM-3: the merged contact is not opted out';
  end if;
  if v_into.source = 'carrier' then
    raise exception 'CM-3: a carrier STOP was fabricated for a number that never sent one';
  end if;
end $$;

-- ===========================================================================
-- CM-4: the survivor inherits what it was missing, and loses no note.
--
-- An empty field on the survivor is not a decision anybody made. Two notes are
-- joined rather than one discarded — somebody typed both about this customer.
-- ===========================================================================
do $$
declare v_row public.contacts;
begin
  select * into v_row from public.contacts
   where id = '55000000-0000-4000-8000-0000000000d2'::uuid;

  if v_row.name <> 'Michael Chen' then
    raise exception 'CM-4: the survivor''s own name was overwritten';
  end if;
  if v_row.notes is distinct from 'furnace out back' then
    raise exception 'CM-4: the survivor did not inherit the only note (got %)', v_row.notes;
  end if;
end $$;

-- ===========================================================================
-- CM-5: a merge cannot chain, and cannot eat itself.
--
-- Every reader follows merged_into exactly one hop. A chain would make that
-- depth unknown, and a self-merge would make it infinite.
-- ===========================================================================
do $$
declare v_result jsonb;
begin
  v_result := public.api_merge_contacts(
    '55000000-0000-4000-8000-0000000000c1'::uuid,
    '55000000-0000-4000-8000-0000000000d2'::uuid,
    '55000000-0000-4000-8000-0000000000d1'::uuid);
  if v_result->>'outcome' <> 'already_merged' then
    raise exception 'CM-5: merging into a tombstone was allowed (%)', v_result->>'outcome';
  end if;

  v_result := public.api_merge_contacts(
    '55000000-0000-4000-8000-0000000000c1'::uuid,
    '55000000-0000-4000-8000-0000000000d3'::uuid,
    '55000000-0000-4000-8000-0000000000d3'::uuid);
  if v_result->>'outcome' <> 'same_contact' then
    raise exception 'CM-5: a contact was merged into itself';
  end if;
end $$;

-- ===========================================================================
-- CM-6: undo restores the contact, and NEVER restores the ability to text.
--
-- An undo of a bookkeeping mistake is not consent to contact somebody who
-- asked us to stop.
-- ===========================================================================
do $$
declare
  v_result jsonb;
  v_row    public.contacts;
begin
  v_result := public.api_unmerge_contact(
    '55000000-0000-4000-8000-0000000000c1'::uuid,
    '55000000-0000-4000-8000-0000000000d1'::uuid);
  if v_result->>'outcome' <> 'unmerged' then
    raise exception 'CM-6: unmerge reported %', v_result->>'outcome';
  end if;

  select * into v_row from public.contacts
   where id = '55000000-0000-4000-8000-0000000000d1'::uuid;
  if v_row.merged_into is not null then
    raise exception 'CM-6: the tombstone survived the undo';
  end if;

  if not exists (
    select 1 from public.opt_outs
     where company_id = '55000000-0000-4000-8000-0000000000c1'::uuid
       and phone_e164 = '+14155550502'
       and revoked_at is null
  ) then
    raise exception 'CM-6: the undo revoked an opt-out';
  end if;

  -- Unmerging something that was never merged is a no-op, not an error.
  v_result := public.api_unmerge_contact(
    '55000000-0000-4000-8000-0000000000c1'::uuid,
    '55000000-0000-4000-8000-0000000000d3'::uuid);
  if v_result->>'outcome' <> 'not_merged' then
    raise exception 'CM-6: unmerging a live contact reported %', v_result->>'outcome';
  end if;
end $$;

-- ===========================================================================
-- CM-7: the workspace can find its duplicates without knowing they exist.
--
-- Two signals only, both explainable to the person reading the result. A
-- suggestion somebody cannot verify is one they learn to dismiss.
-- ===========================================================================
do $$
declare v_digits int;
begin
  -- '+14155550502' and '+4155550502' are the same ten digits reached by
  -- different prefix habits. The unique index treats them as two customers.
  select count(*) into v_digits
    from public.api_duplicate_contacts('55000000-0000-4000-8000-0000000000c1'::uuid)
   where reason = 'same digits';
  if v_digits < 1 then
    raise exception 'CM-7: the same ten digits were not reported as duplicates';
  end if;

  -- A tombstone is not a duplicate. Reporting the row a merge just created
  -- would send somebody to merge it again, forever.
  if exists (
    select 1 from public.api_duplicate_contacts('55000000-0000-4000-8000-0000000000c1'::uuid)
     where contact_a = '55000000-0000-4000-8000-0000000000d1'::uuid
        or contact_b = '55000000-0000-4000-8000-0000000000d1'::uuid
  ) then
    -- d1 was unmerged in CM-6, so it IS live again here; this guard is
    -- re-armed by merging it once more.
    null;
  end if;
end $$;

-- ===========================================================================
-- CM-8: a tombstone never appears in the duplicate list.
-- ===========================================================================
do $$
begin
  perform public.api_merge_contacts(
    '55000000-0000-4000-8000-0000000000c1'::uuid,
    '55000000-0000-4000-8000-0000000000d1'::uuid,
    '55000000-0000-4000-8000-0000000000d2'::uuid);

  if exists (
    select 1 from public.api_duplicate_contacts('55000000-0000-4000-8000-0000000000c1'::uuid)
     where contact_a = '55000000-0000-4000-8000-0000000000d1'::uuid
        or contact_b = '55000000-0000-4000-8000-0000000000d1'::uuid
  ) then
    raise exception 'CM-8: a merged contact is still offered as a duplicate';
  end if;
end $$;

rollback;
