-- [#232 / D124] Proving a stranger owns the number, before we text it.
--
-- This is the one primitive the "Text us" widget needs that the product did not
-- have, and it is the slice where being wrong costs money: a public write
-- endpoint on somebody else's website that sends a text.
--
-- What this suite is really defending is the COST STORY. Every budget counts
-- rows in `widget_verifications`, which is one row per text sent — not
-- conversations opened. A visitor who abandons after the code still cost a
-- segment, and a cap that counted conversations would protect the number
-- nobody is spending.
--
-- One transaction, rolled back. Fixtures use a 'wd' id prefix.

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values
  ('dd000000-0000-4000-8000-00000000000a'::uuid, 'widget-owner@test.local');

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at)
values
  ('dd000000-0000-4000-8000-0000000000c1'::uuid, 'Widget Co',
   'dd000000-0000-4000-8000-00000000000a'::uuid, 'US', '415', now()),
  ('dd000000-0000-4000-8000-0000000000c2'::uuid, 'Other Co',
   'dd000000-0000-4000-8000-00000000000a'::uuid, 'US', '415', now());

-- ===========================================================================
-- WV-1. A code is claimed, and the row holds a HASH rather than a code.
-- ===========================================================================
do $$
declare
  v jsonb;
  v_row public.widget_verifications%rowtype;
begin
  v := public.api_claim_widget_verification(
    'dd000000-0000-4000-8000-0000000000c1', '+15550100', 'hash-aaaaaaaaaaaaaaaa',
    '203.0.113.9', 600, 20, 5, 60);
  if not (v->>'allowed')::boolean then
    raise exception 'WV-1 FAILED: a first code must be allowed, got %', v;
  end if;

  select * into v_row from public.widget_verifications
   where id = (v->>'id')::uuid;
  if v_row.code_hash is distinct from 'hash-aaaaaaaaaaaaaaaa' then
    raise exception 'WV-1 FAILED: the hash was not stored';
  end if;
  if v_row.verified_at is not null or v_row.attempts is distinct from 0 then
    raise exception 'WV-1 FAILED: a fresh row must be unverified with no attempts';
  end if;
  if v_row.expires_at <= now() then
    raise exception 'WV-1 FAILED: the row expired before it was written';
  end if;

  raise notice 'WV-1 PASSED: a code is claimed and stored as a hash';
end $$;

-- ===========================================================================
-- WV-2. The resend throttle, which is the commonest refusal.
-- ===========================================================================
do $$
declare v jsonb;
begin
  v := public.api_claim_widget_verification(
    'dd000000-0000-4000-8000-0000000000c1', '+15550100', 'hash-bbbbbbbbbbbbbbbb',
    null, 600, 20, 5, 60);
  if (v->>'allowed')::boolean then
    raise exception 'WV-2 FAILED: a second code within the throttle must be refused';
  end if;
  if v->>'reason' is distinct from 'too_soon' then
    raise exception 'WV-2 FAILED: expected too_soon, got %', v->>'reason';
  end if;

  -- A zero throttle is a caller's choice, and must not be read as "no limit
  -- configured, allow everything through a different door".
  v := public.api_claim_widget_verification(
    'dd000000-0000-4000-8000-0000000000c1', '+15550100', 'hash-cccccccccccccccc',
    null, 600, 20, 5, 0);
  if not (v->>'allowed')::boolean then
    raise exception 'WV-2 FAILED: a zero throttle must allow the resend, got %', v;
  end if;

  raise notice 'WV-2 PASSED: the resend throttle holds, and zero means zero';
end $$;

-- ===========================================================================
-- WV-3. THE CAPS COUNT TEXTS SENT, NOT CONVERSATIONS OPENED.
--
-- The assertion this whole table exists for. Rows here are never verified, so
-- a cap counting "conversations opened" would let this run forever.
-- ===========================================================================
do $$
declare
  v jsonb;
  i int;
