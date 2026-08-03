-- ---------------------------------------------------------------------------
-- #244 — a member's own do-not-disturb, for the nights they are NOT on call.
--
-- The rota stops an after-hours PAGE waking everybody. It does nothing about
-- the ordinary traffic: a customer texting at 1:40am still pushes to every
-- member who can see the number, every night, forever. That is the same alert
-- fatigue by a slower route — the tech who turns off notifications to get some
-- sleep then misses the page that was genuinely theirs.
--
-- ---------------------------------------------------------------------------
-- THIS IS NOT #225, AND CONFLATING THEM WOULD BE A LEGAL BUG
--
-- #225's quiet hours govern OUTBOUND messages to customers: a window set by
-- regulators, which we may not widen. This governs alerts to OUR OWN USERS,
-- who have an employment relationship with the workspace and can agree to be
-- woken. Nothing here is ever read by the send path, and nothing in #225 may
-- decide whether a member's phone rings.
--
-- The two even point opposite ways: #225's window is a prohibition we enforce
-- against the business, and this one is a preference the business's own staff
-- set for themselves and can be overridden for an emergency.
--
-- ---------------------------------------------------------------------------
-- WHY A WINDOW AND NOT A SWITCH
--
-- "Notifications off" already exists (`push_enabled`), and it is the thing
-- people reach for when they want a night's sleep — after which they get
-- nothing at all, including the page that was theirs, and nobody remembers to
-- turn it back on. A window ends on its own at 7am. That difference is the
-- entire reason this column exists rather than a FAQ telling people to use the
-- switch they already have.
-- ---------------------------------------------------------------------------

alter table public.notification_prefs
  -- Local wall-clock times, half-open [from, to). NULL in either means no
  -- quiet hours, which is every existing member.
  add column if not exists quiet_from time,
  add column if not exists quiet_to   time,
  -- The member's OWN zone, captured when they set the window.
  --
  -- Not the company's. A workspace in Toronto with a tech living an hour east
  -- would silence the wrong hours for them, and "my phone is quiet 10pm-7am"
  -- means the clock on that phone. NULL falls back to the company timezone,
  -- which is right for the overwhelmingly common case of a crew in one place.
  add column if not exists quiet_timezone text;

comment on column public.notification_prefs.quiet_from is
  '#244: start of this member''s own do-not-disturb window, in '
  'quiet_timezone. Suppresses ROUTINE pushes only — an on-call page and an '
  'escalation still land, which is what makes this safe to turn on. NEVER '
  'consulted by the outbound send path; that window is #225''s and is law.';

alter table public.notification_prefs
  add constraint notification_prefs_quiet_pair_ck
  check (
    -- Both or neither. One half of a window is not a window, and a row with a
    -- start and no end would silence a phone until somebody noticed.
    (quiet_from is null and quiet_to is null)
    or (quiet_from is not null and quiet_to is not null)
  )
  not valid;
