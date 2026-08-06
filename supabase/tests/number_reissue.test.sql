-- [#316] A reissued number carries nothing to its next owner.
--
-- A released number does not stop being that business's number in the world. It
-- goes back to Telnyx, gets aged, and is eventually sold to somebody else —
-- possibly to another workspace of ours. Meanwhile the old customers keep texting
-- it, because it is saved in their phones, printed on an invoice, and in three
-- years of search results.
--
-- So the question this suite answers is: when the same E.164 turns up in a second
-- workspace, does ANY of the first workspace's state follow it?
--
--   NR-1  an opt-out does not suppress the new owner's messaging
--   NR-2  conversations and messages do not cross
--   NR-3  contacts do not cross
--   NR-4  the released row is retained, and stays with the OLD owner
--   NR-5  the same customer can be opted out of one workspace and not the other
--
-- WHY A TEST RATHER THAN A COMMENT. Every one of these holds today because the
-- schema keys them on `company_id`, so all five assertions pass on first run. That
-- is the point: they are here to fail if a future migration ever keys any of this
-- on the phone number instead — which is the shape of the bug #316 was filed about,
-- and the one nobody would notice until a stranger's message appeared in a
-- customer's inbox.
--
-- The sharpest is NR-1. `opt_outs` is unique on `(company_id, phone_e164)`, so a
-- STOP that the departing business recorded cannot silently gag the new owner. If
-- it were keyed on the number, a reissued number would arrive pre-broken in a way
-- the new owner could neither see nor fix — and per the binding rule that only the
-- customer can lift an opt-out, they could not clear it either.
--
-- One transaction, rolled back. Fixtures use a 'ce' id prefix.

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email, encrypted_password, email_confirmed_at,
                        created_at, updated_at, aud, role)
values ('ce000000-0000-4000-8000-000000000001', 'reissue@test.local', '', now(),
        now(), now(), 'authenticated', 'authenticated')
on conflict (id) do nothing;

-- OLD is the business that left. NEW is whoever buys the number next.
insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at,
   subscription_status, plan)
values ('ce000000-0000-4000-8000-0000000000a1', 'Old Plumbing',
        'ce000000-0000-4000-8000-000000000001', 'US', '212', now(), 'canceled', 'starter'),
       ('ce000000-0000-4000-8000-0000000000b1', 'New Landscaping',
        'ce000000-0000-4000-8000-000000000001', 'US', '212', now(), 'active', 'starter');

-- The SAME E.164, released by OLD and later bought by NEW. This is the situation:
-- one number, two owners, separated only by time.
insert into public.phone_numbers
  (id, company_id, number_e164, country, status, provisioning_key, released_at)
values ('ce000000-0000-4000-8000-0000000000c1',
        'ce000000-0000-4000-8000-0000000000a1', '+12125557788', 'US',
        'released', 'ce-old-key', now() - interval '90 days'),
       ('ce000000-0000-4000-8000-0000000000d1',
        'ce000000-0000-4000-8000-0000000000b1', '+12125557788', 'US',
        'active', 'ce-new-key', null);

-- A homeowner who texted the old business, and who will keep texting the number.
insert into public.contacts (id, company_id, phone_e164, name)
values ('ce000000-0000-4000-8000-0000000000e1',
        'ce000000-0000-4000-8000-0000000000a1', '+16135551234', 'Dana Homeowner');

insert into public.conversations
  (id, company_id, contact_id, phone_number_id, status, closed_at, last_message_at)
values ('ce000000-0000-4000-8000-0000000000f1',
        'ce000000-0000-4000-8000-0000000000a1',
        'ce000000-0000-4000-8000-0000000000e1',
        'ce000000-0000-4000-8000-0000000000c1', 'closed',
        now() - interval '95 days', now() - interval '95 days');

insert into public.messages
  (company_id, conversation_id, direction, body, status)
values ('ce000000-0000-4000-8000-0000000000a1',
        'ce000000-0000-4000-8000-0000000000f1', 'inbound',
        'hey it is 14 Elgin, the furnace is out again', 'delivered');

-- And the homeowner had replied STOP to the old business.
insert into public.opt_outs (company_id, phone_e164, source)
values ('ce000000-0000-4000-8000-0000000000a1', '+16135551234', 'stop_keyword');

-- ===========================================================================
-- NR-1. The old owner's STOP does not gag the new owner.
--
--       The sharpest assertion here. If `opt_outs` were keyed on the phone
--       NUMBER, a reissued number would arrive pre-broken: the new owner could
--       not see the suppression, and because only the customer may lift an
--       opt-out, could not clear it either. Keyed on the company, it cannot
--       happen — and this fails if that ever changes.
-- ===========================================================================
do $$
declare
  v_new uuid := 'ce000000-0000-4000-8000-0000000000b1';
