-- #454 — drop the six-argument `api_for_you`, whose `p_is_lead` does nothing.
--
-- THIS IS THE CONTRACT HALF OF AN EXPAND/CONTRACT. #416/D53 removed every gate
-- that read `p_is_lead`, and the parameter was kept on purpose so the migration
-- and the Worker could deploy in either order without the not-yet-deployed side
-- calling a signature that no longer existed.
--
-- THE ORDERING THIS DEPENDS ON, AND WHY IT IS ALREADY SATISFIED. Dropping the
-- old overload while a Worker is still calling it 500s every /v1/for-you
-- request until the next deploy lands. That is why the expand half had to ship
-- first — and it has: `apps/api/src/routes/for-you.ts` stopped sending
-- `p_is_lead` and that change is deployed, verified against production before
-- this migration was written. The five-argument function it now calls was
-- created by 20260731050000_follow_up_reminders.sql.
--
-- WHY THIS IS NOT COSMETIC. `create or replace function` with a different
-- signature does not replace anything — it creates a second function. So both
-- overloads have been live this whole time, and a boolean named `p_is_lead` on
-- a security-definer RPC reads as though it still scopes something. The next
-- person to touch this has to trace four call sites to learn that it does not,
-- and the failure mode if they assume wrong is a role gate reintroduced by
-- accident on the queue #416 deliberately opened.
--
-- Only the OLD overload is dropped. The five-argument function is left exactly
-- as `follow_up_reminders` defined it, so this migration changes no behaviour
-- for any caller that is already correct.

drop function if exists public.api_for_you(
  uuid,          -- p_company_id
  uuid,          -- p_user_id
  boolean,       -- p_is_lead  <- the whole point
  timestamptz,   -- p_now
  int,           -- p_limit
  uuid[]         -- p_hidden_number_ids
);