begin
  -- Fill the company's day with abandoned codes: claimed, never answered.
  for i in 1..5 loop
    insert into public.widget_verifications
      (company_id, phone_e164, code_hash, expires_at)
    values
      ('dd000000-0000-4000-8000-0000000000c2',
       '+1555020' || i::text, 'hash-dddddddddddddddd', now() + interval '10 min');
  end loop;

  v := public.api_claim_widget_verification(
    'dd000000-0000-4000-8000-0000000000c2', '+15550299', 'hash-eeeeeeeeeeeeeeee',
    null, 600, 5, 5, 0);
  if (v->>'allowed')::boolean then
    raise exception
      'WV-3 FAILED: five abandoned codes must exhaust a cap of five. A cap that '
      'counts conversations rather than texts protects the number nobody spends.';
  end if;
  if v->>'reason' is distinct from 'company_cap' then
    raise exception 'WV-3 FAILED: expected company_cap, got %', v->>'reason';
  end if;

  raise notice 'WV-3 PASSED: the company cap counts texts sent, not conversations';
end $$;

-- ===========================================================================
-- WV-4. The per-number budget spans companies.
--
-- The point of this one is that somebody cannot be texted repeatedly by
-- cycling through the widgets of different workspaces.
-- ===========================================================================
do $$
declare
  v jsonb;
  i int;
begin
  for i in 1..3 loop
    insert into public.widget_verifications
      (company_id, phone_e164, code_hash, expires_at)
    values
      ('dd000000-0000-4000-8000-0000000000c2',
       '+15550777', 'hash-ffffffffffffffff', now() + interval '10 min');
  end loop;

  -- A DIFFERENT company, well under its own cap, and the same stranger.
  v := public.api_claim_widget_verification(
    'dd000000-0000-4000-8000-0000000000c1', '+15550777', 'hash-gggggggggggggggg',
    null, 600, 50, 3, 0);
  if (v->>'allowed')::boolean then
    raise exception
      'WV-4 FAILED: the per-number budget must span companies, or the widget is '
      'a way to text one person once per workspace';
  end if;
  if v->>'reason' is distinct from 'number_cap' then
    raise exception 'WV-4 FAILED: expected number_cap, got %', v->>'reason';
  end if;

  raise notice 'WV-4 PASSED: one person cannot be texted by cycling workspaces';
end $$;

-- ===========================================================================
-- WV-5. A closed workspace spends nothing.
--
-- A widget left embedded on a site outlives the account behind it.
-- ===========================================================================
do $$
declare v jsonb;
begin
  update public.companies set deleted_at = now()
   where id = 'dd000000-0000-4000-8000-0000000000c2';

  v := public.api_claim_widget_verification(
    'dd000000-0000-4000-8000-0000000000c2', '+15550999', 'hash-hhhhhhhhhhhhhhhh',
    null, 600, 50, 50, 0);
  if (v->>'allowed')::boolean then
    raise exception 'WV-5 FAILED: a closed workspace must not send a text';
  end if;
  if v->>'reason' is distinct from 'unknown_company' then
    raise exception 'WV-5 FAILED: expected unknown_company, got %', v->>'reason';
  end if;

  update public.companies set deleted_at = null
   where id = 'dd000000-0000-4000-8000-0000000000c2';
  raise notice 'WV-5 PASSED: a closed workspace spends nothing';
end $$;

-- ===========================================================================
-- WV-6. Answering: right, wrong, expired, and spent.
-- ===========================================================================
do $$
declare
  v_id uuid;
  v jsonb;
