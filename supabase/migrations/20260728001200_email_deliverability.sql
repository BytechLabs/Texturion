-- #386 — email was fire-and-forget across eighteen send sites.
--
-- `sendEmail` returned Resend's accepted-id and nothing else. Accepted means
-- WE QUEUED IT. Whether it arrived, bounced, or was reported as spam was
-- information we never asked for and had nowhere to put.
--
-- WHY THIS IS SHARED-FATE RATHER THAN ONE TENANT'S PROBLEM. A crew member
-- mistypes their address at invite, or a tech leaves and IT disables the
-- mailbox. Every new-text notification to that address then hard-bounces,
-- forever, because nothing suppresses it. Those bounces accumulate against OUR
-- sending domain — not against that customer. Mailbox providers act on
-- domain-level reputation, so one stale address degrades delivery for the
-- entire book, and the first symptom is every customer's notifications
-- quietly landing in spam.
--
-- That failure is an absence in exactly the #387/D55 sense: nothing throws,
-- and "usually fine" and "stopped being fine" look identical from here. So the
-- rate alert below is wired into that same ledger rather than inventing a
-- second alerting path.

-- ---------------------------------------------------------------------------
-- The ledger admits a third provider
-- ---------------------------------------------------------------------------
-- Same VERIFY → LEDGER → ACK → PROCESS contract as Stripe and Telnyx, so the
-- */5 sweeper replays a failed Resend event with no new machinery.
alter table public.webhook_events
  drop constraint if exists webhook_events_provider_check;
alter table public.webhook_events
  add constraint webhook_events_provider_check
  check (provider = any (array['stripe'::text, 'telnyx'::text, 'resend'::text]));

-- ---------------------------------------------------------------------------
-- What actually happened to each message
-- ---------------------------------------------------------------------------
create table if not exists public.email_events (
  id               uuid primary key default gen_random_uuid(),
  email            text not null,
  -- 'delivered' | 'bounced' | 'complained'
  event            text not null check (event in ('delivered','bounced','complained')),
  -- Resend reports 'Permanent' / 'Transient' on a bounce. Only a permanent one
  -- suppresses: a transient bounce is a full mailbox or a greylist, and
  -- suppressing on it would silence a customer over a temporary condition.
  bounce_type      text,
  resend_email_id  text,
  subject          text,
  occurred_at      timestamptz not null,
  created_at       timestamptz not null default now()
);

comment on table public.email_events is
  '#386: per-message delivery outcomes from the Resend webhook. Feeds the domain-level bounce/complaint rate and gives the legal sends (deletion receipts, export links) evidence of receipt rather than an accepted-id.';

-- The rate query is always "the last N hours", and the legal lookup is always
-- by the id Resend gave us at send time.
create index if not exists email_events_occurred_idx
  on public.email_events (occurred_at desc);
create index if not exists email_events_resend_id_idx
  on public.email_events (resend_email_id)
  where resend_email_id is not null;

-- ---------------------------------------------------------------------------
-- Addresses we must stop writing to
-- ---------------------------------------------------------------------------
create table if not exists public.email_suppressions (
  email          text primary key,
  -- 'hard_bounce' | 'complaint'
  reason         text not null check (reason in ('hard_bounce','complaint')),
  first_seen_at  timestamptz not null default now(),
  last_event_at  timestamptz not null default now(),
  -- A complaint is permanent and a member cannot clear it themselves; a hard
  -- bounce is usually a typo, and the person whose address it is must be able
  -- to fix it. Recorded rather than inferred, so the difference survives.
  cleared_at     timestamptz,
  cleared_by_user_id uuid references auth.users(id) on delete set null
);

comment on table public.email_suppressions is
  '#386: addresses that must not be sent to. A hard bounce is fixable by the person who owns the address; a complaint is permanent, because continuing to mail somebody who reported us as spam is the fastest route to a blocklist.';

create index if not exists email_suppressions_active_idx
  on public.email_suppressions (email)
  where cleared_at is null;

