-- ===========================================================================
-- [#332] Ownership can move.
--
-- SPEC §10 says the owner row cannot be deactivated or demoted, and that is a
-- good property: it stops an admin locking out the person who pays, and it
-- guarantees somebody is always accountable. What it did NOT come with was a
-- way to move the role deliberately — so a safety property became a single
-- point of failure at the human level. A two-person plumbing company whose
-- founder has a heart attack still has customers texting the business line,
-- and the surviving partner is an admin who cannot lift the spending cap that
-- has stopped their texting, cannot manage numbers, and cannot be promoted.
-- The only fix available was a hand-written UPDATE against production.
--
-- ---------------------------------------------------------------------------
-- WHAT SHIPS HERE, AND WHY NOT MORE
--
-- The issue makes the argument against itself better than a summary can: every
-- account-recovery mechanism is an attack surface, and this one guards the
-- role that controls spending and phone numbers. A weak procedure is WORSE
-- than none, because it converts "call the founder" — slow, manual, and
-- actually quite secure — into something attackable at scale.
--
-- So two paths ship, and both start from a decision the OWNER made while
-- authenticated:
--
--   1. TRANSFER — the owner offers ownership to a member, the member accepts.
--      Two-sided, because a business is not something you can be handed
--      without agreeing to hold it. Covers sale, retirement, succession.
--
--   2. CLAIM BY THE NAMED BACKUP — the owner nominates a backup owner in
--      advance. If the owner is later unreachable, THAT PERSON AND ONLY THAT
--      PERSON can start a claim, everybody is told immediately, and it
--      completes only after a waiting period during which the owner can kill
--      it with one click.
--
-- (2) is the whole trick. It is not a recovery bypass — the person who can
-- take over is one the owner chose, and the owner keeps an instant veto — but
-- it converts the hard problem ("prove you should have this stranger's
-- business") into the easy one ("the person you named is asking, and you have
-- a week to say no"). The unreachable-owner-with-no-backup case stays
-- human-in-the-loop on purpose; the procedure is written down in
-- docs/OWNERSHIP.md rather than coded.
--
-- What is deliberately NOT possible: an admin seizing the role, a workspace
-- ending up with nobody accountable, and a transfer nobody was told about.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- The invariant that was missing.
--
-- Ownership lived in two places — `companies.owner_user_id` and the
-- `company_members` row with role 'owner' — and nothing tied them together.
-- Two owner rows for one company was expressible, and so was a company whose
-- owner_user_id pointed at somebody with no membership at all. Any transfer
-- that touched one and not the other would have been silent.
--
-- Both halves now have teeth: this index makes a second owner row impossible,
-- and `api_ownership_integrity()` at the bottom is the assertion that the two
-- places still agree.
-- ---------------------------------------------------------------------------
create unique index if not exists company_members_one_owner_uq
  on public.company_members (company_id) where role = 'owner';

-- ---------------------------------------------------------------------------
-- The nominated backup.
--
-- Null is the norm and stays the norm — this is an invitation, not a
-- requirement. `on delete set null`: if the backup deletes their account the
-- nomination simply lapses, and the owner is told (the API notices a
-- nomination that no longer resolves and prompts again).
-- ---------------------------------------------------------------------------
alter table public.companies
  add column if not exists backup_owner_user_id uuid
    references auth.users(id) on delete set null;

comment on column public.companies.backup_owner_user_id is
  '#332: the member the owner named to take over if they cannot act. The ONLY person who may start an ownership claim.';

-- ---------------------------------------------------------------------------
-- One row per attempt to move ownership, of either kind.
--
-- Both kinds live in one table because they end the same way (the same swap,
-- the same audit row, the same notification to everybody) and because "is
-- anything in flight against this workspace right now" has to be one question
-- with one answer — hence the partial unique index below.
-- ---------------------------------------------------------------------------
create table if not exists public.ownership_transfers (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete restrict,
  -- 'offer': the owner is handing it over, and the recipient must accept.
  -- 'claim': the named backup is taking it, and the owner may veto.
  kind         text not null check (kind in ('offer', 'claim')),
  from_user_id uuid not null references auth.users(id) on delete restrict,
  to_user_id   uuid not null references auth.users(id) on delete restrict,
  initiated_by uuid not null references auth.users(id) on delete restrict,
  -- An offer cannot be accepted after this; a claim cannot complete BEFORE
  -- it. One column, opposite meanings, because it is the same fact: the
  -- moment this stops being the recipient's move.
  ripens_at    timestamptz not null,
  expires_at   timestamptz not null,
  accepted_at  timestamptz,
  declined_at  timestamptz,
  canceled_at  timestamptz,
  canceled_by  uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now()
);

comment on table public.ownership_transfers is
  '#332: ownership handovers in flight, and the record of every one that finished. At most one open per company.';

-- At most one open handover per workspace. Without this, an owner and their
-- backup could have competing paperwork against the same business, and the
-- one that landed would be a race.
create unique index if not exists ownership_transfers_open_uq
  on public.ownership_transfers (company_id)
  where accepted_at is null and declined_at is null and canceled_at is null;

create index if not exists ownership_transfers_company_idx
  on public.ownership_transfers (company_id, created_at desc);

alter table public.ownership_transfers enable row level security;

-- ---------------------------------------------------------------------------
-- How long each half waits, in one place so the copy on three clients and the
-- policy doc cannot drift from the code.
--
-- OFFER: 7 days, matching invites. Somebody being handed a business will
-- either say yes this week or the offer should be made again deliberately.
--
-- CLAIM: 7 days, and this one is a judgement call worth stating. Too short and
-- an owner on a two-week holiday loses their business to a disgruntled
-- backup; too long and a grieving family waits a month to answer their own
-- customers. Seven days is one full billing cycle of nobody answering the
-- phone, which is about as long as a real business can stand — and the owner
-- is emailed at the start, at the halfway point, and at completion, so silence
-- for a week is a strong signal rather than a missed message.
-- ---------------------------------------------------------------------------
create or replace function public.ownership_offer_window() returns interval
language sql immutable as $$ select interval '7 days' $$;

create or replace function public.ownership_claim_window() returns interval
language sql immutable as $$ select interval '7 days' $$;

-- ---------------------------------------------------------------------------
-- The swap itself. Every path ends here, and nothing else may write
-- `owner_user_id`.
--
-- Order matters and is not cosmetic: the outgoing owner is demoted to admin
-- FIRST, because `company_members_one_owner_uq` is checked at the end of each
-- statement and a promote-then-demote would trip it. The outgoing owner
-- becomes an admin rather than being removed — they still work here, they
-- simply no longer hold the powers that come with paying.
-- ---------------------------------------------------------------------------
create or replace function public.apply_ownership(
  p_company_id uuid,
  p_new_owner  uuid
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old uuid;
begin
  select c.owner_user_id into v_old
    from public.companies c
   where c.id = p_company_id
     for update;
  if not found then
    raise exception 'apply_ownership: no such company %', p_company_id;
  end if;

  if not exists (
    select 1 from public.company_members m
     where m.company_id = p_company_id
       and m.user_id = p_new_owner
       and m.deactivated_at is null
  ) then
    raise exception 'apply_ownership: % is not an active member', p_new_owner;
  end if;

  update public.company_members m
     set role = 'admin', updated_at = now()
   where m.company_id = p_company_id and m.user_id = v_old and m.role = 'owner';

  update public.company_members m
     set role = 'owner', deactivated_at = null, updated_at = now()
   where m.company_id = p_company_id and m.user_id = p_new_owner;

  update public.companies c
     set owner_user_id = p_new_owner,
         -- The nomination does not survive its own use: the new owner names
         -- their own backup, and leaving the old one in place would silently
         -- hand a stranger a standing claim on a business that changed hands.
         backup_owner_user_id = null,
         updated_at = now()
   where c.id = p_company_id;
end $$;

revoke execute on function public.apply_ownership(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.apply_ownership(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Name (or clear) the backup owner. Owner only.
--
-- Refuses anybody who is not an active member, and refuses the owner
-- themselves — a backup who is you is not a backup, it is a spelling of
-- "none" that would read as covered on the settings screen.
-- ---------------------------------------------------------------------------
create or replace function public.api_set_backup_owner(
  p_company_id uuid,
  p_actor      uuid,
  p_member_id  uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_user  uuid;
begin
  select c.owner_user_id into v_owner from public.companies c where c.id = p_company_id;
  if v_owner is null then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  if v_owner <> p_actor then
    return jsonb_build_object('outcome', 'forbidden');
  end if;

  if p_member_id is null then
    update public.companies set backup_owner_user_id = null, updated_at = now()
     where id = p_company_id;
    return jsonb_build_object('outcome', 'cleared');
  end if;

  select m.user_id into v_user
    from public.company_members m
   where m.id = p_member_id
     and m.company_id = p_company_id
     and m.deactivated_at is null;
  if v_user is null then
    return jsonb_build_object('outcome', 'no_member');
  end if;
  if v_user = v_owner then
    return jsonb_build_object('outcome', 'self');
  end if;

  update public.companies set backup_owner_user_id = v_user, updated_at = now()
   where id = p_company_id;
  return jsonb_build_object('outcome', 'set', 'user_id', v_user);
end $$;

revoke execute on function public.api_set_backup_owner(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.api_set_backup_owner(uuid, uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- The owner offers ownership to a member.
--
-- Nothing changes yet. The offer is paperwork until the recipient accepts,
-- which is the point: a business is not something a person can be handed
-- without agreeing to hold it, and a silent reassignment would be
-- indistinguishable from a takeover to everyone else in the workspace.
-- ---------------------------------------------------------------------------
create or replace function public.api_offer_ownership(
  p_company_id uuid,
  p_actor      uuid,
  p_member_id  uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_user  uuid;
  v_row   public.ownership_transfers;
begin
  select c.owner_user_id into v_owner from public.companies c where c.id = p_company_id;
  if v_owner is null then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  if v_owner <> p_actor then
    return jsonb_build_object('outcome', 'forbidden');
  end if;

  select m.user_id into v_user
    from public.company_members m
   where m.id = p_member_id
     and m.company_id = p_company_id
     and m.deactivated_at is null;
  if v_user is null then
    return jsonb_build_object('outcome', 'no_member');
  end if;
  if v_user = v_owner then
    return jsonb_build_object('outcome', 'self');
  end if;

  if exists (
    select 1 from public.ownership_transfers t
     where t.company_id = p_company_id
       and t.accepted_at is null and t.declined_at is null and t.canceled_at is null
  ) then
    return jsonb_build_object('outcome', 'in_flight');
  end if;

  insert into public.ownership_transfers
    (company_id, kind, from_user_id, to_user_id, initiated_by, ripens_at, expires_at)
  values
    (p_company_id, 'offer', v_owner, v_user, p_actor,
     now(), now() + public.ownership_offer_window())
  returning * into v_row;

  return jsonb_build_object(
    'outcome', 'offered',
    'transfer_id', v_row.id,
    'to_user_id', v_user,
    'expires_at', v_row.expires_at
  );
end $$;

revoke execute on function public.api_offer_ownership(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.api_offer_ownership(uuid, uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- The named backup starts a claim.
--
-- The gate is narrow on purpose: ONLY the user sitting in
-- `backup_owner_user_id`, a slot only the owner can fill. An admin cannot do
-- this, a member cannot do this, and somebody who was the backup before the
-- last handover cannot do this (apply_ownership clears the nomination).
--
-- Nothing moves today. The row ripens in a week, the owner is emailed now and
-- can cancel it with one click for the whole of that week, and every member is
-- told at the start rather than at the end.
-- ---------------------------------------------------------------------------
create or replace function public.api_claim_ownership(
  p_company_id uuid,
  p_actor      uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner  uuid;
  v_backup uuid;
  v_row    public.ownership_transfers;
begin
  select c.owner_user_id, c.backup_owner_user_id into v_owner, v_backup
    from public.companies c where c.id = p_company_id;
  if v_owner is null then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  if v_backup is null or v_backup <> p_actor then
    return jsonb_build_object('outcome', 'forbidden');
  end if;
  if not exists (
    select 1 from public.company_members m
     where m.company_id = p_company_id and m.user_id = p_actor
       and m.deactivated_at is null
  ) then
    return jsonb_build_object('outcome', 'forbidden');
  end if;

  if exists (
    select 1 from public.ownership_transfers t
     where t.company_id = p_company_id
       and t.accepted_at is null and t.declined_at is null and t.canceled_at is null
  ) then
    return jsonb_build_object('outcome', 'in_flight');
  end if;

  insert into public.ownership_transfers
    (company_id, kind, from_user_id, to_user_id, initiated_by, ripens_at, expires_at)
  values
    (p_company_id, 'claim', v_owner, p_actor, p_actor,
     now() + public.ownership_claim_window(),
     -- A ripe claim does not rot: the window is the wait, not a deadline to
     -- act. Somebody dealing with a death should not lose their place because
     -- they were busy for a fortnight afterwards.
     now() + public.ownership_claim_window() + interval '365 days')
  returning * into v_row;

  return jsonb_build_object(
    'outcome', 'claimed',
    'transfer_id', v_row.id,
    'ripens_at', v_row.ripens_at
  );
end $$;

revoke execute on function public.api_claim_ownership(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.api_claim_ownership(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- The recipient's move: accept an offer, or complete a ripe claim.
--
-- One function because it is one act from the recipient's side — "yes, I will
-- take this" — and because both must run the same swap under the same lock.
-- ---------------------------------------------------------------------------
create or replace function public.api_accept_ownership(
  p_company_id uuid,
  p_actor      uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.ownership_transfers;
begin
  select * into v_row
    from public.ownership_transfers t
   where t.company_id = p_company_id
     and t.accepted_at is null and t.declined_at is null and t.canceled_at is null
   for update;
  if not found then
    return jsonb_build_object('outcome', 'none');
  end if;
  if v_row.to_user_id <> p_actor then
    return jsonb_build_object('outcome', 'forbidden');
  end if;
  if now() >= v_row.expires_at then
    return jsonb_build_object('outcome', 'expired');
  end if;
  if now() < v_row.ripens_at then
    -- A claim still inside its waiting period. Not an error the recipient did
    -- anything wrong — it is simply not their turn yet.
    return jsonb_build_object('outcome', 'not_yet', 'ripens_at', v_row.ripens_at);
  end if;
  if not exists (
    select 1 from public.company_members m
     where m.company_id = p_company_id and m.user_id = p_actor
       and m.deactivated_at is null
  ) then
    -- Removed between the offer and the answer. A workspace must never end up
    -- owned by somebody who is not in it.
    return jsonb_build_object('outcome', 'no_member');
  end if;

  perform public.apply_ownership(p_company_id, p_actor);

  update public.ownership_transfers t
     set accepted_at = now()
   where t.id = v_row.id;

  return jsonb_build_object(
    'outcome', 'accepted',
    'kind', v_row.kind,
    'from_user_id', v_row.from_user_id,
    'transfer_id', v_row.id
  );
end $$;

revoke execute on function public.api_accept_ownership(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.api_accept_ownership(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Calling it off. Three people may, and each for their own reason:
--
--   the OWNER      — cancels an offer they made, or VETOES a claim against
--                    them. This is the whole safety mechanism of the claim
--                    path, so it works at any moment right up to completion.
--   the RECIPIENT  — declines an offer, or abandons a claim they started.
--   nobody else.
--
-- An admin who is not party to it cannot touch it. That is deliberate: an
-- admin able to cancel a claim could keep a dead owner's workspace frozen
-- forever.
-- ---------------------------------------------------------------------------
create or replace function public.api_cancel_ownership_transfer(
  p_company_id uuid,
  p_actor      uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row   public.ownership_transfers;
  v_owner uuid;
begin
  select c.owner_user_id into v_owner from public.companies c where c.id = p_company_id;

  select * into v_row
    from public.ownership_transfers t
   where t.company_id = p_company_id
     and t.accepted_at is null and t.declined_at is null and t.canceled_at is null
   for update;
  if not found then
    return jsonb_build_object('outcome', 'none');
  end if;
  if p_actor <> v_owner and p_actor <> v_row.to_user_id then
    return jsonb_build_object('outcome', 'forbidden');
  end if;

  if p_actor = v_row.to_user_id and p_actor <> v_owner then
    update public.ownership_transfers set declined_at = now() where id = v_row.id;
    return jsonb_build_object('outcome', 'declined', 'kind', v_row.kind,
                              'transfer_id', v_row.id, 'to_user_id', v_row.to_user_id);
  end if;

  update public.ownership_transfers
     set canceled_at = now(), canceled_by = p_actor
   where id = v_row.id;
  return jsonb_build_object('outcome', 'canceled', 'kind', v_row.kind,
                            'transfer_id', v_row.id, 'to_user_id', v_row.to_user_id);
end $$;

revoke execute on function public.api_cancel_ownership_transfer(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.api_cancel_ownership_transfer(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Everything the ownership screen needs, in one call: who owns it, who is
-- named as backup, and what (if anything) is in flight.
-- ---------------------------------------------------------------------------
create or replace function public.api_ownership_state(p_company_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'owner_user_id', c.owner_user_id,
    'owner_member_id', (
      select m.id from public.company_members m
       where m.company_id = c.id and m.user_id = c.owner_user_id),
    'backup_owner_user_id', c.backup_owner_user_id,
    -- Null when the nomination no longer resolves to an active member (they
    -- left, or their account is gone). The screen reads that as "name one"
    -- rather than showing a name nobody can act on.
    'backup_member_id', (
      select m.id from public.company_members m
       where m.company_id = c.id
         and m.user_id = c.backup_owner_user_id
         and m.deactivated_at is null),
    'pending', (
      select jsonb_build_object(
               'id', t.id,
               'kind', t.kind,
               'from_user_id', t.from_user_id,
               'to_user_id', t.to_user_id,
               'to_member_id', (
                 select m.id from public.company_members m
                  where m.company_id = t.company_id and m.user_id = t.to_user_id),
               'ripens_at', t.ripens_at,
               'expires_at', t.expires_at,
               'created_at', t.created_at)
        from public.ownership_transfers t
       where t.company_id = c.id
         and t.accepted_at is null and t.declined_at is null and t.canceled_at is null
       limit 1)
  )
  from public.companies c
 where c.id = p_company_id
$$;

revoke execute on function public.api_ownership_state(uuid)
  from public, anon, authenticated;
grant execute on function public.api_ownership_state(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- The assertion, not the hope: every live workspace has exactly one owner
-- membership, and it belongs to the user `companies.owner_user_id` names.
--
-- Returns the offenders. Empty is the only acceptable answer, and the SQL
-- suite says so after every operation in this file — because the failure this
-- guards against (the two places disagreeing) is invisible from every screen
-- until somebody cannot do their job.
-- ---------------------------------------------------------------------------
create or replace function public.api_ownership_integrity()
returns table (company_id uuid, problem text)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id,
         case
           when o.user_id is null then 'owner_user_id is not an owner membership'
           when o.deactivated_at is not null then 'the owner membership is deactivated'
         end
    from public.companies c
    left join public.company_members o
      on o.company_id = c.id and o.role = 'owner' and o.user_id = c.owner_user_id
   where c.deleted_at is null
     and (o.user_id is null or o.deactivated_at is not null)
$$;

revoke execute on function public.api_ownership_integrity()
  from public, anon, authenticated;
grant execute on function public.api_ownership_integrity() to service_role;