begin
  insert into public.widget_verifications
    (company_id, phone_e164, code_hash, expires_at)
  values
    ('dd000000-0000-4000-8000-0000000000c1', '+15551234',
     'hash-iiiiiiiiiiiiiiii', now() + interval '10 min')
  returning id into v_id;

  v := public.api_answer_widget_verification(v_id, 'hash-WRONGWRONGWRONG', 5);
  if (v->>'ok')::boolean or v->>'reason' is distinct from 'wrong' then
    raise exception 'WV-6 FAILED: a wrong code must be refused, got %', v;
  end if;
  if (select attempts from public.widget_verifications where id = v_id) is distinct from 1 then
    raise exception 'WV-6 FAILED: a wrong guess must cost an attempt';
  end if;

  v := public.api_answer_widget_verification(v_id, 'hash-iiiiiiiiiiiiiiii', 5);
  if not (v->>'ok')::boolean then
    raise exception 'WV-6 FAILED: the right code must be accepted, got %', v;
  end if;
  if v->>'phone_e164' is distinct from '+15551234' then
    raise exception 'WV-6 FAILED: the answer must report the number it verified';
  end if;

  -- ONE SHOT. A verified code answered again is not a second success.
  v := public.api_answer_widget_verification(v_id, 'hash-iiiiiiiiiiiiiiii', 5);
  if (v->>'ok')::boolean or v->>'reason' is distinct from 'already_used' then
    raise exception 'WV-6 FAILED: a spent code must not verify twice, got %', v;
  end if;

  raise notice 'WV-6 PASSED: right, wrong and spent are three different answers';
end $$;

-- ===========================================================================
-- WV-7. An EXPIRED row still costs an attempt.
--
-- The subtle one. If expiry short-circuited before the attempt counter, a
-- patient attacker would have an unlimited oracle: let the code expire, then
-- guess forever at no cost, learning from the difference between "expired" and
-- "wrong".
-- ===========================================================================
do $$
declare
  v_id uuid;
  v jsonb;
begin
  insert into public.widget_verifications
    (company_id, phone_e164, code_hash, expires_at)
  values
    ('dd000000-0000-4000-8000-0000000000c1', '+15555678',
     'hash-jjjjjjjjjjjjjjjj', now() - interval '1 min')
  returning id into v_id;

  v := public.api_answer_widget_verification(v_id, 'hash-jjjjjjjjjjjjjjjj', 3);
  if (v->>'ok')::boolean then
    raise exception 'WV-7 FAILED: an expired code must never verify';
  end if;
  if v->>'reason' is distinct from 'expired' then
    raise exception 'WV-7 FAILED: expected expired, got %', v->>'reason';
  end if;
  if (select attempts from public.widget_verifications where id = v_id) is distinct from 1 then
    raise exception
      'WV-7 FAILED: an expired row must still cost an attempt, or it is a free '
      'guessing oracle for anybody patient enough to wait out the clock';
  end if;

  -- And the ceiling bites, on the expired row as much as a live one.
  perform public.api_answer_widget_verification(v_id, 'x', 3);
  perform public.api_answer_widget_verification(v_id, 'x', 3);
  v := public.api_answer_widget_verification(v_id, 'x', 3);
  if v->>'reason' is distinct from 'too_many_attempts' then
    raise exception 'WV-7 FAILED: the attempt ceiling must bite, got %', v;
  end if;

  raise notice 'WV-7 PASSED: expiry is not a free oracle';
end $$;

-- ===========================================================================
-- WV-8. An unknown id is refused without saying so differently.
-- ===========================================================================
do $$
declare v jsonb;
begin
  v := public.api_answer_widget_verification(
    'dd000000-0000-4000-8000-00000000dead', 'anything', 5);
  if (v->>'ok')::boolean then
    raise exception 'WV-8 FAILED: an unknown verification must not verify';
  end if;
  raise notice 'WV-8 PASSED: an unknown id is refused';
end $$;

