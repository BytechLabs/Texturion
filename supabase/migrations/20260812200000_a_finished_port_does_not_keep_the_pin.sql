-- A finished port stops holding the losing carrier's account credentials.
--
-- `port_requests` kept `account_number`, `pin_passcode` and `ssn_sin_last4` for
-- the life of the ROW. Those three are credentials to the customer's account at
-- ANOTHER carrier — an account number plus a port-out PIN is enough to move the
-- number again — and both documents that describe them promise less than that:
--
--   docs/PORTING.md §2.2                the PIN is stored "because Telnyx
--                                       requires it in the order payload and a
--                                       rejected port must be re-submittable
--                                       without re-collecting it"
--   docs/PERSONAL-DATA-INVENTORY.md     retention: "Life of the port"
--
-- Both purposes end in the same place. The payload is built by the §3.4 PATCH
-- and re-issued by fix-and-resubmit, and neither runs again once the row is
-- `ported` or `cancelled`: `apps/api/src/telnyx/porting.ts` returns the row
-- untouched from both `startPortSaga` and `submitPortRequest` on those statuses,
-- and `assertEditable` in `apps/api/src/routes/porting.ts` refuses any edit past
-- `draft`/`exception`. So the code held the credentials strictly longer than
-- either document said it did, for no purpose either document could name.
--
-- TERMINAL = ('ported','cancelled') — the SAME set `port_requests_open_idx` and
-- the §5.2 reconcile cron already use for "not fully done", so this adds no
-- fourth definition of when a port is over. `cancel-pending` is deliberately
-- outside it: the cancellation has not been acknowledged yet, the port can still
-- land, and scrubbing on an outcome that is not decided is how you delete
-- something you turn out to need.
--
-- `ported` is the VOICE track, and the messaging track can lag it by days
-- (`messaging_port_status` pending/activating/exception). That is fine and not
-- an oversight: the messaging sub-order carries no carrier credentials. It is
-- switched on by the same PATCH and escalated by Telnyx when it fails; we never
-- re-file it, and `ALLOWED_MESSAGING_TRANSITIONS` offers no path that would.
--
-- A TRIGGER **AND** A SWEEP, because neither one is sufficient:
--   * the trigger is immediate and cannot be forgotten — every future
--     transition scrubs itself, including a row INSERTed already terminal, and
--     including a later write that tries to put a credential back onto a
--     finished port;
--   * the trigger cannot reach the rows that were ALREADY terminal when it was
--     created, so the sweep runs once at the bottom of this file. It stays
--     behind as a function rather than a bare UPDATE so the identical rule can
--     be re-run later — after a restore from a pre-fix dump, or if the trigger
--     is ever disabled to push a data fix through — instead of being
--     reconstructed by hand from this migration.

-- ---------------------------------------------------------------------------
-- Make the column scrubbable without making it optional.
-- ---------------------------------------------------------------------------

-- `account_number` was NOT NULL, which is precisely what made it unscrubbable.
-- Dropping that outright would also permit a LIVE port with no account number,
-- and the Telnyx PATCH cannot survive one — `patchPortingOrder` copies the
-- column straight into `end_user.admin.account_number`, so a null would ship as
-- a null and the carrier would reject the order.
--
-- Replaced by the conditional form, which states the rule the NOT NULL was
-- standing in for: a port that is still running must carry its account number;
-- a finished one must be free to lose it. It buys a second guarantee too — a
-- scrubbed row can never be walked back into a live status without the number
-- being re-collected, which is the exact state in which the saga would PATCH a
-- null.
alter table public.port_requests alter column account_number drop not null;

alter table public.port_requests
  add constraint port_requests_live_needs_account_number
  check (status in ('ported', 'cancelled') or account_number is not null);

-- ---------------------------------------------------------------------------
-- The trigger: every future transition into a terminal status.
-- ---------------------------------------------------------------------------

