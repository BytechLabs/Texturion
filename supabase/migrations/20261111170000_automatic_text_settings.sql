-- The workspace decides how its automatic texts behave.
--
-- Each of these was a constant in code. The behaviour stays the default; the
-- values move onto the company row so an admin can change them, the same shape
-- as away_enabled and lead_chase_enabled. Columns on `companies` keep that
-- table's existing RLS and grants posture, so no policy changes.
--
-- Deliberately NOT settings (legal or safety, recorded in docs/DECISIONS.md):
-- an opt-out only the customer can lift, the legal sending window, a reminder
-- for a job that is gone, the per-workspace queue caps, the emergency
-- acknowledgment throttle and the carrier-required HELP reply.
alter table public.companies
  add column if not exists hold_scheduled_on_reply boolean not null default true,
  add column if not exists hold_reminders_on_reply boolean not null default true,
  add column if not exists hold_rating_ask_on_reply boolean not null default true,
  add column if not exists hold_reminders_unverified_calendar boolean not null default true,
  add column if not exists rating_ask_enabled boolean not null default true,
  add column if not exists rating_ask_delay_hours smallint not null default 4,
  add column if not exists rating_ask_expiry_hours smallint not null default 24,
  add column if not exists rating_ask_cooldown_days smallint not null default 30,
  add column if not exists scheduled_text_expiry_hours smallint not null default 24,
  add column if not exists reminder_expiry_hours smallint not null default 2,
  add column if not exists auto_reply_cooldown_minutes smallint not null default 180;

alter table public.companies
  add constraint companies_rating_ask_delay_ck
    check (rating_ask_delay_hours between 0 and 168),
  add constraint companies_rating_ask_expiry_ck
    check (rating_ask_expiry_hours between 1 and 168),
  add constraint companies_rating_ask_cooldown_ck
    check (rating_ask_cooldown_days between 1 and 365),
  add constraint companies_scheduled_text_expiry_ck
    check (scheduled_text_expiry_hours between 1 and 720),
  add constraint companies_reminder_expiry_ck
    check (reminder_expiry_hours between 1 and 72),
  add constraint companies_auto_reply_cooldown_ck
    check (auto_reply_cooldown_minutes between 1 and 1440);

comment on column public.companies.hold_scheduled_on_reply is
  'Hold a text a person scheduled when the customer replied after it was written. On by default; held, never dropped.';
comment on column public.companies.hold_reminders_on_reply is
  'Hold an appointment reminder when the customer replied after it was queued. On by default.';
comment on column public.companies.hold_rating_ask_on_reply is
  'Hold the automatic rating question when the customer replied after it was queued. On by default.';
comment on column public.companies.hold_reminders_unverified_calendar is
  'Hold a reminder for a calendar-mirrored appointment until the calendar has been verified recently. On by default: the reminder repeats a literal time.';
comment on column public.companies.rating_ask_enabled is
  'Ask the customer how a finished job went. On by default.';
comment on column public.companies.rating_ask_delay_hours is
  'Hours after a job is finished before the rating question is queued. Default 4.';
comment on column public.companies.rating_ask_expiry_hours is
  'Hours a queued or held rating question stays sendable before it expires. Default 24.';
comment on column public.companies.rating_ask_cooldown_days is
  'Days after one rating question before the same customer is asked again. Default 30.';
comment on column public.companies.scheduled_text_expiry_hours is
  'Hours a text a person scheduled may stay held after its send time before it expires. Default 24.';
comment on column public.companies.reminder_expiry_hours is
  'Hours a held appointment reminder may wait after the appointment time before it expires. Default 2.';
comment on column public.companies.auto_reply_cooldown_minutes is
  'Minutes between automatic replies (away reply, missed-call text) on one conversation. Default 180.';

