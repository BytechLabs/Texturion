-- [#642/#643] Telnyx spend and capacity reads: assertion suite for
-- supabase/migrations/20261101120000_telnyx_spend_and_capacity_reads.sql.
--
-- What this pins is what would make the watches lie: a spend figure that
-- counts a text the company did not send, or counts one outside the window,
-- would fire the pre-cap alert for a workspace that is nowhere near its limit,
-- and a peak that counts calls which only touch would warn about a crew that
-- fits. Both reads must also stay closed to the browser roles.
--
-- One transaction, rolled back. Fixtures use a 'bc' id prefix.

\set ON_ERROR_STOP on

begin;

delete from public.provider_costs;
delete from public.calls;

insert into auth.users (id, email) values
  ('bc000000-0000-4000-8000-00000000000a'::uuid, 'spend-owner@test.local');

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at,
   subscription_status, telnyx_messaging_profile_id)
values
  ('bc000000-0000-4000-8000-0000000000c1'::uuid, 'Spender Co',
   'bc000000-0000-4000-8000-00000000000a'::uuid, 'US', '415', now(),
   'active', 'bc-profile-1'),
  -- No messaging profile: never part of the read, whatever it spent.
  ('bc000000-0000-4000-8000-0000000000c2'::uuid, 'No Profile Co',
   'bc000000-0000-4000-8000-00000000000a'::uuid, 'US', '415', now(),
   'active', null);

insert into public.phone_numbers
  (company_id, provisioning_key, country, number_e164, status)
values
  ('bc000000-0000-4000-8000-0000000000c1'::uuid, 'bc-spend-1', 'US',
   '+14155550142', 'active'),
  ('bc000000-0000-4000-8000-0000000000c2'::uuid, 'bc-spend-2', 'US',
   '+14155550143', 'active');

create or replace function pg_temp.seed_text(
  p_company uuid, p_direction text, p_cost numeric, p_age interval,
  p_accepted boolean default true
) returns void language plpgsql as $$
declare
  v_contact uuid;
  v_conv uuid;
  v_num uuid;
begin
  select id into v_num from public.phone_numbers
   where company_id = p_company limit 1;
  insert into public.contacts (company_id, phone_e164)
  values (p_company, '+1416555' || lpad((random() * 8999 + 1000)::int::text, 4, '0'))
  returning id into v_contact;
  insert into public.conversations
    (company_id, contact_id, phone_number_id, status, last_message_at)
  values (p_company, v_contact, v_num, 'open', now())
  returning id into v_conv;
  insert into public.messages
    (company_id, conversation_id, direction, body, status, telnyx_message_id,
     sent_by_user_id, provider_cost, created_at)
  values (p_company, v_conv, p_direction, 'text', 'delivered',
          case when p_accepted then 'bc-msg-' || gen_random_uuid()::text end,
          case when p_direction = 'outbound'
               then 'bc000000-0000-4000-8000-00000000000a'::uuid end,
          p_cost, now() - p_age);
end $$;

-- ---------------------------------------------------------------------------
-- api_telnyx_spend_since
-- ---------------------------------------------------------------------------

-- Spender Co: 3.00 + 1.50 sent inside the window, 9.00 sent before it, an
-- inbound text with a cost, and a send Telnyx never accepted.
select pg_temp.seed_text('bc000000-0000-4000-8000-0000000000c1'::uuid, 'outbound', 3.00, interval '2 hours');
select pg_temp.seed_text('bc000000-0000-4000-8000-0000000000c1'::uuid, 'outbound', 1.50, interval '3 hours');
select pg_temp.seed_text('bc000000-0000-4000-8000-0000000000c1'::uuid, 'outbound', 9.00, interval '30 hours');
select pg_temp.seed_text('bc000000-0000-4000-8000-0000000000c1'::uuid, 'inbound', 7.00, interval '1 hour');
select pg_temp.seed_text('bc000000-0000-4000-8000-0000000000c1'::uuid, 'outbound', 5.00, interval '1 hour', false);
select pg_temp.seed_text('bc000000-0000-4000-8000-0000000000c2'::uuid, 'outbound', 40.00, interval '2 hours');

-- Voice: two legs inside the window, one before it.
insert into public.provider_costs (kind, ref, company_id, cost_usd, occurred_at) values
  ('voice', 'bc-leg-1', 'bc000000-0000-4000-8000-0000000000c1'::uuid, 2.25, now() - interval '1 hour'),
  ('voice', 'bc-leg-2', 'bc000000-0000-4000-8000-0000000000c2'::uuid, 0.75, now() - interval '2 hours'),
  ('voice', 'bc-leg-3', 'bc000000-0000-4000-8000-0000000000c1'::uuid, 11.00, now() - interval '40 hours');

do $$
declare
  v_voice numeric;
  v_spend numeric;
  v_rows  int;