-- ===========================================================================
-- WV-9. The table shrinks on its own.
--
-- It holds a phone number and an IP per row. A table like that with no way to
-- shrink is a growing pile of personal data whose only defence is that nobody
-- has looked.
-- ===========================================================================
do $$
declare v_deleted int;
begin
  insert into public.widget_verifications
    (company_id, phone_e164, code_hash, expires_at, created_at)
  values
    ('dd000000-0000-4000-8000-0000000000c1', '+15559999',
     'hash-kkkkkkkkkkkkkkkk', now() - interval '40 days', now() - interval '40 days');

  v_deleted := public.api_prune_widget_verifications(30);
  if v_deleted < 1 then
    raise exception 'WV-9 FAILED: a 40-day-old row must be pruned at 30 days';
  end if;
  if exists (
    select 1 from public.widget_verifications where phone_e164 = '+15559999'
  ) then
    raise exception 'WV-9 FAILED: the old row survived the prune';
  end if;
  -- And today's rows are untouched, which is the half that would make a prune
  -- destructive rather than tidy.
  if not exists (
    select 1 from public.widget_verifications where phone_e164 = '+15551234'
  ) then
    raise exception 'WV-9 FAILED: the prune took a row inside the window';
  end if;

  raise notice 'WV-9 PASSED: the table shrinks, and only from the far end';
end $$;

-- ===========================================================================
-- WV-11. The embed's key resolves to a workspace, and rotating it stops the
--        old embeds dead.
--
-- The key exists because a workspace id in a customer's page source cannot be
-- rotated when it is abused — it IS the workspace. That property is only real
-- if replacing the key actually invalidates the old one, so it is asserted
-- rather than assumed.
-- ===========================================================================
do $$
declare
  v_key uuid;
  v_id  uuid;
begin
  select widget_key into v_key from public.companies
   where id = 'dd000000-0000-4000-8000-0000000000c1';
  if v_key is null then
    raise exception 'WV-11 FAILED: a workspace must have a widget key by default';
  end if;

  v_id := public.api_company_for_widget_key(v_key);
  if v_id is distinct from 'dd000000-0000-4000-8000-0000000000c1'::uuid then
    raise exception 'WV-11 FAILED: the key must resolve to its own workspace';
  end if;

  -- ROTATION. The whole point of a key rather than an id.
  update public.companies set widget_key = gen_random_uuid()
   where id = 'dd000000-0000-4000-8000-0000000000c1';
  if public.api_company_for_widget_key(v_key) is not null then
    raise exception
      'WV-11 FAILED: the old key still resolves after rotation, which makes the '
      'key no better than the workspace id it replaced';
  end if;

  raise notice 'WV-11 PASSED: the key resolves, and rotating it kills the old embeds';
end $$;

-- ===========================================================================
-- WV-12. A closed workspace resolves to nothing.
--
-- A widget outlives the account behind it: the snippet sits on a website long
-- after somebody stops paying, and the first thing that must not happen is a
-- text sent on behalf of a business that no longer exists.
-- ===========================================================================
do $$
declare v_key uuid;
begin
  select widget_key into v_key from public.companies
   where id = 'dd000000-0000-4000-8000-0000000000c2';

  update public.companies set deleted_at = now()
   where id = 'dd000000-0000-4000-8000-0000000000c2';

  if public.api_company_for_widget_key(v_key) is not null then
    raise exception
      'WV-12 FAILED: a closed workspace resolved from its widget key, so an '
      'embed left on a website outlives the account and can still send';
  end if;

  update public.companies set deleted_at = null
   where id = 'dd000000-0000-4000-8000-0000000000c2';
  raise notice 'WV-12 PASSED: a closed workspace resolves to nothing';
end $$;

-- ===========================================================================
-- WV-13. Two workspaces never share a key.
--
-- Enforced by the unique index rather than by hope: a collision would route
-- one business's website visitors into another business's inbox.
-- ===========================================================================
do $$
declare v_other uuid;
begin
  select widget_key into v_other from public.companies
   where id = 'dd000000-0000-4000-8000-0000000000c2';
  begin
    update public.companies set widget_key = v_other
     where id = 'dd000000-0000-4000-8000-0000000000c1';
    raise exception
      'WV-13 FAILED: two workspaces were allowed the same widget key, which '
      'routes one business''s visitors into another''s inbox';
  exception when unique_violation then
    null;
  end;
  raise notice 'WV-13 PASSED: a widget key belongs to exactly one workspace';
