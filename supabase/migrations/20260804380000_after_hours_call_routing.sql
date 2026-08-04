-- [#278] What a call does after hours, and what the caller hears.
--
-- The call state machine supports exactly one inbound shape: ring everybody,
-- then on no-answer speak a greeting and take a message. There is nothing
-- between "everyone's phone rings" and "leave a message" — which is a complete
-- product for a two-person crew and visibly incomplete for anyone larger.
--
-- This is the first and cheapest slice of that gap: the clock. Business hours,
-- date exceptions and on-call shifts already exist and already drive the
-- away-reply (#402) and the alert fan-out (#244). Nothing on the CALL side has
-- ever read any of them, so a 3am burst-pipe call and a Tuesday-afternoon
-- invoice question ring the same four phones in the same way.
--
-- ---------------------------------------------------------------------------
-- IT DEFAULTS TO EXACTLY WHAT HAPPENS TODAY, AND THAT IS THE POINT.
--
-- #278's own devil's-advocate section is right: phone menus are widely hated,
-- and a badly-built one makes a small business sound like a call centre, which
-- is the opposite of what our customers are buying. So 'ring_everyone' is the
-- default on every existing and future workspace, this migration changes the
-- behaviour of nothing, and ring-all stays the recommended shape for a small
-- crew. This is a feature for the workspaces that have OUTGROWN ring-all.
-- ---------------------------------------------------------------------------

-- The three shapes, and why there are exactly three:
--
--   ring_everyone  Today. Hours are not consulted at all on the call path.
--   on_call_only   After hours, ring whoever is holding the phone (#244) and
--                  let everybody else sleep. NOBODY on call widens back to
--                  everyone — the #244 rule, which exists because waking four
--                  people who did not need it is a bad night and waking nobody
--                  is a customer who rings a competitor.
--   voicemail      After hours, ring the on-call member if there is one, and
--                  otherwise take a message straight away rather than ringing
--                  out for 45 seconds first.
--
-- The emergency path #278 asks for is inside BOTH non-default options rather
-- than being a fourth: "route by hours" and "but the person on call still gets
-- the 3am pipe burst" are not two decisions an owner makes separately, and
-- offering them as two is how somebody ends up with hours routing and no hole
-- in it.
alter table public.companies
  add column if not exists after_hours_calls text not null default 'ring_everyone';

alter table public.companies
  drop constraint if exists companies_after_hours_calls_check;
alter table public.companies
  add constraint companies_after_hours_calls_check
  check (after_hours_calls in ('ring_everyone', 'on_call_only', 'voicemail'));

-- Per number, because #307 established that a service line and a sales line are
-- two businesses. NULL means INHERIT the workspace's, the same rule as every
-- other identity column — not "ring everyone".
alter table public.phone_numbers
  add column if not exists after_hours_calls text;

alter table public.phone_numbers
  drop constraint if exists phone_numbers_after_hours_calls_check;
alter table public.phone_numbers
  add constraint phone_numbers_after_hours_calls_check
  check (
    after_hours_calls is null
    or after_hours_calls in ('ring_everyone', 'on_call_only', 'voicemail')
  );

-- ---------------------------------------------------------------------------
-- The after-hours greeting.
--
-- #309 shipped named recordings precisely so this could exist: "after hours",
-- "on another job", "holiday" were the examples in that issue, and until now
-- there was nothing that could ever select between them. One greeting cannot
-- cover both "we're with a customer, leave a message" and "we're closed until
-- Monday".
--
-- `on delete set null` on both, for the reason #309 named exactly: deleting a
-- recording must put the line back on the ordinary greeting, never leave it
-- pointing at an object that is gone. A caller hearing silence is the one
-- outcome worse than a caller hearing a robot, and a dangling reference is how
-- that happens.
--
-- NULL is not "no greeting after hours" — it falls back to the ordinary
-- greeting, which is what every line does today. There is no configuration
-- that can produce silence.
-- ---------------------------------------------------------------------------
alter table public.companies
  add column if not exists after_hours_greeting_id uuid
    references public.voicemail_greetings (id) on delete set null;

alter table public.phone_numbers
  add column if not exists after_hours_greeting_id uuid
    references public.voicemail_greetings (id) on delete set null;

comment on column public.companies.after_hours_calls is
  'What an inbound call does outside business hours (#278). ring_everyone = the pre-#278 behaviour and the default.';
comment on column public.phone_numbers.after_hours_calls is
  'Per-line override (#278/#307). NULL = inherit the workspace setting.';
comment on column public.companies.after_hours_greeting_id is
  'Recorded greeting played after hours (#278/#309). NULL = use the ordinary greeting.';
comment on column public.phone_numbers.after_hours_greeting_id is
  'Per-line after-hours recording (#278/#307). NULL = inherit the workspace selection.';
