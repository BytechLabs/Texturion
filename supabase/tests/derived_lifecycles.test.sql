-- ===========================================================================
-- #722: an invite and a workspace move only along their machines.
-- ===========================================================================
begin;

\set co  '\'72200000-0000-4000-8000-000000000201\''
\set own '\'72200000-0000-4000-8000-000000000202\''

insert into auth.users (id, email, encrypted_password, email_confirmed_at,
                        created_at, updated_at, aud, role)
values (:own, 'dl-own@test.local', '', now(), now(), now(), 'authenticated', 'authenticated')
on conflict (id) do nothing;

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at,
   subscription_status, plan)
values (:co, 'Derived Lifecycle Co', :own, 'US', '212', now(), 'active', 'pro');

insert into public.invites (id, company_id, email, role, invited_by)
values ('72200000-0000-4000-8000-000000000203', :co, 'accepted@dl.test', 'member', :own),
       ('72200000-0000-4000-8000-000000000204', :co, 'revoked@dl.test', 'member', :own),
       ('72200000-0000-4000-8000-000000000205', :co, 'expired@dl.test', 'member', :own);

-- ---------------------------------------------------------------------------
-- DL-1. An invite: pending to accepted and to revoked are allowed, and neither
--       comes back. An expired one is re-sent (back to pending).
-- ---------------------------------------------------------------------------
do $$
declare
  v_accepted uuid := '72200000-0000-4000-8000-000000000203';
  v_revoked  uuid := '72200000-0000-4000-8000-000000000204';
  v_expired  uuid := '72200000-0000-4000-8000-000000000205';
begin
  update public.invites set accepted_at = now() where id = v_accepted;
  update public.invites set revoked_at = now() where id = v_revoked;

  begin
    update public.invites set accepted_at = null where id = v_accepted;
    raise exception 'DL-1 FAILED: an accepted invite went back to pending';
  exception when check_violation then null;
  end;
  begin
    update public.invites set revoked_at = null where id = v_revoked;
    raise exception 'DL-1 FAILED: a revoked invite went back to pending';
  exception when check_violation then null;
  end;

  update public.invites set expires_at = now() - interval '1 minute' where id = v_expired;
  update public.invites set expires_at = now() + interval '7 days' where id = v_expired;
  if (select public.invite_state(accepted_at, revoked_at, expires_at, now())
        from public.invites where id = v_expired) is distinct from 'pending' then
    raise exception 'DL-1 FAILED: a re-sent expired invite is not pending';
  end if;

  raise notice 'DL-1 PASSED: an invite moves only along its machine';
end $$;

-- ---------------------------------------------------------------------------
-- DL-2. A workspace: active, paused and closed move between each other as the
--       machine says, only a closed one is purged, and a purged one stays.
-- ---------------------------------------------------------------------------
do $$
declare
  v_co uuid := '72200000-0000-4000-8000-000000000201';
begin
  begin
    update public.companies set purged_at = now() where id = v_co;
    raise exception 'DL-2 FAILED: an active workspace was purged without being closed';
  exception when check_violation then null;
  end;

  update public.companies set paused_at = now() where id = v_co;
  update public.companies set deleted_at = now() where id = v_co;
  -- Reopening a workspace that was paused when it closed brings it back paused.
  update public.companies set deleted_at = null where id = v_co;
  if (select public.workspace_state(paused_at, deleted_at, purged_at)
        from public.companies where id = v_co) is distinct from 'paused' then
    raise exception 'DL-2 FAILED: a reopened paused workspace is not paused';
  end if;

  update public.companies set deleted_at = now() where id = v_co;
  update public.companies set purged_at = now() where id = v_co;
  begin
    update public.companies set purged_at = null, deleted_at = null where id = v_co;
    raise exception 'DL-2 FAILED: a purged workspace came back';
  exception when check_violation then null;
  end;

  raise notice 'DL-2 PASSED: a workspace moves only along its machine';
end $$;

-- ---------------------------------------------------------------------------
-- DL-3. Consent: an inbound text's implied consent never follows express
--       consent or a STOP. The row is skipped, and nothing fails.
-- ---------------------------------------------------------------------------
insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at,
   subscription_status, plan)
values ('72200000-0000-4000-8000-000000000211', 'Consent Lifecycle Co', :own, 'US', '212',
        now(), 'active', 'pro');
insert into public.contacts (id, company_id, phone_e164, name)
values ('72200000-0000-4000-8000-000000000212', '72200000-0000-4000-8000-000000000211',
        '+12125559212', 'Consent Customer');

do $$
declare
  v_co uuid := '72200000-0000-4000-8000-000000000211';
  v_ct uuid := '72200000-0000-4000-8000-000000000212';
  v_phone text := '+12125559212';
  v_implied int;
begin
  insert into public.contact_consent_events (company_id, contact_id, phone_e164, state, source)
  values (v_co, v_ct, v_phone, 'express', 'attested');
  insert into public.contact_consent_events (company_id, contact_id, phone_e164, state, source)
  values (v_co, v_ct, v_phone, 'implied', 'inbound_sms');
  select count(*) into v_implied from public.contact_consent_events
   where company_id = v_co and phone_e164 = v_phone and state = 'implied';
  if v_implied is distinct from 0 then
    raise exception 'DL-3 FAILED: implied consent was recorded after express consent';
  end if;

  insert into public.contact_consent_events (company_id, contact_id, phone_e164, state, source)
  values (v_co, v_ct, v_phone, 'revoked', 'stop_keyword');
  insert into public.contact_consent_events (company_id, contact_id, phone_e164, state, source)
  values (v_co, v_ct, v_phone, 'implied', 'inbound_sms');
  select count(*) into v_implied from public.contact_consent_events
   where company_id = v_co and phone_e164 = v_phone and state = 'implied';
  if v_implied is distinct from 0 then
    raise exception 'DL-3 FAILED: implied consent was recorded after a STOP';
  end if;

  raise notice 'DL-3 PASSED: implied consent never follows express consent or a STOP';
end $$;

rollback;