begin
  select spend_usd into v_voice
    from public.api_telnyx_spend_since(now() - interval '24 hours', now())
   where kind = 'voice';
  if v_voice is distinct from 3.00 then
    raise exception 'voice spend must sum the legs inside the window only, got %', v_voice;
  end if;

  select spend_usd into v_spend
    from public.api_telnyx_spend_since(now() - interval '24 hours', now())
   where kind = 'message'
     and company_id = 'bc000000-0000-4000-8000-0000000000c1'::uuid;
  if v_spend is distinct from 4.50 then
    raise exception
      'message spend must be the window''s accepted outbound cost only '
      '(not inbound, not unaccepted, not older), got %', v_spend;
  end if;

  select count(*) into v_rows
    from public.api_telnyx_spend_since(now() - interval '24 hours', now())
   where kind = 'message'
     and company_id = 'bc000000-0000-4000-8000-0000000000c2'::uuid;
  if v_rows is distinct from 0 then
    raise exception 'a company with no messaging profile must not appear';
  end if;

  -- The window is half open and honours its end, which the hourly "was it
  -- already over an hour ago" comparison depends on.
  select spend_usd into v_voice
    from public.api_telnyx_spend_since(now() - interval '24 hours', now() - interval '90 minutes')
   where kind = 'voice';
  if v_voice is distinct from 0.75 then
    raise exception 'an earlier end must leave out later legs, got %', v_voice;
  end if;

  -- Nothing spent is a zero voice row, never an absent figure.
  select spend_usd into v_voice
    from public.api_telnyx_spend_since(now() + interval '1 hour', now() + interval '2 hours')
   where kind = 'voice';
  if v_voice is distinct from 0 then
    raise exception 'an empty window must read zero voice spend, got %', v_voice;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- api_voice_capacity_read
-- ---------------------------------------------------------------------------

-- Three answered calls: A and B overlap for ten minutes, C only touches B's
-- end. The peak is 2, not 3.
insert into public.calls
  (company_id, call_session_id, direction, created_at, answered_at, ended_at)
values
  ('bc000000-0000-4000-8000-0000000000c1'::uuid, 'bc-call-a', 'inbound', now() - interval '3 hours',
   now() - interval '3 hours', now() - interval '2 hours 50 minutes'),
  ('bc000000-0000-4000-8000-0000000000c1'::uuid, 'bc-call-b', 'inbound', now() - interval '3 hours',
   now() - interval '2 hours 55 minutes',
   now() - interval '2 hours 40 minutes'),
  ('bc000000-0000-4000-8000-0000000000c2'::uuid, 'bc-call-c', 'inbound', now() - interval '3 hours',
   now() - interval '2 hours 40 minutes', now() - interval '2 hours 30 minutes'),
  -- Never answered, and older than the window: neither counts.
  ('bc000000-0000-4000-8000-0000000000c1'::uuid, 'bc-call-d', 'inbound', now() - interval '3 hours', null, null),
  ('bc000000-0000-4000-8000-0000000000c1'::uuid, 'bc-call-e', 'inbound', now() - interval '40 days',
   now() - interval '40 days', now() - interval '40 days' + interval '1 hour'),
  ('bc000000-0000-4000-8000-0000000000c1'::uuid, 'bc-call-f', 'inbound', now() - interval '40 days',
   now() - interval '40 days' + interval '10 minutes', now() - interval '40 days' + interval '50 minutes');

do $$
declare
  v_peak     int;
  v_audience int;
begin
  select peak_concurrent_calls, largest_audience into v_peak, v_audience
    from public.api_voice_capacity_read();
  if v_peak is distinct from 2 then
    raise exception
      'calls that only touch must not count as overlapping, and calls outside '
      'the 28 days must not count; expected a peak of 2, got %', v_peak;
  end if;
  if v_audience is null or v_audience < 0 then
    raise exception 'the audience must be a count, got %', v_audience;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Closed to the browser roles
-- ---------------------------------------------------------------------------

do $$
declare
  v_role text;
begin
  foreach v_role in array array['anon', 'authenticated'] loop
    if has_function_privilege(v_role,
         'public.api_telnyx_spend_since(timestamptz, timestamptz)', 'execute') then
      raise exception '% must not execute api_telnyx_spend_since', v_role;
    end if;
    if has_function_privilege(v_role,
         'public.api_voice_capacity_read()', 'execute') then
      raise exception '% must not execute api_voice_capacity_read', v_role;
    end if;
  end loop;
  if not has_function_privilege('service_role',
       'public.api_telnyx_spend_since(timestamptz, timestamptz)', 'execute') then
    raise exception 'service_role must execute api_telnyx_spend_since';
  end if;
  if not has_function_privilege('service_role',
       'public.api_voice_capacity_read()', 'execute') then
    raise exception 'service_role must execute api_voice_capacity_read';
  end if;
end $$;

rollback;
