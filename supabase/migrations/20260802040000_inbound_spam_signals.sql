-- [#250] The machine's suspicion, kept apart from the human's verdict.
--
-- `is_spam` is set by a person and by nobody else. That stays true: it drives
-- the inbox filter, closes the thread, and is what #342's review prompt asks a
-- human to reconsider. A classifier writing to it would make "the machine was
-- wrong" indistinguishable from "somebody changed their mind", and would let a
-- rule silently hide a customer.
--
-- So the classifier writes HERE instead, and the only thing a suspicion
-- changes is whether we wake somebody's phone. The thread stays in the inbox,
-- carries a badge saying why, and one tap clears it.
--
-- The hard constraint behind all of this: every genuine new customer is an
-- unknown sender with no prior outbound, because that is what a new lead IS.
-- Badge and sort, never hide.

alter table public.conversations
  add column if not exists spam_suspected_at timestamptz;

alter table public.conversations
  add column if not exists spam_signals jsonb;

comment on column public.conversations.spam_suspected_at is
  '#250: when the inbound classifier last scored this thread above the '
  'threshold. NEVER set by a person, and never a reason to hide the thread — '
  'it suppresses the notification push only. NULL once a member clears it.';

comment on column public.conversations.spam_signals is
  '#250: the scoring reasons behind spam_suspected_at, as '
  '[{key, weight, why}], so the badge can say WHY rather than asserting. A '
  'suspicion somebody cannot check is one they learn to ignore.';

-- Only suspected rows carry a value, so the index stays tiny.
create index if not exists conversations_spam_suspected_idx
  on public.conversations (company_id, spam_suspected_at desc)
  where spam_suspected_at is not null;

-- ---------------------------------------------------------------------------
-- Blocked senders: the manual escape hatch.
--
-- Unlike a suspicion, this IS a decision a person made, so it may act: a
-- blocked sender's inbound is marked spam and closed on arrival. Per company,
-- because one workspace blocking a number must never affect another's.

create table if not exists public.blocked_senders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  phone_e164 text not null,
  -- Who to ask when somebody wonders why a number stopped arriving. Nullable
  -- so a member leaving does not delete the block they made.
  blocked_by uuid references auth.users (id) on delete set null,
  reason text,
  created_at timestamptz not null default now(),
  unique (company_id, phone_e164)
);

comment on table public.blocked_senders is
  '#250: numbers a workspace refuses. Inbound from one is marked spam and '
  'closed on arrival — a person chose this, so it is allowed to act, unlike '
  'the classifier''s suspicion.';

create index if not exists blocked_senders_company_idx
  on public.blocked_senders (company_id, phone_e164);

alter table public.blocked_senders enable row level security;

-- The API reaches Postgres as service_role and does its own authorization, the
-- same posture as every other table here. No anon/authenticated grants.
revoke all on public.blocked_senders from public, anon, authenticated;
grant select, insert, delete on public.blocked_senders to service_role;
