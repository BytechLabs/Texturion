-- #281 item 4 — a stalled workspace, while it is still recoverable.
--
-- The issue: "A workspace sitting at the same step for days is recoverable with
-- one founder message and a churn statistic a week later. The events exist;
-- nothing watches for their absence."
--
-- ---------------------------------------------------------------------------
-- WHY THIS IS NOT JUST call_silence_state WITH DIFFERENT COLUMNS.
--
-- #397's detector answers one yes/no question about an established rhythm. The
-- funnel has a distinction that detector never had to make: **a US workspace
-- waiting on carrier approval is not stalled, it is queued.** Alerting on it
-- would fire on every US signup for the first week of their life, and an alarm
-- that fires on the normal case teaches the reader to close the mailbox.
--
-- So the states separate what somebody can act on from what they cannot:
--
--   not_sent          They CAN send and have not. Canada-only from the moment a
--                     number is active, US from campaign approval. Recoverable
--                     with one message, which is the whole point of noticing.
--   no_reply          They sent, and nobody answered inside D12's 7 days. This
--                     is an activation FAILURE by the definition, detectable
--                     the moment the window closes now that
--                     companies.first_inbound_reply_at exists (#281 item 1).
--   awaiting_carrier  US registration submitted and not approved past the point
--                     our own copy promises ("3 to 7 business days"). Not the
--                     customer's fault and not a stall — but our public claim
--                     is what is failing, so it is worth a look.
--   ok                Nothing to say.
--
-- Precedence matters and runs backwards through the funnel: a workspace that
-- sent and got no reply is judged on THAT, not on the approval it cleared a
-- fortnight ago. Reporting the earliest unmet step would describe a problem
-- they already solved.
--
-- Transitions only, like #397 and #235. A workspace stuck for a week is not
-- news every morning.

create table if not exists public.activation_stall_state (
  company_id  uuid primary key references public.companies(id) on delete cascade,
  state       text not null default 'ok'
    check (state in ('ok', 'not_sent', 'no_reply', 'awaiting_carrier')),
  -- How long they have been in it, in days, at the last assessment. Carried so
  -- the alert can say "eleven days" rather than "a while".
  days_in_state int not null default 0,
  assessed_at timestamptz not null default now(),
  stalled_since timestamptz
);

comment on table public.activation_stall_state is
  '#281: per-workspace activation stall. D12 defines activation as a first send AND a reply within 7 days of payment; this is what notices a workspace failing that while somebody can still do something about it. A US workspace inside the carrier wait is deliberately NOT a stall.';

/**
 * Assess every paying workspace, and return only the ones that CHANGED.
 */
create or replace function public.api_assess_activation_stall()
returns table (
  company_id    uuid,
  company_name  text,
  was           text,
  state         text,
  days_in_state int
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  -- Days of being ABLE to send without sending before we call it a stall. Three
  -- covers a signup on Friday afternoon that gets going on Monday, which is the
  -- commonest innocent explanation in a trade.
  v_not_sent_days int := 3;
  -- D12's own window. Not a tunable: the definition says seven days.
  v_no_reply_days int := 7;
  -- Our copy says "3 to 7 business days". Ten calendar days is the far side of
  -- that including a weekend, so this fires when the promise is broken rather
  -- than while it is merely being tested.
  v_carrier_days int := 10;
begin
  return query
  with facts as (
    select
      c.id as company_id,
      c.name as company_name,
      c.us_texting_enabled,
      c.first_inbound_reply_at,
      -- When they could first have sent anything at all.
      (select min(n.created_at)
         from public.phone_numbers n
        where n.company_id = c.id
          and n.status = 'active') as number_ready_at,
      (select r.approved_at
         from public.messaging_registrations r
        where r.company_id = c.id
          and r.kind = 'campaign'
          and r.status = 'approved'
          and r.deactivated_at is null
        limit 1) as campaign_approved_at,
      (select r.submitted_at
         from public.messaging_registrations r
        where r.company_id = c.id
          and r.kind = 'campaign'
          and r.status <> 'approved'
          and r.deactivated_at is null
        order by r.submitted_at desc nulls last
        limit 1) as campaign_submitted_at,
      (select min(m.created_at)
         from public.messages m
        where m.company_id = c.id
          and m.direction = 'outbound'
          and m.telnyx_message_id is not null) as first_sent_at
    from public.companies c
    where c.deleted_at is null
      and c.subscription_status in ('active', 'past_due')
  ),
  ready as (
    select
      f.*,
      -- The moment sending became possible. A Canada-only workspace needs only
      -- a live number; a US one needs the carrier's approval too, and the
      -- LATER of the two is when they were actually unblocked.
      case
        when f.us_texting_enabled is not true then f.number_ready_at
        when f.campaign_approved_at is null then null
        else greatest(f.number_ready_at, f.campaign_approved_at)
      end as could_send_at
    from facts f
  ),
  judged as (
    select
      r.*,
      case
        -- Backwards through the funnel: the LAST unmet step is the live problem.
        when r.first_sent_at is not null
             and r.first_inbound_reply_at is null
             and r.first_sent_at < now() - make_interval(days => v_no_reply_days)
          then 'no_reply'
        when r.first_sent_at is null
             and r.could_send_at is not null
             and r.could_send_at < now() - make_interval(days => v_not_sent_days)
          then 'not_sent'
        when r.first_sent_at is null
             and r.us_texting_enabled is true
             and r.campaign_approved_at is null
             and r.campaign_submitted_at is not null
             and r.campaign_submitted_at < now() - make_interval(days => v_carrier_days)
          then 'awaiting_carrier'
        else 'ok'
      end as new_state
    from ready r
  ),
  measured as (
    select
      j.*,
      case j.new_state
        when 'no_reply' then extract(day from now() - j.first_sent_at)::int
        when 'not_sent' then extract(day from now() - j.could_send_at)::int
        when 'awaiting_carrier'
          then extract(day from now() - j.campaign_submitted_at)::int
        else 0
      end as days_in_state
    from judged j
  ),
  upserted as (
    insert into public.activation_stall_state as t
      (company_id, state, days_in_state, assessed_at, stalled_since)
    select
      m.company_id, m.new_state, m.days_in_state, now(),
      case when m.new_state <> 'ok' then now() end
    from measured m
    on conflict (company_id) do update
       set state         = excluded.state,
           days_in_state = excluded.days_in_state,
           assessed_at   = now(),
           stalled_since = case
                             when excluded.state = 'ok' then null
                             when t.state = 'ok' then now()
                             else t.stalled_since
                           end
    returning t.company_id, t.state, t.days_in_state
  )
  select
    u.company_id, m.company_name,
    coalesce(prev.state, 'ok') as was,
    u.state, u.days_in_state
  from upserted u
  join measured m on m.company_id = u.company_id
  -- Reads the PRE-statement snapshot, so this is the state before the upsert
  -- above — the same idiom api_assess_call_silence uses.
  left join (select company_id, state from public.activation_stall_state) prev
    on prev.company_id = u.company_id
  where u.state is distinct from coalesce(prev.state, 'ok');
end;
$$;

revoke all on function public.api_assess_activation_stall() from public, anon, authenticated;
grant execute on function public.api_assess_activation_stall() to service_role;

alter table public.activation_stall_state enable row level security;
revoke all on table public.activation_stall_state from public, anon, authenticated;
grant select, insert, update, delete on table public.activation_stall_state to service_role;