end $$;

-- ===========================================================================
-- WV-14. A widget message threads like any other inbound, without pretending
--        a carrier sent it.
-- ===========================================================================
insert into public.phone_numbers
  (id, company_id, number_e164, status, provisioning_key, country)
values
  ('dd000000-0000-4000-8000-0000000000f1'::uuid,
   'dd000000-0000-4000-8000-0000000000c1'::uuid,
   '+15558881111', 'active', 'widget-test-key', 'US');

do $$
declare
  v jsonb;
  v_msg public.messages%rowtype;
  v_conv public.conversations%rowtype;
begin
  v := public.thread_inbound_message(
    'dd000000-0000-4000-8000-0000000000c1'::uuid,
    'dd000000-0000-4000-8000-0000000000f1'::uuid,
    '+15557770001', 'My boiler is leaking', null,
    null, 200, 200, 'widget', 'widget:verification-1');

  if v->>'message_id' is null then
    raise exception 'WV-14 FAILED: a widget message must thread, got %', v;
  end if;

  select * into v_msg from public.messages where id = (v->>'message_id')::uuid;
  if v_msg.source is distinct from 'widget' then
    raise exception 'WV-14 FAILED: the message must say where it came from';
  end if;
  -- THE WHOLE POINT. No carrier gave us an id, and the column named after the
  -- carrier does not get a made-up one.
  if v_msg.telnyx_message_id is not null then
    raise exception
      'WV-14 FAILED: a widget message carries a telnyx id it was never given';
  end if;
  if v_msg.idempotency_key is distinct from 'widget:verification-1' then
    raise exception 'WV-14 FAILED: our own key must be stored';
  end if;

  select * into v_conv from public.conversations
   where id = (v->>'conversation_id')::uuid;
  if v_conv.first_source is distinct from 'widget' then
    raise exception 'WV-14 FAILED: the conversation must record its first touch';
  end if;

  raise notice 'WV-14 PASSED: a widget message threads without a carrier id';
end $$;

-- ===========================================================================
-- WV-17. The consent is recorded as what it actually was.
--
-- The three kinds are not interchangeable and this is the record that answers
-- a regulator: `inbound_sms` is IMPLIED consent, `attested` is a member's
-- account of a conversation nobody recorded, and a widget opt-in is the only
-- one where the customer's own action is on file — they typed the number and
-- then proved they hold the handset.
--
-- Filing it as `inbound_sms` would be a lie about a legal record, in the
-- direction that flatters us least: express consent downgraded to implied.
-- ===========================================================================
do $$
declare
  v_contact public.contacts%rowtype;
  v_state   text;
  v_source  text;
begin
  select * into v_contact from public.contacts
   where company_id = 'dd000000-0000-4000-8000-0000000000c1'
     and phone_e164 = '+15557770001';

  if v_contact.consent_source::text is distinct from 'widget_form' then
    raise exception
      'WV-17 FAILED: a web-form opt-in was filed as %, not widget_form',
      v_contact.consent_source;
  end if;

  select state, source into v_state, v_source
    from public.contact_consent_events
   where contact_id = v_contact.id
   order by captured_at desc
   limit 1;

  if v_state is distinct from 'express' then
    raise exception
      'WV-17 FAILED: the ledger recorded % consent for a web form, and express '
      'downgraded to implied is the error that matters', v_state;
  end if;
  if v_source is distinct from 'widget_form' then
    raise exception 'WV-17 FAILED: the ledger source reads %', v_source;
  end if;

  raise notice 'WV-17 PASSED: a web-form opt-in is recorded as express, from the widget';
