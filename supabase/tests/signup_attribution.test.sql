-- [#296] The attribution report cannot flatter a page.
--
-- The rate this function prints is meant to decide whether more competitor
-- pages get built. Three ways it could lie, each pinned below: it could count a
-- signup as activated on the strength of a reply nobody ever prompted; it could
-- rank a page off four data points; or it could quietly drop the workspaces it
-- has no landing page for, which would make the pages it DOES know about look
-- like they account for all growth.
--
-- One transaction, rolled back. Fixtures use a '6a' id prefix.

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values
  ('6a000000-0000-4000-8000-00000000000a'::uuid, 'attrib-owner@test.local');

-- Two attributed pages and one workspace with no touch at all.
--
-- /for/plumbers: 2 signups, 1 activated (sent + replied).
-- /compare:      1 signup,  0 activated (replied, but never sent — a reply
--                without an outbound message is not activation, and the
--                column alone would say it was).
-- unattributed:  1 signup,  0 activated.
insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at,
   signup_landing_path, signup_first_touch, first_inbound_reply_at)
values
  ('6a000000-0000-4000-8000-0000000000c1'::uuid, 'Plumb A',
   '6a000000-0000-4000-8000-00000000000a'::uuid, 'CA', '416', now(),
   '/for/plumbers',
   '{"referrer_host": "www.google.com", "params": {"utm_source": "google"}}'::jsonb,
   now() - interval '2 days'),
  ('6a000000-0000-4000-8000-0000000000c2'::uuid, 'Plumb B',
   '6a000000-0000-4000-8000-00000000000a'::uuid, 'CA', '416', now(),
   '/for/plumbers', null, null),
  ('6a000000-0000-4000-8000-0000000000c3'::uuid, 'Compare Co',
   '6a000000-0000-4000-8000-00000000000a'::uuid, 'CA', '416', now(),
   '/compare',
   '{"referrer_host": "duckduckgo.com", "params": {}}'::jsonb,
   now() - interval '1 day'),
  ('6a000000-0000-4000-8000-0000000000c4'::uuid, 'No Touch Co',
   '6a000000-0000-4000-8000-00000000000a'::uuid, 'CA', '416', now(),
   null, null, null);

-- Only Plumb A ever sent anything that reached the carrier. Compare Co's send
-- is deliberately a DRAFT (no telnyx id) — the message row exists, but it never
-- left, which is exactly what a naive `exists (select from messages)` would
-- score as activation.
create or replace function pg_temp.seed_send(
  p_company uuid, p_telnyx_id text
) returns void language plpgsql as $$
declare
  v_num uuid;
  v_contact uuid;
  v_conv uuid;
begin
  insert into public.phone_numbers
    (company_id, provisioning_key, country, number_e164, status)
  values (p_company, 'attrib-' || p_company::text, 'CA',
          '+1416555' || lpad((random() * 8999 + 1000)::int::text, 4, '0'),
          'active')
  returning id into v_num;

  insert into public.contacts (company_id, phone_e164)
  values (p_company, '+1416555' || lpad((random() * 8999 + 1000)::int::text, 4, '0'))
  returning id into v_contact;

  insert into public.conversations
    (company_id, contact_id, phone_number_id, status, last_message_at)
  values (p_company, v_contact, v_num, 'open', now())
  returning id into v_conv;

  -- messages_outbound_actor: an outbound row must name a sender. The owner
  -- stands in.
  insert into public.messages
    (company_id, conversation_id, direction, body, status, telnyx_message_id,
     sent_by_user_id)
  values (p_company, v_conv, 'outbound', 'on my way',
          (case when p_telnyx_id is null then 'queued' else 'delivered' end)::public.message_status,
          p_telnyx_id,
          '6a000000-0000-4000-8000-00000000000a'::uuid);
end $$;

select pg_temp.seed_send('6a000000-0000-4000-8000-0000000000c1'::uuid, 'msg-real-1');
select pg_temp.seed_send('6a000000-0000-4000-8000-0000000000c3'::uuid, null);

-- ---------------------------------------------------------------------------
-- SA-1. Activation needs BOTH halves of D12: an outbound message that actually
--       reached Telnyx, and a reply. Either one alone is not activation.
do $$
declare
  v_plumbers record;
  v_compare record;
