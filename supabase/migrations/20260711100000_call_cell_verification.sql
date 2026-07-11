-- #133 (D40): the outbound bridge may only dial a cell its member has PROVEN
-- they hold. company_members.call_cell_e164 (D38) gains a verification state:
-- PUT /v1/calls/cell texts a 6-digit code from the company's business number,
-- POST /v1/calls/cell/verify checks it, and POST /v1/calls refuses to dial an
-- unverified cell. Mitigates the two real risks of a free-text cell: a typo
-- (a stranger's phone rings with the business number and could be bridged to
-- a customer) and deliberate harassment-by-proxy (making Loonext dial a
-- victim). AMD already keeps voicemail out of bridges; this keeps OTHER
-- PEOPLE'S phones out entirely.
--
-- The code lives HASHED (sha-256 of code + member scope, computed in the
-- Worker) with an expiry, an attempt cap, and a send-window cap — all
-- enforced API-side; the columns just persist the state. Cost protection:
-- every send is a real Telnyx charge on us, so the window cap is schema-level
-- reality, not advisory.
--
-- Backfill: cells that exist BEFORE this migration were collected under D38
-- and have already placed real bridged calls — possession proven in use, so
-- they grandfather as verified. Every new or CHANGED cell verifies from now
-- on (the API clears verified_at whenever the number changes).

alter table public.company_members
  add column if not exists call_cell_verified_at   timestamptz,
  add column if not exists call_cell_code_hash     text,
  add column if not exists call_cell_code_expires_at timestamptz,
  add column if not exists call_cell_code_attempts int not null default 0,
  add column if not exists call_cell_code_sent_at  timestamptz,
  add column if not exists call_cell_code_window_start timestamptz,
  add column if not exists call_cell_code_window_sends int not null default 0;

comment on column public.company_members.call_cell_verified_at is
  'D40: when this member proved they hold call_cell_e164 (SMS code). NULL = unverified; POST /v1/calls refuses to dial.';
comment on column public.company_members.call_cell_code_hash is
  'sha-256 hex of the pending verification code, scoped to (company_id, user_id); cleared on success.';
comment on column public.company_members.call_cell_code_window_start is
  'start of the rolling send window; the API caps codes per window (cost protection).';

update public.company_members
   set call_cell_verified_at = now()
 where call_cell_e164 is not null
   and call_cell_verified_at is null;
