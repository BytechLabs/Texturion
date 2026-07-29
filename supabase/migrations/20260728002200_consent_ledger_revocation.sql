-- ===========================================================================
-- [#226] The revocation half of the consent ledger.
--
-- 20260728002100 records how consent was ESTABLISHED, by triggering on the
-- `contacts.consent_at` transition. Revocation never touches that column — a
-- STOP writes to `opt_outs`, keyed on the phone number rather than the contact
-- — so the ledger held opt-in and stopped exactly where #226 says the existing
-- system was already strong.
--
-- That leaves the timeline half-told, and the half it omits is the one a
-- demand letter is usually about: *"they told you to stop on the 3rd and you
-- texted them on the 9th"*. The ledger has to be able to answer that with a
-- row, not with a join somebody remembers to write.
--
-- SAME DESIGN AS THE OPT-IN HALF, for the same reason. `opt_outs` has FOUR
-- writers today — the inbound STOP/START handler, the manual route, the
-- carrier reconcile, and CSV import — and a recorder called from each is one
-- somebody forgets when they add a fifth. The trigger fires on the state
-- change itself, so the ledger cannot be forgotten by a writer who has never
-- heard of it.
--
-- OPT-OUT REMAINS CARRIER TRUTH AND IS UNCHANGED. This only observes; the gate
-- in `runPreSendGates` keeps reading `opt_outs` exactly as before, and nothing
-- here can lift a STOP. The binding rule that only the customer can do that is
-- untouched.
-- ===========================================================================

create or replace function public.opt_outs_record_consent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contact_id uuid;
  v_revoking   boolean;
begin
  -- A revocation is: a new active row, or an existing one becoming active
  -- again. A re-consent is: an active row being revoked (START/undo).
  if tg_op = 'INSERT' then
    v_revoking := new.revoked_at is null;
  else
    if (old.revoked_at is null) = (new.revoked_at is null) then
      return new;   -- some other column moved; nothing about consent changed
    end if;
    v_revoking := new.revoked_at is null;
  end if;

  -- The ledger is per CONTACT and opt_outs is per PHONE. A STOP from a number
  -- we have no contact for is still honoured by the gate — it simply has no
  -- ledger row, because there is no person to record it against.
  select ct.id into v_contact_id
    from public.contacts ct
   where ct.company_id = new.company_id
     and ct.phone_e164 = new.phone_e164
   limit 1;
  if v_contact_id is null then
    return new;
  end if;

  insert into public.contact_consent_events
    (company_id, contact_id, state, source, captured_by, captured_at, evidence)
  values (
    new.company_id,
    v_contact_id,
    case when v_revoking then 'revoked' else 'express' end,
    case
      when v_revoking then new.source::text
      -- Coming back from a revocation. A customer texting START is the only
      -- way that happens on its own; anything else was a member undoing a
      -- record they made, which is `manual`.
      when new.source::text = 'stop_keyword' then 'start_keyword'
      else 'manual'
    end,
    new.created_by,
    coalesce(case when v_revoking then new.created_at else new.revoked_at end, now()),
    jsonb_build_object(
      'phone_e164', new.phone_e164,
      'opt_out_id', new.id,
      'opt_out_source', new.source::text)
  );
  return new;
end $$;

drop trigger if exists opt_outs_consent_ledger on public.opt_outs;
create trigger opt_outs_consent_ledger
  after insert or update of revoked_at on public.opt_outs
  for each row execute function public.opt_outs_record_consent();

-- ---------------------------------------------------------------------------
-- The evidence file (#226 acceptance: "one click, per company, produces the
-- evidence file a lawyer or carrier would ask for").
--
-- Joined to the contact so the export names a PERSON rather than a row of
-- foreign keys — the reader is a lawyer or a carrier reviewer, not us.
-- Ordered oldest-first per contact, because the question being answered is
-- "what happened, in what order".
-- ---------------------------------------------------------------------------
create or replace function public.api_consent_evidence(p_company_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.phone_e164, t.captured_at), '[]'::jsonb)
    from (
      select ct.phone_e164,
             ct.name,
             e.state,
             e.source,
             e.captured_at,
             e.captured_by,
             e.evidence
        from public.contact_consent_events e
        join public.contacts ct on ct.id = e.contact_id
       where e.company_id = p_company_id
    ) t
$$;

revoke execute on function public.api_consent_evidence(uuid)
  from public, anon, authenticated;
grant execute on function public.api_consent_evidence(uuid) to service_role;
