-- #571 / #545 — revoking a public link is scoped to the workspace that owns it.
--
-- `api_revoke_public_links_for_subject` filtered on subject_type + subject_id and
-- nothing else, so any caller holding a subject uuid could revoke another
-- workspace's live customer link. DELETE /v1/tasks/:id/photos/share reached it
-- with an unverified path parameter; its POST sibling checks ownership before
-- minting and the DELETE had no counterpart.
--
-- The actor who matters is not an outsider: it is a `read_only` or `member` of the
-- affected workspace, the two roles the route's `history.read` gate exists to
-- exclude. The app shows them task ids and workspaces are self-serve, so acting
-- from a workspace they own was enough. That makes it a privilege escalation
-- inside the workspace as much as a tenancy leak, and the audit row landed in the
-- ACTING workspace, so the affected one had no record of who killed the link.
--
-- ## Why the company id is REQUIRED and first, not optional
--
-- `create or replace` cannot add a parameter — it would mint a second overload and
-- leave the unscoped function in place, callable and granted, which is the failure
-- mode this migration exists to remove. So the old signature is dropped and the
-- new one takes `p_company_id` as its FIRST argument, matching every other
-- company-scoped RPC here.
--
-- Deliberately NOT defaulted to null. A default would let a caller omit it and get
-- exactly the behaviour being fixed — silently, and with no way for a reader to
-- tell the two calls apart.
--
-- Two callers, both in apps/api/src/routes/job-photos.ts, both now pass it.

drop function if exists public.api_revoke_public_links_for_subject(text, uuid, text);

create or replace function public.api_revoke_public_links_for_subject(
  p_company_id   uuid,
  p_subject_type text,
  p_subject_id   uuid,
  p_reason       text default null
) returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  update public.public_links
     set revoked_at = now(), revoke_reason = p_reason
   -- The added predicate. `public_links.company_id` is NOT NULL, so this can
   -- never widen: a row either belongs to the caller's workspace or is not
   -- touched. A subject id from another workspace now revokes nothing and the
   -- caller learns only the count it already knew — zero.
   where company_id = p_company_id
     and subject_type = p_subject_type
     and subject_id = p_subject_id
     and revoked_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- REVOKE BEFORE GRANT, and this is not ceremony.
--
-- A brand-new function gets Postgres's default EXECUTE grant to PUBLIC, which
-- `anon` and `authenticated` inherit — i.e. the two roles PostgREST hands to a
-- browser. The `alter default privileges` in 20260701000300_rls.sql suppresses
-- that for TABLES and SEQUENCES only; functions are not covered. The predecessor
-- avoided it by being a `create or replace`, which preserves an existing ACL —
-- and dropping the old signature is exactly what threw that protection away.
--
-- Caught by public_links.test.sql's own privilege assertion on the first run of
-- this migration: it reads `has_function_privilege('anon', …)` over all six
-- public-link functions, and named this one. Without that test, scoping a link
-- revocation to one workspace would have shipped alongside making it callable
-- straight from a browser — a strictly worse trade.
revoke execute on function
  public.api_revoke_public_links_for_subject(uuid, text, uuid, text)
  from public, anon, authenticated;
grant execute on function
  public.api_revoke_public_links_for_subject(uuid, text, uuid, text)
  to service_role;
