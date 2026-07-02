-- SPEC §6 — RLS posture (D8).
-- RLS enabled, deny-by-default, on every table. No policies grant anon /
-- authenticated any access to data tables, and no GRANTs are issued to those
-- roles (the post-May-2026 no-auto-grant default is kept; the revokes below
-- make the posture explicit and deterministic). The browser never touches
-- PostgREST; the Worker uses the sb_secret_ key (BYPASSRLS) and performs all
-- authorization itself. RLS is defense-in-depth.

alter table public.profiles                enable row level security;
alter table public.companies               enable row level security;
alter table public.company_members         enable row level security;
alter table public.invites                 enable row level security;
alter table public.phone_numbers           enable row level security;
alter table public.messaging_registrations enable row level security;
alter table public.contacts                enable row level security;
alter table public.conversations           enable row level security;
alter table public.conversation_reads      enable row level security;
alter table public.messages                enable row level security;
alter table public.message_attachments     enable row level security;
alter table public.conversation_events     enable row level security;
alter table public.tags                    enable row level security;
alter table public.conversation_tags       enable row level security;
alter table public.opt_outs                enable row level security;
alter table public.usage_events            enable row level security;
alter table public.webhook_events          enable row level security;
alter table public.templates               enable row level security;
alter table public.push_subscriptions      enable row level security;
alter table public.notification_prefs      enable row level security;
alter table public.usage_alerts            enable row level security;
alter table public.grace_notices           enable row level security;

-- Explicit deny-by-default: strip any table/sequence privileges from the
-- PostgREST end-user roles, and keep future objects unexposed.
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;

-- ---------------------------------------------------------------------------
-- The ONLY RLS policy for end users in the system: realtime.messages topic
-- authorization for private Broadcast topics `company:{id}` (§8).
--
-- Postgres evaluates policy expressions with the privileges of the querying
-- role. Because `authenticated` deliberately has NO grant on
-- public.company_members (deny-by-default posture above), the membership
-- check runs through a SECURITY DEFINER helper instead of a bare subquery —
-- same semantics as SPEC §8's policy, but it actually works without granting
-- table access to end-user roles.
-- ---------------------------------------------------------------------------

create or replace function public.is_company_topic_member(topic_text text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.company_members cm
    where cm.user_id = auth.uid()
      and cm.deactivated_at is null
      and topic_text = 'company:' || cm.company_id::text
  );
$$;

revoke execute on function public.is_company_topic_member(text) from public, anon;
grant  execute on function public.is_company_topic_member(text) to authenticated;

create policy company_topic_read on realtime.messages
for select to authenticated using (
  realtime.messages.extension = 'broadcast'
  and public.is_company_topic_member(realtime.topic())
);

-- ---------------------------------------------------------------------------
-- Storage: private per-company-keyed bucket for MMS attachments (§3, §6).
-- 5 MB per-bucket file limit. No storage RLS policies for end users — the API
-- mints short-lived signed URLs after membership checks.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit)
values ('mms-media', 'mms-media', false, 5242880)
on conflict (id) do nothing;
