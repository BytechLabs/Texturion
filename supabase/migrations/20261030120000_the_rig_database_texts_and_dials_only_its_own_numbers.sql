-- D142: on the rig's database, a text, an outbound call claim and a
-- greeting-capture call can only go to one of the partition's own numbers.
--
-- The app (`src/environments/policy.ts`) and the guard in front of Telnyx
-- refuse these destinations first. This layer holds when they are wrong: a
-- send site that forgot to ask the app's gate still writes its row through here.
--
-- INERT EVERYWHERE BUT THE RIG. Only the rig's local database sets
-- `loonext.deploy_env` (`alter database postgres set loonext.deploy_env =
-- 'rig'`). Where it is unset, as in production, nothing is refused and every
-- write behaves as if the gate were absent; rig_destination_gate.test.sql
-- proves it with production's setting.
--
-- WHY TRIGGERS ON THE ROWS, NOT EDITS TO THE FUNCTIONS. Each destination is
-- written as one row: an outbound `messages` row (`gate_outbound_send`), an
-- `outbound_call_authorizations` row (`api_claim_outbound_line`), and the
-- greeting-capture route's `audit_log` row, which is that call's daily ceiling
-- (the route refuses to dial when the write fails). Gating the row also covers
-- every other writer of it (away replies, missed-call text-back, retries) and
-- every later redefinition of those functions, none of which has to carry the
-- check forward.
--
-- WHAT AN ENDPOINT IS. `loonext.rig_endpoints`, a comma- or space-separated
-- list of E.164 numbers set beside `loonext.deploy_env` from the same live
-- guard listing that fills the app's RIG_OWNED_E164. Unset on the rig means
-- every destination is refused, never every destination allowed.
--
-- THE ONE WAY THIS FAILS OPEN. A rig database that lost `loonext.deploy_env`
-- has silently lost this layer: `supabase db reset` forgets ALTER DATABASE
-- settings, and a pooled connection opened before the setting never sees it.
-- The rig's API asks `rig_database_posture()` what its connections see rather
-- than assuming.

-- An entry that is not E.164 is dropped, so a typo can only shrink the list.
create or replace function public.rig_endpoint_numbers()
returns text[]
language sql
stable
set search_path = ''
as $$
  select coalesce(array_agg(t.entry), '{}'::text[])
    from unnest(
           regexp_split_to_array(
             btrim(coalesce(current_setting('loonext.rig_endpoints', true), '')),
             '[[:space:],]+'
           )
         ) as t(entry)
   where t.entry ~ '^\+[1-9][0-9]{7,14}$';
$$;

create or replace function public.rig_destination_refused(p_destination text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(current_setting('loonext.deploy_env', true), '') = 'rig'
     and not coalesce(
       btrim(p_destination) ~ '^\+[1-9][0-9]{7,14}$'
       and btrim(p_destination) = any (public.rig_endpoint_numbers()),
       false
     );
$$;

comment on function public.rig_destination_refused(text) is
  'D142: true only on the rig''s database (loonext.deploy_env = rig) for a '
  'destination outside loonext.rig_endpoints. False everywhere else.';

-- The rig's start-up check refuses to serve unless this answers "rig" with at
-- least one endpoint. Nothing reads it in production.
create or replace function public.rig_database_posture()
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'deploy_env', coalesce(current_setting('loonext.deploy_env', true), ''),
    'endpoints', cardinality(public.rig_endpoint_numbers()));
$$;

comment on function public.rig_database_posture() is
  'D142: the destination gate''s settings as this connection sees them: '
  'deploy_env and the number of usable rig endpoints.';

revoke execute on function public.rig_endpoint_numbers()
  from public, anon, authenticated;
grant execute on function public.rig_endpoint_numbers() to service_role;
revoke execute on function public.rig_destination_refused(text)
  from public, anon, authenticated;
grant execute on function public.rig_destination_refused(text) to service_role;
revoke execute on function public.rig_database_posture()
  from public, anon, authenticated;
grant execute on function public.rig_database_posture() to service_role;

-- The message's destination is the thread's number, which is what the Worker
-- hands Telnyx as `to`, falling back to the contact's primary the same way the
-- conversations trigger fills it. A retry flips a failed row back to queued,
-- and that is a send too.
create or replace function public.rig_gate_outbound_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_destination text;
begin
  if coalesce(current_setting('loonext.deploy_env', true), '') is distinct from 'rig' then
    return new;
  end if;
  if new.direction is distinct from 'outbound' then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and (new.status is distinct from 'queued'
          or old.status is not distinct from 'queued') then
    return new;
  end if;

  select coalesce(conv.contact_phone_e164, ct.phone_e164)
    into v_destination
    from public.conversations conv
    left join public.contacts ct on ct.id = conv.contact_id
   where conv.id = new.conversation_id;

  if public.rig_destination_refused(v_destination) then
    raise exception 'rig_destination_refused: outbound text to a number outside loonext.rig_endpoints'
      using hint = 'Only the partition''s own numbers can be texted from the rig.';
  end if;
  return new;
end $$;

create or replace function public.rig_gate_outbound_line()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.rig_destination_refused(new.customer_e164) then
    raise exception 'rig_destination_refused: outbound call to a number outside loonext.rig_endpoints'
      using hint = 'Only the partition''s own numbers can be dialed from the rig.';
  end if;
  return new;
end $$;

-- `after.to` is the number the capture route is about to ring. A row without
-- one cannot be checked, so on the rig it is refused like any other stranger.
create or replace function public.rig_gate_greeting_capture()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.rig_destination_refused(new.after ->> 'to') then
    raise exception 'rig_destination_refused: greeting-capture call to a number outside loonext.rig_endpoints'
      using hint = 'Only the partition''s own numbers can be rung from the rig.';
  end if;
  return new;
end $$;

revoke execute on function public.rig_gate_outbound_message()
  from public, anon, authenticated;
revoke execute on function public.rig_gate_outbound_line()
  from public, anon, authenticated;
revoke execute on function public.rig_gate_greeting_capture()
  from public, anon, authenticated;

create trigger rig_gate_outbound_message
  before insert or update of status on public.messages
  for each row execute function public.rig_gate_outbound_message();

create trigger rig_gate_outbound_line
  before insert on public.outbound_call_authorizations
  for each row execute function public.rig_gate_outbound_line();

-- The action literal is GREETING_CAPTURE_AUDIT_ACTION in
-- apps/api/src/calls/greeting-capture.ts.
create trigger rig_gate_greeting_capture
  before insert on public.audit_log
  for each row
  when (new.action = 'voicemail_greeting.capture_call')
  execute function public.rig_gate_greeting_capture();