-- ---------------------------------------------------------------------------
-- record_email_event — one call: log it, and suppress if it earned that
-- ---------------------------------------------------------------------------
create or replace function public.record_email_event(
  p_email       text,
  p_event       text,
  p_occurred_at timestamptz,
  p_bounce_type text default null,
  p_resend_id   text default null,
  p_subject     text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $function$
declare
  v_email      text := lower(trim(p_email));
  v_suppress   text;
begin
  if v_email is null or v_email = '' then
    return jsonb_build_object('suppressed', false, 'reason', 'no_address');
  end if;

  insert into public.email_events
    (email, event, bounce_type, resend_email_id, subject, occurred_at)
  values
    (v_email, p_event, p_bounce_type, p_resend_id, p_subject, p_occurred_at);

  -- A COMPLAINT is permanent, no exceptions. A PERMANENT bounce suppresses; a
  -- transient one does not — a full mailbox is not a dead address, and
  -- treating it as one silences a paying customer's crew over a bad week.
  if p_event = 'complained' then
    v_suppress := 'complaint';
  elsif p_event = 'bounced' and coalesce(lower(p_bounce_type), '') like 'permanent%' then
    v_suppress := 'hard_bounce';
  end if;

  if v_suppress is null then
    return jsonb_build_object('suppressed', false);
  end if;

  insert into public.email_suppressions (email, reason, first_seen_at, last_event_at)
  values (v_email, v_suppress, p_occurred_at, p_occurred_at)
  on conflict (email) do update
     set last_event_at = greatest(public.email_suppressions.last_event_at, p_occurred_at),
         -- A complaint outranks a bounce and re-arms a cleared row: somebody
         -- who pressed "spam" after fixing a typo is still somebody we must
         -- stop mailing.
         reason = case
                    when v_suppress = 'complaint' then 'complaint'
                    else public.email_suppressions.reason
                  end,
         cleared_at = case
                        when v_suppress = 'complaint' then null
                        else public.email_suppressions.cleared_at
                      end;

  return jsonb_build_object('suppressed', true, 'reason', v_suppress);
end;
$function$;

-- ---------------------------------------------------------------------------
-- api_email_health — the domain-level rates, which is the number that matters
-- ---------------------------------------------------------------------------
-- Per-message alerting would be noise; reputation is a rolling domain-level
-- property. The cap here is the reputation cliff and it is ONE-WAY — a
-- throttled sending domain is not something a deploy fixes — so this exists to
-- fire well before it, per the cost-protection mandate's "alert before the
-- cap" rule.
create or replace function public.api_email_health(
  p_now          timestamptz default now(),
  p_window_hours int default 24
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $function$
  with windowed as (
    select event from public.email_events
     where occurred_at > p_now - make_interval(hours => p_window_hours)
  ), counts as (
    select
      count(*) filter (where event = 'delivered')  as delivered,
      count(*) filter (where event = 'bounced')    as bounced,
      count(*) filter (where event = 'complained') as complained,
      count(*)                                     as total
    from windowed
  )
  select jsonb_build_object(
    'window_hours', p_window_hours,
    'delivered', c.delivered,
    'bounced', c.bounced,
    'complained', c.complained,
    'total', c.total,
    -- Rates are null rather than zero on an empty window. Zero would read as
    -- "perfectly healthy" on a day we sent nothing at all, which is the same
    -- lie as a silent failure.
    'bounce_rate', case when c.total > 0 then round(c.bounced::numeric / c.total, 4) end,
    'complaint_rate', case when c.total > 0 then round(c.complained::numeric / c.total, 4) end,
    'suppressed_total', (select count(*) from public.email_suppressions where cleared_at is null))
  from counts c
$function$;

-- ---------------------------------------------------------------------------
-- api_email_suppression_state — "can we reach you?", for one address
-- ---------------------------------------------------------------------------
-- The member-facing half of #386 ask 2: a broken address must be visible and
-- fixable rather than merely broken. Returns null when the address is fine.
create or replace function public.api_email_suppression_state(p_email text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $function$
  select jsonb_build_object(
           'reason', s.reason,
           'since', s.first_seen_at,
           -- A hard bounce is nearly always a typo, and the person who owns
           -- the address is the one who can fix it. A complaint is not theirs
           -- to undo — we do not get to decide that somebody who reported us
           -- as spam wants mail again.
           'fixable', s.reason = 'hard_bounce')
    from public.email_suppressions s
   where s.email = lower(trim(p_email))
     and s.cleared_at is null
$function$;

revoke execute on function public.record_email_event(text, text, timestamptz, text, text, text)
  from public, anon, authenticated;
grant execute on function public.record_email_event(text, text, timestamptz, text, text, text)
  to service_role;
revoke execute on function public.api_email_health(timestamptz, int)
  from public, anon, authenticated;
grant execute on function public.api_email_health(timestamptz, int)
  to service_role;
revoke execute on function public.api_email_suppression_state(text)
  from public, anon, authenticated;
grant execute on function public.api_email_suppression_state(text)
  to service_role;

alter table public.email_events enable row level security;
alter table public.email_suppressions enable row level security;
-- No policies on either: these are platform-wide deliverability state, not
-- tenant data, and one company must never be able to enumerate another's
-- addresses. Reached through service_role only, like the other ledgers.