create or replace function public.scrub_port_credentials() returns trigger
language plpgsql
-- Not SECURITY DEFINER, unlike the RPCs in this schema: it rewrites only the row
-- already being written by the caller, so definer rights would be privilege
-- granted for nothing. search_path is still pinned — an unqualified name inside
-- a trigger body resolves against whatever the WRITER's search_path happens to
-- be, which is not ours to assume.
set search_path = ''
as $$
begin
  if new.status in ('ported', 'cancelled') then
    new.account_number := null;
    new.pin_passcode   := null;
    new.ssn_sin_last4  := null;
  end if;
  return new;
end $$;

-- A newly created function comes back with EXECUTE granted to PUBLIC, which anon
-- and authenticated inherit. Postgres does not re-check EXECUTE when a trigger
-- fires (only when the trigger is created), so revoking costs the trigger
-- nothing and removes a callable entry point from two roles that have no
-- business with this table at all.
revoke execute on function public.scrub_port_credentials()
  from public, anon, authenticated;

-- BEFORE, so the scrub is part of the same row write: no second UPDATE, no
-- second moddatetime pass, and no window in which the terminal row exists on
-- disk with the credentials still on it. INSERT as well as UPDATE, because a row
-- can arrive already terminal (a backfill, a restore, a future importer).
--
-- Runs before `set_updated_at` (BEFORE triggers fire in name order, and
-- `port_requests_scrub_credentials` sorts ahead of it). They touch disjoint
-- columns, so the ordering is not load-bearing — recorded only so the next
-- person does not have to work it out.
create trigger port_requests_scrub_credentials
  before insert or update on public.port_requests
  for each row execute function public.scrub_port_credentials();

-- ---------------------------------------------------------------------------
-- The sweep: the rows that went terminal before the trigger existed.
-- ---------------------------------------------------------------------------

create or replace function public.sweep_terminal_port_credentials() returns integer
language plpgsql
-- SECURITY INVOKER for the same reason as the trigger function: the only caller
-- that needs it (service_role) already has UPDATE on the table, and a definer
-- function whose whole job is to null columns is a bigger thing to leave lying
-- around than the problem it solves.
set search_path = ''
as $$
declare
  v_scrubbed int;
begin
  update public.port_requests
     set account_number = null,
         pin_passcode   = null,
         ssn_sin_last4  = null
   where status in ('ported', 'cancelled')
     -- Skip the rows that are already clean. Without this a re-run rewrites
     -- every finished port in the table, churning `updated_at` and re-emitting
     -- a port.updated broadcast for each one, which would make the sweep
     -- something people hesitate to run — and a scrub nobody dares re-run is
     -- the same as not having one.
     and (account_number is not null
       or pin_passcode is not null
       or ssn_sin_last4 is not null);
  get diagnostics v_scrubbed = row_count;
  return v_scrubbed;
end $$;

revoke execute on function public.sweep_terminal_port_credentials()
  from public, anon, authenticated;
grant execute on function public.sweep_terminal_port_credentials() to service_role;

-- The one-time backfill. This ERASES data and no rollback brings it back — that
-- is the change, not a side effect of it.
--
-- `port_requests_broadcast` fires once per scrubbed row and emits a port.updated
-- into `company:{id}`. Left ON deliberately: the payload is ids plus the two
-- status values and never the credentials (asserted by PT16), the status it
-- reports has not changed, and disabling a Broadcast trigger to push a data fix
-- through is how a real event goes missing six months later. `moddatetime` also
-- bumps `updated_at` on each scrubbed row; the only reader of that column is
-- `resumeDue`, which asks it about `draft` rows, and a draft row is never
-- terminal.
do $$
declare
  v_scrubbed int;
begin
  v_scrubbed := public.sweep_terminal_port_credentials();
  raise notice
    'sweep_terminal_port_credentials: scrubbed % finished port_requests row(s)',
    v_scrubbed;
end $$;
