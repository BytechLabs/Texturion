-- #694: a member can mute one noisy conversation, or follow one they do not own.
--
-- PER MEMBER, PER CONVERSATION, which is why this is a table and not a column
-- on `conversations`: my mute must never silence the crew, and my follow must
-- never add a name to someone else's list. Same grain as conversation_snoozes.
--
-- MUTE silences push and email for new messages, missed calls and voicemails on
-- this thread. It does not silence a ringing call, an @mention of me, or an
-- assignment to me; those are about me, not about the thread. `muted_until`
-- null on a muted row means "until I unmute".
--
-- FOLLOW adds me to the audience for new messages and missed calls even when the
-- thread is assigned to someone else. If both are set, mute wins.
--
-- An expired mute is not deleted by a timer. The senders read a past
-- `muted_until` as already over, so there is no sweep in the hot path and no
-- window where a member stays silenced because a job has not run.

create table if not exists public.conversation_member_prefs (
  company_id      uuid not null references public.companies(id) on delete restrict,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id         uuid not null references public.profiles(user_id) on delete cascade,
  muted           boolean not null default false,
  muted_until     timestamptz,
  followed        boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  primary key (conversation_id, user_id),
  -- A deadline only means something on a muted row.
  constraint conversation_member_prefs_until_needs_mute
    check (muted or muted_until is null)
);

-- "Which threads have I muted or followed?" for the list flags.
create index if not exists conversation_member_prefs_user_idx
  on public.conversation_member_prefs (company_id, user_id);

-- Deny-by-default RLS (SPEC §6 / D8): enabled, no policies, no end-user grants.
-- Every read and write goes through the Worker with the service key, and every
-- query there filters on the caller's own company and user, so a member reads
-- and writes only their own rows.
alter table public.conversation_member_prefs enable row level security;
revoke all on public.conversation_member_prefs from public, anon, authenticated;
grant select, insert, update, delete on public.conversation_member_prefs to service_role;

comment on table public.conversation_member_prefs is
  '#694: one member''s mute and follow on one conversation. Mute silences '
  'push and email for the thread, never a ring, a mention or an assignment. '
  'A past muted_until is over; rows are not swept. Cascades with the '
  'conversation, so the workspace purge reaches it.';
