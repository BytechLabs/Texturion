-- #537 — a one-time code by email, for the owner who has no authenticator.
--
-- ## Why this exists at all
--
-- The step-up already added to the handover routes asks for a second factor from
-- anybody who holds one. An owner who never set one up is asked for nothing, and
-- that is most owners — so the protection the issue asked for would reach a
-- minority of the people who need it most.
--
-- "Confirmation through 2fa or email" is the ask, and this is the email half: a
-- six-digit code sent to the address on the account, entered back into the dialog.
-- Same shape as the authenticator prompt, so one dialog covers both.
--
-- ## Why the code is hashed
--
-- It is a short-lived six digits, so a stolen database is not the main threat. But
-- the whole point of this table is to be the thing an attacker with a session does
-- NOT have, and a plaintext column would hand it to anybody who can read a row —
-- including, one day, a support query or a leaked backup. Hashed with the company
-- and user mixed in, so a code cannot be replayed against a different workspace.
--
-- ## Why it is scoped to an ACTION
--
-- A code issued to hand the business over must not accept it instead. Those are
-- opposite decisions made by different people, and a code that satisfied both
-- would let a stolen offer-code complete a takeover.

create table if not exists public.ownership_confirmations (
  company_id  uuid not null references public.companies(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,

  -- Which handover step this code may satisfy. Deliberately not an enum: the set
  -- is the API's business, and a new step should not need a migration to become
  -- confirmable.
  action      text not null check (action in ('offer', 'claim', 'accept')),

  -- sha256 of the code with the company and user mixed in, hex-encoded. See above.
  code_hash   text not null,

  -- Ten minutes. Long enough to find the email on a phone in a van, short enough
  -- that a code read over somebody's shoulder is worthless by the time it matters.
  expires_at  timestamptz not null,

  -- Set the moment it is spent, so a code cannot be used twice. Kept rather than
  -- deleted: "a code was used at 14:02" is what an incident review needs.
  used_at     timestamptz,

  -- Wrong guesses. Five and it is dead — six digits is 1-in-a-million per try, and
  -- an unbounded field is a million tries.
  attempts    smallint not null default 0,

  created_at  timestamptz not null default now(),

  -- ONE LIVE CODE PER PERSON PER ACTION. Asking again replaces the previous one,
  -- which is what a person expects when they tap "send it again" — and it means a
  -- flood of requests cannot leave a pile of valid codes behind.
  primary key (company_id, user_id, action)
);

comment on table public.ownership_confirmations is
  '#537: the one-time code that stands in for an authenticator when an owner has '
  'none. Hashed, single-use, ten minutes, five wrong guesses, and scoped to one '
  'handover step so an offer code cannot accept.';

create index if not exists ownership_confirmations_expiry
  on public.ownership_confirmations (expires_at);

alter table public.ownership_confirmations enable row level security;

-- No policies. Nothing but the service role touches this table: a member reading
-- their own row would be reading the answer to the question it exists to ask.
revoke all on table public.ownership_confirmations from anon, authenticated;

/**
 * Issue a code, returning the digits ONCE so the caller can email them.
 *
 * The plaintext leaves this function and is never stored. A caller that loses it
 * has to issue another, which is the correct failure: the alternative is a table
 * that can tell you what somebody's code was.
 */
create or replace function public.api_issue_ownership_code(
  p_company_id uuid,
  p_user_id    uuid,
  p_action     text
)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_code  text;
  v_bytes bytea;
begin
  -- Six digits, left-padded, from the cryptographic generator rather than
  -- random() — which is seeded and predictable, and this is the one value in the
  -- flow that an attacker must not be able to guess.
  --
  -- Drawn ONCE into a variable: calling the generator three times would work but
  -- reads as though the three bytes are related when they are not.
  --
  -- The modulo leaves a negligible bias (2^24 is not a multiple of a million, so
  -- the low 777,216 codes are 17-in-2^24 rather than 16-in-2^24). That moves a
  -- guess from 1-in-1,000,000 to about 1-in-940,000, which against a five-attempt
  -- ceiling is not worth rejection sampling.
  v_bytes := extensions.gen_random_bytes(3);
  v_code := lpad(
    ((get_byte(v_bytes, 0)::int * 65536
    + get_byte(v_bytes, 1)::int * 256
    + get_byte(v_bytes, 2)::int) % 1000000)::text, 6, '0');

  insert into public.ownership_confirmations
    (company_id, user_id, action, code_hash, expires_at, used_at, attempts)
  values
    (p_company_id, p_user_id, p_action,
     encode(
       extensions.digest(p_company_id::text || p_user_id::text || v_code, 'sha256'),
       'hex'
     ),
     now() + interval '10 minutes', null, 0)
  on conflict (company_id, user_id, action) do update
    set code_hash  = excluded.code_hash,
        expires_at = excluded.expires_at,
        used_at    = null,
        attempts   = 0,
        created_at = now();

  return v_code;
end;
$$;

comment on function public.api_issue_ownership_code(uuid, uuid, text) is
  '#537: mint a one-time handover code and return the digits once. Replaces any '
  'live code for the same person and step.';

/**
 * Spend a code. True only if it was right, live, unspent, and for this step.
 *
 * ## Why this reads the row before it writes
 *
 * The first version did it in one UPDATE and inferred success from "was `used_at`
 * set within the last second". That accepted a spent code twice, because `now()`
 * inside a transaction is the transaction's start time — so the timestamp written
 * by the first call still looked freshly written to the second. The row has to be
 * judged on its state BEFORE the write, which RETURNING cannot see.
 *
 * `FOR UPDATE` serialises concurrent guesses, so two requests racing cannot each
 * see four attempts and take a fifth.
 *
 * The attempt is counted before any of the reasons to refuse, which is the whole
 * point: a wrong guess must cost one of the five whether it was wrong because the
 * digits were wrong, because the code had expired, or because it had already been
 * spent.
 */
create or replace function public.api_use_ownership_code(
  p_company_id uuid,
  p_user_id    uuid,
  p_action     text,
  p_code       text
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_row public.ownership_confirmations;
begin
  select * into v_row
    from public.ownership_confirmations
   where company_id = p_company_id
     and user_id = p_user_id
     and action = p_action
     for update;

  -- No row at all is a miss, not an error: somebody who never asked for a code
  -- and guessed one should get the same answer as somebody who guessed wrong.
  if not found then
    return false;
  end if;

  update public.ownership_confirmations
     set attempts = v_row.attempts + 1
   where company_id = p_company_id
     and user_id = p_user_id
     and action = p_action;

  if v_row.used_at is not null
     or v_row.expires_at <= now()
     or v_row.attempts >= 5 then
    return false;
  end if;

  if v_row.code_hash is distinct from encode(
       extensions.digest(
         p_company_id::text || p_user_id::text || p_code, 'sha256'),
       'hex') then
    return false;
  end if;

  update public.ownership_confirmations
     set used_at = now()
   where company_id = p_company_id
     and user_id = p_user_id
     and action = p_action;

  return true;
end;
$$;

comment on function public.api_use_ownership_code(uuid, uuid, text, text) is
  '#537: spend a one-time handover code. Counts the attempt whether or not it '
  'matched, so a wrong guess costs one of the five.';

revoke all on function public.api_issue_ownership_code(uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.api_use_ownership_code(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.api_issue_ownership_code(uuid, uuid, text)
  to service_role;
grant execute on function public.api_use_ownership_code(uuid, uuid, text, text)
  to service_role;
