-- #540 — a member puts a dashboard panel away.
--
-- The function under test writes to `company_members`, which is also the table
-- that holds `role`. That is the whole reason it exists rather than the route
-- issuing an UPDATE: a bug in a layout preference must not be able to change
-- somebody's permissions. The third assertion below is that one, and it is the
-- reason this suite is here at all.
\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email) values
  ('aaaa1111-0000-4000-8000-000000000001', 'panel-owner@example.test'),
  ('aaaa1111-0000-4000-8000-000000000002', 'panel-mate@example.test')
  on conflict do nothing;

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at)
values ('bbbb2222-0000-4000-8000-000000000002', 'Panel Co',
        'aaaa1111-0000-4000-8000-000000000001', 'US', '415', now());

insert into public.company_members (company_id, user_id, role) values
  ('bbbb2222-0000-4000-8000-000000000002',
   'aaaa1111-0000-4000-8000-000000000001', 'owner'),
  ('bbbb2222-0000-4000-8000-000000000002',
   'aaaa1111-0000-4000-8000-000000000002', 'member');

-- 1. A new membership has nothing hidden.
--
-- Stored as "hidden" rather than "shown" so that this default means the whole
-- screen: storing what is SHOWN would mean every existing member's dashboard
-- silently stops growing the next time the product gains a card.
do $$
declare v text[];
begin
  select dashboard_hidden into v from public.company_members
   where user_id = 'aaaa1111-0000-4000-8000-000000000001';
  if v is distinct from '{}' then
    raise exception 'a new membership starts with % hidden', v;
  end if;
end $$;

-- 2. It saves, and reports what it stored rather than what it was handed.
do $$
begin
  if public.api_set_dashboard_hidden(
       'bbbb2222-0000-4000-8000-000000000002',
       'aaaa1111-0000-4000-8000-000000000001',
       array['pipeline','recent_calls']) is distinct from array['pipeline','recent_calls'] then
    raise exception 'the saved set was not reported back';
  end if;
end $$;

-- 3. THE ONE THAT MATTERS: the role is untouched.
do $$
declare v public.member_role;
begin
  select role into v from public.company_members
   where user_id = 'aaaa1111-0000-4000-8000-000000000001';
  if v is distinct from 'owner' then
    raise exception 'saving a layout preference changed the role to %', v;
  end if;
end $$;

-- 4. And it is scoped to ONE membership. A function that saved everybody's
--    preference at once would be invisible until two people in a workspace
--    disagreed about their screens.
do $$
declare v text[];
begin
  select dashboard_hidden into v from public.company_members
   where user_id = 'aaaa1111-0000-4000-8000-000000000002';
  if v is distinct from '{}' then
    raise exception 'a colleague''s dashboard was changed too: %', v;
  end if;
end $$;

-- 5. An empty set is how a member puts a panel back.
do $$
begin
  if public.api_set_dashboard_hidden(
       'bbbb2222-0000-4000-8000-000000000002',
       'aaaa1111-0000-4000-8000-000000000001',
       array[]::text[]) is distinct from '{}' then
    raise exception 'an empty set did not clear the hidden panels';
  end if;
end $$;

-- 6. NULL is empty, not a not-null violation. A client that omits the field is
--    describing an empty screen-preference, and a 500 there would be a crash
--    over a checkbox.
do $$
begin
  if public.api_set_dashboard_hidden(
       'bbbb2222-0000-4000-8000-000000000002',
       'aaaa1111-0000-4000-8000-000000000001',
       null) is distinct from '{}' then
    raise exception 'a null set did not resolve to empty';
  end if;
end $$;

-- 7. A membership deactivated mid-session raises rather than reporting a save
--    that was written nowhere. The route turns this into a 403, because a retry
--    can never succeed.
update public.company_members set deactivated_at = now()
 where user_id = 'aaaa1111-0000-4000-8000-000000000001';
do $$
begin
  perform public.api_set_dashboard_hidden(
    'bbbb2222-0000-4000-8000-000000000002',
    'aaaa1111-0000-4000-8000-000000000001',
    array['pipeline']);
  raise exception 'a deactivated membership saved a preference anyway';
exception when no_data_found then
  null; -- expected
end $$;

-- 8. And naming a company you do not belong to changes nothing.
do $$
begin
  perform public.api_set_dashboard_hidden(
    '00000000-0000-4000-8000-000000000999',
    'aaaa1111-0000-4000-8000-000000000002',
    array['pipeline']);
  raise exception 'a preference was saved against the wrong company';
exception when no_data_found then
  null; -- expected
end $$;

rollback;
