-- #722, plan item 8: the machines whose state is derived from timestamps get
-- one SQL definition each, so the server and every client read the same
-- state instead of each recomputing it. `enforced.test.ts` checks each
-- function returns exactly its machine's states
-- (packages/shared/src/state-machines/{task,invite,workspace,conversation-visibility}.ts).
--
-- Decided here: `conversations.status` keeps its full mesh (new, open, waiting
-- and closed each reach every other). Status is a workflow label a member
-- moves freely, reopening, closing or waiting on the customer, so every edge
-- is legitimate and the enum already enforces the vocabulary.
--
-- Two invariants the derived states imply become constraints, after checking
-- production holds none that break them: an invite cannot be both accepted and
-- revoked, and a workspace is only purged once it has been closed.

create or replace function public.task_state(p_done_at timestamptz, p_deleted_at timestamptz)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_deleted_at is not null then 'trashed'
    when p_done_at is not null then 'done'
    else 'open'
  end;
$$;

create or replace function public.invite_state(
  p_accepted_at timestamptz,
  p_revoked_at  timestamptz,
  p_expires_at  timestamptz,
  p_now         timestamptz
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_accepted_at is not null then 'accepted'
    when p_revoked_at is not null then 'revoked'
    when p_expires_at is not null and p_expires_at <= p_now then 'expired'
    else 'pending'
  end;
$$;

create or replace function public.workspace_state(
  p_paused_at  timestamptz,
  p_deleted_at timestamptz,
  p_purged_at  timestamptz
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_purged_at is not null then 'purged'
    when p_deleted_at is not null then 'closed'
    when p_paused_at is not null then 'paused'
    else 'active'
  end;
$$;

create or replace function public.conversation_visibility(
  p_is_spam    boolean,
  p_deleted_at timestamptz
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_deleted_at is not null then 'trashed'
    when coalesce(p_is_spam, false) then 'spam'
    else 'live'
  end;
$$;

alter table public.invites add constraint invites_not_accepted_and_revoked
  check (accepted_at is null or revoked_at is null);

alter table public.companies add constraint companies_purged_after_closed
  check (purged_at is null or deleted_at is not null);

revoke execute on function public.task_state(timestamptz, timestamptz) from public, anon;
revoke execute on function public.invite_state(timestamptz, timestamptz, timestamptz, timestamptz) from public, anon;
revoke execute on function public.workspace_state(timestamptz, timestamptz, timestamptz) from public, anon;
revoke execute on function public.conversation_visibility(boolean, timestamptz) from public, anon;
