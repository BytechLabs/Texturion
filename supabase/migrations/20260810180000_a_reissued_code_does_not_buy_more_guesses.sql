-- #574 / #545 — the handover code's guess ceiling now survives a reissue.
--
-- The five-attempt ceiling was implemented correctly: the attempt is recorded before
-- every refusal and read pre-increment, so exactly five guesses. It simply did not
-- survive a mint. `api_issue_ownership_code` upserts `attempts = 0` on conflict, and
-- the route that mints has no rate limit — so asking for a fresh code bought five
-- more guesses, and asking was free. Six digits against unlimited batches of five is
-- not a ceiling at all.
--
-- This code stands in for an authenticator in front of two irreversible things:
-- handing the business to somebody else, and turning the workspace's two-factor
-- requirement off. Its whole job is to be unguessable by somebody holding a stolen
-- session.
--
-- ## Two controls, because one is not enough
--
-- 1. HERE: a `failed_total` on a rolling 24-hour window that a mint does not clear.
--    Ten usable guesses per window however many codes are issued.
-- 2. IN THE ROUTE: a limiter on the mint itself, so the window cannot be walked
--    through at machine speed even before the ceiling bites.
--
-- ## Why the window resets itself
--
-- A permanent lock would be worse than the bug for the person it protects. The owner
-- IS the party confirming, so there is nobody above them to appeal to — a hard lock
-- would mean fumbling a code ten times permanently prevents handing over a business.
-- Twenty-four hours bounds an attacker to ten guesses a day (about one chance in a
-- hundred thousand per window, ~0.4% over a year of sustained attempts against a
-- session they must keep alive throughout) while a real owner recovers by tomorrow.
--
-- Both function bodies are the current definitions extracted verbatim and patched;
-- diffed against the originals, and every removed line is one deliberately replaced.

alter table public.ownership_confirmations
  -- Wrong guesses that a reissue cannot wipe. `attempts` is per code and still
  -- resets when one is reissued; this is per person per action per window.
  add column if not exists failed_total smallint not null default 0,
  -- When the current window opened. NULL means no failure has been recorded since
  -- the last success, so the next failure opens a fresh window.
  add column if not exists window_started_at timestamptz;

comment on column public.ownership_confirmations.failed_total is
  '#574: wrong guesses inside the current 24h window, across every code issued for '
  'this person and action. Not reset by a reissue — that reset was the bug.';

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
    -- #574: `attempts` still resets — five guesses PER CODE is the right shape,
    -- and a person who asked for a fresh code should get a fresh five.
    --
    -- `failed_total` and `window_started_at` deliberately do NOT appear here. That
    -- omission is the fix: resetting the per-code counter was the whole ceiling, so
    -- asking for a new code bought five more guesses and asking was unlimited. The
    -- cross-reissue counter has to survive the thing that was resetting it.
    set code_hash  = excluded.code_hash,
        expires_at = excluded.expires_at,
        used_at    = null,
        attempts   = 0,
        created_at = now();

  return v_code;
end;
$$;

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

  -- #574: a rolling-window failure count that a reissue cannot clear.
  --
  -- Recorded BEFORE any refusal, exactly as `attempts` is, so a wrong guess costs
  -- the same whether the code was expired, spent or simply wrong — otherwise the
  -- cheapest refusals become free guesses.
  --
  -- The window resets itself after 24 hours rather than needing anybody to unlock
  -- it. A permanent lock would be worse than the bug for the person it protects:
  -- the owner IS the party confirming, so there is nobody above them to appeal to,
  -- and handing over a business is not something to make impossible because
  -- somebody fat-fingered a code ten times.
  update public.ownership_confirmations
     set attempts = v_row.attempts + 1,
         failed_total = case
           when v_row.window_started_at is null
                or v_row.window_started_at <= now() - interval '24 hours'
             then 1
           else coalesce(v_row.failed_total, 0) + 1
         end,
         window_started_at = case
           when v_row.window_started_at is null
                or v_row.window_started_at <= now() - interval '24 hours'
             then now()
           else v_row.window_started_at
         end
   where company_id = p_company_id
     and user_id = p_user_id
     and action = p_action;

  -- #574: the cross-reissue ceiling, read pre-increment like `attempts` — so it is
  -- exactly ten usable guesses in a window, however many codes were minted.
  --
  -- Ten against six digits is about one chance in a hundred thousand per window,
  -- and every failure is a row somebody can look at. Reissuing no longer buys more.
  if v_row.window_started_at is not null
     and v_row.window_started_at > now() - interval '24 hours'
     and coalesce(v_row.failed_total, 0) >= 10 then
    return false;
  end if;

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

  -- #574: a successful use is the legitimate end, so the window clears with it.
  -- Leaving it would mean a second handover step inheriting the first's failures.
  update public.ownership_confirmations
     set failed_total = 0, window_started_at = null
   where company_id = p_company_id
     and user_id = p_user_id
     and action = p_action;

  return true;
end;
$$;