-- The cooldown reads the company's own value. The check stays inside the claim
-- for the reason the original gave: two jobs finishing in the same minute must
-- not both pass a check made before either wrote a row.
create or replace function public.api_claim_job_rating(
  p_company_id      uuid,
  p_task_id         uuid,
  p_conversation_id uuid,
  p_contact_id      uuid,
  p_rated_user_id   uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_last          timestamp with time zone;
  v_id            uuid;
  v_cooldown_days integer;
begin
  if exists (
    select 1 from public.job_ratings
     where task_id = p_task_id and company_id = p_company_id
  ) then
    return jsonb_build_object('outcome', 'already_asked');
  end if;

  select co.rating_ask_cooldown_days into v_cooldown_days
    from public.companies co
   where co.id = p_company_id;
  v_cooldown_days := coalesce(v_cooldown_days, public.job_rating_cooldown_days());

  select max(asked_at) into v_last
    from public.job_ratings
   where company_id = p_company_id
     and contact_id = p_contact_id;

  if v_last is not null
     and v_last > now() - make_interval(days => v_cooldown_days)
  then
    return jsonb_build_object(
      'outcome', 'too_soon',
      'last_asked_at', v_last,
      'cooldown_days', v_cooldown_days
    );
  end if;

  insert into public.job_ratings
    (company_id, task_id, conversation_id, contact_id, rated_user_id)
  values
    (p_company_id, p_task_id, p_conversation_id, p_contact_id, p_rated_user_id)
  returning id into v_id;

  return jsonb_build_object('outcome', 'claimed', 'id', v_id);
end $$;

revoke all on function public.api_claim_job_rating(uuid, uuid, uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.api_claim_job_rating(uuid, uuid, uuid, uuid, uuid)
  to service_role;

-- The calendar hold follows the workspace setting hold_reminders_unverified_calendar.
create or replace function public.api_fire_scheduled_message(
  p_id                uuid,
  p_segments_estimate integer
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_probe           public.scheduled_messages%rowtype;
  v_scheduled       public.scheduled_messages%rowtype;
  v_message         public.messages%rowtype;
  v_task            public.tasks%rowtype;
  v_source_done_at  timestamptz;
  v_calendar_backed boolean := false;
  v_calendar_safe   boolean := true;
  v_now             timestamptz := now();
  v_hold_unverified boolean := true;
begin
  -- Identity probe only.  The authoritative row is locked after the calendar
  -- serialization rows so provider apply keeps connection->link->outbox->send
  -- ordering and cannot deadlock this transaction.
  select * into v_probe
    from public.scheduled_messages s
   where s.id = p_id and s.status in ('pending', 'held');
  if not found then
    return jsonb_build_object('outcome', 'gone');
  end if;

  if v_probe.origin = 'reminder' and v_probe.task_id is not null then
    -- Serializes OAuth completion/workspace closure with the no-link case.
    perform 1 from public.companies co
     where co.id = v_probe.company_id
     for update;

    -- Include the assigned member's connection even before its first link,
    -- plus every connection named by a mapping or live outbox intent.
    perform 1
      from public.calendar_connections c
     where c.company_id = v_probe.company_id
       and (
         c.user_id in (
           select a.user_id from public.task_assignees a
            where a.task_id = v_probe.task_id and a.company_id = v_probe.company_id
         )
         or exists (
           select 1 from public.task_calendar_links l
            where l.company_id = v_probe.company_id
              and l.task_id = v_probe.task_id
              and l.connection_id = c.id
              and l.link_state <> 'unlinked'
         )
         or exists (
           select 1 from public.calendar_outbox o
            where o.company_id = v_probe.company_id
              and o.task_id = v_probe.task_id
              and o.connection_id = c.id
              and o.state in ('queued', 'leased')
         )
       )
     order by c.id
     for update;
    perform 1
      from public.task_calendar_links l
     where l.company_id = v_probe.company_id
       and l.task_id = v_probe.task_id
       and l.link_state <> 'unlinked'
     order by l.id
     for update;
    select * into v_task
      from public.tasks t
     where t.id = v_probe.task_id and t.company_id = v_probe.company_id
     for update;
    if found then
      select m.done_at into v_source_done_at
        from public.messages m
       where m.id = v_task.message_id and m.company_id = v_probe.company_id
       for update;
    end if;
    perform 1
      from public.calendar_outbox o
     where o.company_id = v_probe.company_id
       and o.task_id = v_probe.task_id
       and o.state in ('queued', 'leased')
     order by o.id
     for update;
  end if;

  select * into v_scheduled
    from public.scheduled_messages s
   where s.id = p_id
     and s.status in ('pending', 'held')
   for update;
  if not found then
    return jsonb_build_object('outcome', 'gone');
  end if;

  if v_scheduled.origin = 'reminder' and v_scheduled.task_id is not null then
    if v_task.id is null
       or v_task.deleted_at is not null
       or v_task.reminders_off
       or v_task.due_at is null
       or coalesce(v_source_done_at, v_task.done_at) is not null then
      update public.scheduled_messages s
         set status = 'failed',
             held_reason = 'The job is no longer scheduled.',
             held_reason_key = 'job_no_longer_scheduled',
             claimed_at = null,
             updated_at = v_now
       where s.id = p_id
      returning * into v_scheduled;
      return jsonb_build_object(
        'outcome', 'failed',
        'reason_key', 'job_no_longer_scheduled',
        'scheduled_message', to_jsonb(v_scheduled)
      );
    end if;

    select co.hold_reminders_unverified_calendar into v_hold_unverified
      from public.companies co
     where co.id = v_scheduled.company_id;
    v_hold_unverified := coalesce(v_hold_unverified, true);

    v_calendar_backed := exists (
      select 1 from public.calendar_outbox o
       where o.company_id = v_scheduled.company_id
         and o.task_id = v_scheduled.task_id
         and o.state in ('queued', 'leased')
    ) or exists (
      select 1 from public.task_calendar_links l
       where l.company_id = v_scheduled.company_id
         and l.task_id = v_scheduled.task_id
         and l.link_state <> 'unlinked'
    );

    if v_calendar_backed then
      v_calendar_safe := exists (
        select 1 from public.companies co
         where co.id = v_scheduled.company_id and co.deleted_at is null
      )
      and not exists (
        select 1 from public.calendar_outbox o
         where o.company_id = v_scheduled.company_id
           and o.task_id = v_scheduled.task_id
           and o.state in ('queued', 'leased')
      )
      and not exists (
        select 1
          from public.task_calendar_links l
          left join public.calendar_connections c
            on c.id = l.connection_id and c.company_id = l.company_id
         where l.company_id = v_scheduled.company_id
           and l.task_id = v_scheduled.task_id
           and l.link_state <> 'unlinked'
           and (
             l.link_state <> 'active'
             or c.id is null
             or c.status <> 'active'
             or c.revoked_at is not null
             or c.last_verified_at is null
             or c.last_verified_at < v_now - interval '15 minutes'
             or (c.sync_due_at is not null and c.sync_due_at <= v_now)
             or c.pull_lease_owner is not null
           )
      );
    end if;

    if v_calendar_backed and not v_calendar_safe and v_hold_unverified then
      update public.scheduled_messages s
         set status = 'held',
             held_reason = 'Calendar verification is pending.',
             held_reason_key = 'calendar_unverified',
             held_at = coalesce(s.held_at, v_now),
             claimed_at = null,
             updated_at = v_now
       where s.id = p_id
      returning * into v_scheduled;
      return jsonb_build_object(
        'outcome', 'held',
        'reason_key', 'calendar_unverified',
        'scheduled_message', to_jsonb(v_scheduled)
      );
    end if;
  end if;

  insert into public.messages
    (company_id, conversation_id, direction, body, status, segments,
     sent_by_user_id)
  values
    (v_scheduled.company_id, v_scheduled.conversation_id, 'outbound',
     v_scheduled.body, 'queued', p_segments_estimate, v_scheduled.created_by)
  returning * into v_message;

  update public.scheduled_messages s
     set status = 'sent',
         sent_message_id = v_message.id,
         held_reason = null,
         held_reason_key = null,
         updated_at = v_now
   where s.id = p_id;

  return jsonb_build_object(
    'outcome', 'fired', 'message', to_jsonb(v_message)
  );
end $$;