end $$;

-- ===========================================================================
-- WV-15. Pressing submit twice does not open two threads.
--
-- The carrier path dedupes on Telnyx's id. A widget message has none, so the
-- replay check has to key on OURS — and without it a visitor who double-taps
-- gets two conversations and the crew gets two notifications.
-- ===========================================================================
do $$
declare
  first_call jsonb;
  again      jsonb;
begin
  first_call := public.thread_inbound_message(
    'dd000000-0000-4000-8000-0000000000c1'::uuid,
    'dd000000-0000-4000-8000-0000000000f1'::uuid,
    '+15557770002', 'Quote for a re-pipe please', null,
    null, 200, 200, 'widget', 'widget:verification-2');
  again := public.thread_inbound_message(
    'dd000000-0000-4000-8000-0000000000c1'::uuid,
    'dd000000-0000-4000-8000-0000000000f1'::uuid,
    '+15557770002', 'Quote for a re-pipe please', null,
    null, 200, 200, 'widget', 'widget:verification-2');

  if again->>'message_id' is distinct from (first_call->>'message_id') then
    raise exception 'WV-15 FAILED: a replay created a second message';
  end if;
  if (again->>'created')::boolean then
    raise exception 'WV-15 FAILED: a replay reported itself as new';
  end if;

  raise notice 'WV-15 PASSED: a double submit is one thread';
end $$;

-- ===========================================================================
-- WV-16. The carrier path is untouched, and still demands a carrier id.
--
-- The half that makes the change safe: every existing caller passes no source
-- at all and must behave exactly as it did.
-- ===========================================================================
do $$
declare v jsonb;
begin
  begin
    v := public.thread_inbound_message(
      'dd000000-0000-4000-8000-0000000000c1'::uuid,
      'dd000000-0000-4000-8000-0000000000f1'::uuid,
      '+15557770003', 'hello', null);
    raise exception
      'WV-16 FAILED: the default path accepted a message with no carrier id';
  exception when others then
    if sqlerrm not like '%telnyx_message_id is required%' then raise; end if;
  end;

  -- And a carrier message still says it is one, without anybody passing it.
  v := public.thread_inbound_message(
    'dd000000-0000-4000-8000-0000000000c1'::uuid,
    'dd000000-0000-4000-8000-0000000000f1'::uuid,
    '+15557770004', 'hello', 'telnyx-msg-1');
  if (select source from public.messages where id = (v->>'message_id')::uuid)
     is distinct from 'carrier' then
    raise exception 'WV-16 FAILED: an ordinary inbound must default to carrier';
  end if;

  raise notice 'WV-16 PASSED: the carrier path is exactly as it was';
end $$;

-- ===========================================================================
-- WV-10. Nobody but the service role can reach any of it.
-- ===========================================================================
do $$
declare bad text;
begin
  select string_agg(privilege_type, ', ') into bad
    from information_schema.role_table_grants
   where table_schema = 'public'
     and table_name = 'widget_verifications'
     and grantee in ('anon', 'authenticated', 'public');
  if bad is not null then
    raise exception 'WV-10 FAILED: anon/authenticated hold % on the table', bad;
  end if;

  if has_function_privilege('anon', 'public.api_company_for_widget_key(uuid)', 'execute')
     or has_function_privilege('anon', 'public.api_claim_widget_verification(uuid, text, text, text, int, int, int, int)', 'execute')
     or has_function_privilege('authenticated', 'public.api_answer_widget_verification(uuid, text, int)', 'execute')
     or has_function_privilege('anon', 'public.api_prune_widget_verifications(int)', 'execute') then
    raise exception
      'WV-10 FAILED: a public role can execute a widget function. These spend '
      'money and read a stranger''s number; the Worker is the only caller.';
  end if;

  raise notice 'WV-10 PASSED: service role only, table and functions';
end $$;

rollback;
