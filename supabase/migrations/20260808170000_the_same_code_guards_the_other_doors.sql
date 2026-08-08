-- #537 (audit) — the same one-time code, for the other three doors out of a business.
--
-- ## What the audit found
--
-- The rule already written into account deletion is: an action that cannot be undone,
-- and that is not itself a way out of a lockout, should ask for proof of identity
-- rather than only checking a role. Three owner-only routes failed it.
--
--   * closing the workspace — everybody signed out, the number released, billing
--     cancelled. The data survives thirty days; the released number does not come
--     back.
--   * releasing a number — permanent, and whoever holds it next receives the texts
--     the business's customers send.
--   * turning OFF the workspace-wide two-factor requirement — silent, and it lowers
--     the whole crew's protection in one call.
--
-- A stolen session satisfied "are you the owner" for all three.
--
-- ## Why this is only a widened constraint
--
-- The mechanism from the handover is already right: hashed, single-use, ten minutes,
-- five wrong guesses, and scoped so a code minted for one action cannot satisfy
-- another. That last property is what this migration is about — the new actions have
-- to be NAMED for the scoping to mean anything, and the check constraint is where the
-- database enforces it. Nothing else about the table changes.
--
-- Turning the two-factor requirement ON is deliberately not in this list. Friction
-- belongs on the door that opens, not the one that closes.

alter table public.ownership_confirmations
  drop constraint if exists ownership_confirmations_action_check;

alter table public.ownership_confirmations
  add constraint ownership_confirmations_action_check
  check (
    action in (
      -- The handover itself (#537).
      'offer',
      'claim',
      'accept',
      -- The three the audit added. Named for what a person is about to do, not for
      -- the route that does it, because the name reaches the audit log.
      'close_workspace',
      'release_number',
      'relax_mfa'
    )
  );

comment on column public.ownership_confirmations.action is
  '#537: which single action this code may satisfy. A code minted to hand the '
  'business over must not close it instead — those are different decisions, and one '
  'code that satisfied both would let a stolen code do the other.';

comment on table public.ownership_confirmations is
  '#537: the one-time code that stands in for an authenticator when somebody has '
  'none, in front of every action that ends or hands over a business. Hashed, '
  'single-use, ten minutes, five wrong guesses, and scoped to one action.';