begin
  select * into v_plumbers
    from public.api_signup_attribution(90, 1)
   where landing_path = '/for/plumbers';
  select * into v_compare
    from public.api_signup_attribution(90, 1)
   where landing_path = '/compare';

  if v_plumbers.signups is distinct from 2 or v_plumbers.activated is distinct from 1 then
    raise exception 'SA-1 FAILED: /for/plumbers reported % signups / % activated, '
      'expected 2 / 1.', v_plumbers.signups, v_plumbers.activated;
  end if;

  if v_compare.activated is distinct from 0 then
    raise exception 'SA-1 FAILED: /compare counted % activation(s). Its only '
      'outbound message was a draft that never reached the carrier — counting '
      'it would mean a page scores for customers who never texted anyone.',
      v_compare.activated;
  end if;

  if v_plumbers.activation_rate is distinct from 0.5000 then
    raise exception 'SA-1 FAILED: /for/plumbers rate was %, expected 0.5000.',
      v_plumbers.activation_rate;
  end if;

  raise notice 'SA-1 PASSED: activation needs a sent message AND a reply';
end $$;

-- ---------------------------------------------------------------------------
-- SA-2. Workspaces with no recorded touch are REPORTED, not dropped. Silently
--       omitting them would make the known pages look like all of growth.
do $$
declare
  v_row record;
begin
  select * into v_row
    from public.api_signup_attribution(90, 1)
   where landing_path = '(unattributed)';

  if v_row is null then
    raise exception 'SA-2 FAILED: the workspace with no landing page vanished '
      'from the report. Coverage has to be visible on the same screen as the '
      'conclusion, or the attributed pages read as 100%% of growth.';
  end if;
  if v_row.signups is distinct from 1 then
    raise exception 'SA-2 FAILED: expected 1 unattributed signup, got %.',
      v_row.signups;
  end if;

  raise notice 'SA-2 PASSED: unattributed signups are reported as their own row';
end $$;

-- ---------------------------------------------------------------------------
-- SA-3. The small-cohort floor marks rows that cannot carry a decision. #327:
--       at this base size a 2-signup page reads as a winner.
do $$
declare
  v_small int;
  v_large int;
begin
  select count(*) into v_small
    from public.api_signup_attribution(90, 10)
   where not is_small;

  if v_small is distinct from 0 then
    raise exception 'SA-3 FAILED: % row(s) cleared a floor of 10 on fixtures '
      'that top out at 2 signups. Ranking those is the decision the floor '
      'exists to prevent.', v_small;
  end if;

  -- ...and the flag is a floor, not a permanent gag: drop it and rows rank.
  select count(*) into v_large
    from public.api_signup_attribution(90, 1)
   where not is_small;

  if v_large = 0 then
    raise exception 'SA-3 FAILED: nothing is rankable even at a floor of 1, so '
      'is_small is stuck on and no page could ever be judged.';
  end if;

  raise notice 'SA-3 PASSED: the cohort floor gates ranking and releases it';
end $$;

-- ---------------------------------------------------------------------------
-- SA-4. The window is honoured, and a deleted workspace does not haunt it.
do $$
declare
  v_rows int;
begin
  update public.companies
     set created_at = now() - interval '200 days'
   where id = '6a000000-0000-4000-8000-0000000000c2'::uuid;

  select signups into v_rows
    from public.api_signup_attribution(90, 1)
   where landing_path = '/for/plumbers';

  if v_rows is distinct from 1 then
    raise exception 'SA-4 FAILED: /for/plumbers reported % signups inside a '
      '90-day window holding one. A page is judged on what it produced '
      'recently, not on everything it ever produced.', v_rows;
  end if;

  update public.companies
     set deleted_at = now()
   where id = '6a000000-0000-4000-8000-0000000000c1'::uuid;

  select count(*) into v_rows
    from public.api_signup_attribution(90, 1)
   where landing_path = '/for/plumbers';

  if v_rows is distinct from 0 then
    raise exception 'SA-4 FAILED: a deleted workspace is still being credited '
      'to the page that produced it.';
  end if;

  raise notice 'SA-4 PASSED: the window and deletion both apply';
end $$;

-- ---------------------------------------------------------------------------
-- SA-5. The function is reachable by the service role only. It reads every
--       workspace in the database across tenants, which is exactly why it must
--       not be callable by a signed-in customer.
do $$
begin
  if has_function_privilege('authenticated', 'public.api_signup_attribution(int, int)', 'execute')
     or has_function_privilege('anon', 'public.api_signup_attribution(int, int)', 'execute')
  then
    raise exception 'SA-5 FAILED: a customer session can call the cross-tenant '
      'attribution report.';
  end if;

  if not has_function_privilege('service_role', 'public.api_signup_attribution(int, int)', 'execute') then
    raise exception 'SA-5 FAILED: service_role cannot execute the report it is '
      'the only caller of.';
  end if;

  raise notice 'SA-5 PASSED: service_role only';
end $$;

rollback;
