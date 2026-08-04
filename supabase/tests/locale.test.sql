-- #228 — the language columns, and the null that means "ask the company".
--
-- The storage shape is the whole decision here. `contacts.locale` is nullable
-- and the null means "whatever the business works in", NOT English. The cheap
-- wrong version — resolve on write and store the answer per contact — looks
-- identical the day it ships and diverges the first time an owner changes the
-- company setting, at which point thousands of rows keep the language they were
-- created under and the owner watches the setting do nothing.
--
-- That is not assertable in TypeScript, because the defect would be in what the
-- database holds. It is assertable here.

begin;

do $$
declare
  v_owner   uuid;
  v_company uuid;
  v_contact uuid;
  v_result  text;
begin
  insert into auth.users (id, email)
  values (gen_random_uuid(), 'locale-test@example.com')
  returning id into v_owner;

  insert into public.companies
    (name, owner_user_id, country, requested_area_code, aup_accepted_at)
  values ('Locale Test Co', v_owner, 'CA', '514', now())
  returning id into v_company;

  -- L-1: a business that never said otherwise works in English.
  select locale into v_result from public.companies where id = v_company;
  if v_result is distinct from 'en' then
    raise exception 'L-1 FAILED: a new company defaulted to %, not en', v_result;
  end if;
  raise notice 'L-1 PASSED: a new company works in English until it says otherwise';

  insert into public.contacts (company_id, phone_e164, name)
  values (v_company, '+15145550100', 'Client Test')
  returning id into v_contact;

  -- L-2: a contact starts with NO language of its own. If a default ever
  -- appears on this column the inheritance below stops working, silently.
  select locale into v_result from public.contacts where id = v_contact;
  if v_result is not null then
    raise exception 'L-2 FAILED: contacts.locale defaulted to %, so it can no '
      'longer mean "follow the company"', v_result;
  end if;
  raise notice 'L-2 PASSED: a contact carries no language of its own by default';

  -- L-3: THE PROPERTY THIS SHAPE EXISTS FOR. Move the company to French and the
  -- contact that never chose moves with it, with nothing written to its row.
  update public.companies set locale = 'fr-CA' where id = v_company;
  select coalesce(c.locale, co.locale)
    into v_result
    from public.contacts c
    join public.companies co on co.id = c.company_id
   where c.id = v_contact;
  if v_result is distinct from 'fr-CA' then
    raise exception 'L-3 FAILED: the company moved to fr-CA and the contact '
      'resolved to %', v_result;
  end if;
  raise notice 'L-3 PASSED: changing the company language moves every contact that never chose';

  -- L-4: and a contact that DID choose is not moved by it.
  update public.contacts set locale = 'en' where id = v_contact;
  select coalesce(c.locale, co.locale)
    into v_result
    from public.contacts c
    join public.companies co on co.id = c.company_id
   where c.id = v_contact;
  if v_result is distinct from 'en' then
    raise exception 'L-4 FAILED: a contact set to en resolved to %', v_result;
  end if;
  raise notice 'L-4 PASSED: a contact that chose keeps its own language';

  -- L-5: the constraint is real on both tables. A typo'd locale that reached
  -- the send path would fall back to English silently, so it is refused here
  -- where somebody finds out.
  begin
    update public.companies set locale = 'fr_ca' where id = v_company;
    raise exception 'L-5 FAILED: companies accepted fr_ca';
  exception
    when check_violation then null;
  end;
  begin
    update public.contacts set locale = 'french' where id = v_contact;
    raise exception 'L-5 FAILED: contacts accepted french';
  exception
    when check_violation then null;
  end;
  raise notice 'L-5 PASSED: a misspelled locale is refused by both tables';

  -- L-6: null stays writable on the contact, because "go back to following the
  -- company" has to be expressible. A NOT NULL here would make the override
  -- permanent once set.
  update public.contacts set locale = null where id = v_contact;
  raise notice 'L-6 PASSED: a contact can be handed back to the company default';
end $$;

rollback;