begin
  if exists (
    select 1 from public.opt_outs
     where company_id = v_new and phone_e164 = '+16135551234'
  ) then
    raise exception
      'NR-1 FAILED: the new owner inherited an opt-out from the previous owner of '
      'the same number. They cannot see it and cannot lift it, so every message to '
      'that customer would be silently dropped.';
  end if;

  -- And the old record is untouched: it is that customer's, and it survives.
  if not exists (
    select 1 from public.opt_outs
     where company_id = 'ce000000-0000-4000-8000-0000000000a1'
       and phone_e164 = '+16135551234'
       and revoked_at is null
  ) then
    raise exception 'NR-1 FAILED: the original opt-out was lost';
  end if;
  raise notice 'NR-1 PASSED: opt-out stays with the company that recorded it';
end $$;

-- ===========================================================================
-- NR-2. No conversation or message crosses.
-- ===========================================================================
do $$
declare
  v_new uuid := 'ce000000-0000-4000-8000-0000000000b1';
  v_convs int;
  v_msgs  int;
begin
  select count(*) into v_convs from public.conversations where company_id = v_new;
  select count(*) into v_msgs from public.messages where company_id = v_new;
  if v_convs is distinct from 0 or v_msgs is distinct from 0 then
    raise exception
      'NR-2 FAILED: the new owner sees % conversation(s) and % message(s) from the '
      'previous owner of this number', v_convs, v_msgs;
  end if;

  -- Nor by joining through the number, which is the path a naive read model
  -- would take: the old conversation points at the OLD phone_numbers row.
  if exists (
    select 1
      from public.conversations c
      join public.phone_numbers p on p.id = c.phone_number_id
     where p.number_e164 = '+12125557788' and c.company_id = v_new
  ) then
    raise exception 'NR-2 FAILED: history reachable through the shared E.164';
  end if;
  raise notice 'NR-2 PASSED: no conversation or message crosses owners';
end $$;

-- ===========================================================================
-- NR-3. No contact crosses.
--
--       Worth its own assertion because a contact is the thing a new owner would
--       most plausibly be shown by accident: it is keyed by phone number within a
--       company, and "look up this E.164" is the obvious query.
-- ===========================================================================
do $$
declare
  v_new uuid := 'ce000000-0000-4000-8000-0000000000b1';
begin
  if exists (select 1 from public.contacts where company_id = v_new) then
    raise exception
      'NR-3 FAILED: the new owner sees a contact created by the previous owner';
  end if;
  raise notice 'NR-3 PASSED: contacts do not cross owners';
end $$;

-- ===========================================================================
-- NR-4. The released row is retained, and stays with the old owner.
--
--       Rows are kept forever (SPEC §6) so a release can be audited. That is
--       correct, and it is also exactly what makes two rows for one E.164 normal
--       rather than a data error — so anything reading `phone_numbers` by number
--       alone has to expect more than one.
-- ===========================================================================
do $$
declare
  v_rows int;
  v_old_status text;
begin
  select count(*) into v_rows
    from public.phone_numbers where number_e164 = '+12125557788';
  if v_rows is distinct from 2 then
    raise exception 'NR-4 FAILED: expected 2 rows for one reissued E.164, found %', v_rows;
  end if;

  select status into v_old_status from public.phone_numbers
   where company_id = 'ce000000-0000-4000-8000-0000000000a1';
  if v_old_status is distinct from 'released' then
    raise exception 'NR-4 FAILED: the old row is % rather than released', v_old_status;
  end if;

  -- Exactly one is live. Two active rows for one number would mean two
  -- workspaces could send from it at once.
  if (select count(*) from public.phone_numbers
       where number_e164 = '+12125557788' and status = 'active') is distinct from 1 then
    raise exception 'NR-4 FAILED: more than one workspace holds this number as active';
  end if;
  raise notice 'NR-4 PASSED: released row retained, exactly one live owner';
end $$;

-- ===========================================================================
-- NR-5. The same customer, opted out of one workspace and not the other.
--
--       The general form of NR-1, and the reason the per-company key is right
--       rather than merely convenient: an opt-out is a statement about a
--       relationship between one business and one person, not about a phone
--       number. A homeowner who told their old plumber to stop has said nothing
--       to the landscaper who now owns that plumber's old number.
-- ===========================================================================
do $$
declare
  v_new uuid := 'ce000000-0000-4000-8000-0000000000b1';
begin
  -- The new owner records their own opt-out for the same person. Both must coexist.
  insert into public.opt_outs (company_id, phone_e164, source)
  values (v_new, '+16135551234', 'manual');

  if (select count(*) from public.opt_outs where phone_e164 = '+16135551234') is distinct from 2 then
    raise exception
      'NR-5 FAILED: two companies cannot each hold their own opt-out for one person';
  end if;

  -- And revoking one leaves the other standing.
  update public.opt_outs set revoked_at = now()
   where company_id = v_new and phone_e164 = '+16135551234';
  if (select revoked_at from public.opt_outs
       where company_id = 'ce000000-0000-4000-8000-0000000000a1'
         and phone_e164 = '+16135551234') is not null then
    raise exception 'NR-5 FAILED: revoking one company''s opt-out revoked another''s';
  end if;
  raise notice 'NR-5 PASSED: opt-out is per relationship, not per number';
end $$;

select 'number_reissue.test.sql: NR-1..NR-5 PASSED' as result;

rollback;
