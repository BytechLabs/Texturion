-- [#689 D] Task subscribers and task notifications.
--
-- Who hears about a task: its creator, its assignee, anyone who commented on it
-- and anyone @mentioned in a comment, plus anyone who pressed Follow. Pressing
-- Unfollow is sticky: a later comment does not bring the person back, but a new
-- assignment or a new mention does, because those are somebody asking for them.
--
-- Three more things live here:
--   * task_notify_windows: the 60-second collapse. One row per (task, actor,
--     recipient, kind); the claim is a single INSERT ... ON CONFLICT, so two
--     Worker isolates racing on the same edit cannot both win.
--   * tasks.overdue_notified_at: the once-only stamp for the overdue push,
--     re-armed whenever the due time or the assignee moves, like due_notified_at.
--   * Every function created here is revoked from public/anon/authenticated
--     before the service_role grant, because a function regains the hosted
--     default grants when it is created.

-- ---------------------------------------------------------------------------
-- 1. Subscribers
-- ---------------------------------------------------------------------------
create table public.task_subscribers (
  company_id      uuid not null references public.companies(id) on delete restrict,
  task_id         uuid not null references public.tasks(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  reason          text not null
    check (reason in ('creator', 'assignee', 'commenter', 'mentioned', 'manual')),
  -- Set = the person unfollowed. The row stays so the unfollow is remembered.
  unsubscribed_at timestamptz,
  created_at      timestamptz not null default now(),
  primary key (task_id, user_id)
);

create index task_subscribers_active_idx
  on public.task_subscribers (company_id, task_id)
  where unsubscribed_at is null;

create index task_subscribers_user_idx
  on public.task_subscribers (company_id, user_id)
  where unsubscribed_at is null;

alter table public.task_subscribers enable row level security;
revoke all on public.task_subscribers from public, anon, authenticated;
grant select, insert, update, delete on public.task_subscribers to service_role;

comment on table public.task_subscribers is
  '#689 D: who follows a task. A row with unsubscribed_at set is a remembered unfollow, so a comment does not re-subscribe the person; an assignment or mention does. Cascades with the task, so the workspace purge reaches it through tasks.';

-- ---------------------------------------------------------------------------
-- 2. Follow and unfollow
-- ---------------------------------------------------------------------------
-- p_resubscribe true = somebody asked for this person (an assignment, a mention,
-- the person pressing Follow): it lifts an earlier unfollow. False = an ambient
-- reason (creating the task, commenting): it never overrides an unfollow.
create or replace function public.task_subscribe(
  p_company_id  uuid,
  p_task_id     uuid,
  p_user_id     uuid,
  p_reason      text,
  p_resubscribe boolean
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null then
    return;
  end if;

  insert into public.task_subscribers (company_id, task_id, user_id, reason)
  select t.company_id, t.id, p_user_id, p_reason
    from public.tasks t
   where t.id = p_task_id
     and t.company_id = p_company_id
  on conflict (task_id, user_id) do update
     set reason = excluded.reason,
         unsubscribed_at = null
   where p_resubscribe
     and public.task_subscribers.unsubscribed_at is not null;
end $$;

revoke execute on function public.task_subscribe(uuid, uuid, uuid, text, boolean)
  from public, anon, authenticated;
grant execute on function public.task_subscribe(uuid, uuid, uuid, text, boolean)
  to service_role;

-- Unfollowing someone who never followed still records the unfollow, so a later
-- comment cannot subscribe a person who has said no.
create or replace function public.task_unsubscribe(
  p_company_id uuid,
  p_task_id    uuid,
  p_user_id    uuid
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.task_subscribers
    (company_id, task_id, user_id, reason, unsubscribed_at)
  select t.company_id, t.id, p_user_id, 'manual', now()
    from public.tasks t
   where t.id = p_task_id
     and t.company_id = p_company_id
  on conflict (task_id, user_id) do update
     set unsubscribed_at = coalesce(
           public.task_subscribers.unsubscribed_at, excluded.unsubscribed_at);
end $$;

revoke execute on function public.task_unsubscribe(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.task_unsubscribe(uuid, uuid, uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- 3. Automatic subscription, by trigger so every writer obeys it
-- ---------------------------------------------------------------------------
create or replace function public.task_subscribers_on_task()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform public.task_subscribe(
      new.company_id, new.id, new.created_by_user_id, 'creator', false);
  end if;
  perform public.task_subscribe(
    new.company_id, new.id, new.assigned_user_id, 'assignee', true);
  return null;
end $$;

revoke execute on function public.task_subscribers_on_task()
  from public, anon, authenticated;

create trigger task_subscribers_on_task_insert
  after insert on public.tasks
  for each row execute function public.task_subscribers_on_task();

create trigger task_subscribers_on_task_assign
  after update of assigned_user_id on public.tasks
  for each row
  when (old.assigned_user_id is distinct from new.assigned_user_id)
  execute function public.task_subscribers_on_task();

create or replace function public.task_subscribers_on_comment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.task_subscribe(
    new.company_id, new.task_id, new.author_user_id, 'commenter', false);
  return null;
end $$;

revoke execute on function public.task_subscribers_on_comment()
  from public, anon, authenticated;

create trigger task_subscribers_on_comment
  after insert on public.task_comments
  for each row execute function public.task_subscribers_on_comment();

-- Tasks that already exist: their creator and assignee follow them from now on.
insert into public.task_subscribers (company_id, task_id, user_id, reason)
select t.company_id, t.id, t.created_by_user_id, 'creator'
  from public.tasks t
 where t.deleted_at is null
   and t.created_by_user_id is not null
on conflict (task_id, user_id) do nothing;

insert into public.task_subscribers (company_id, task_id, user_id, reason)
select t.company_id, t.id, t.assigned_user_id, 'assignee'
  from public.tasks t
 where t.deleted_at is null
   and t.assigned_user_id is not null
on conflict (task_id, user_id) do nothing;

-- ---------------------------------------------------------------------------
-- 4. The 60-second collapse
-- ---------------------------------------------------------------------------
create table public.task_notify_windows (
  company_id        uuid not null references public.companies(id) on delete restrict,
  task_id           uuid not null references public.tasks(id) on delete cascade,
  actor_user_id     uuid not null references auth.users(id) on delete cascade,
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  kind              text not null,
  window_until      timestamptz not null,
  primary key (task_id, actor_user_id, recipient_user_id, kind)
);

alter table public.task_notify_windows enable row level security;
revoke all on public.task_notify_windows from public, anon, authenticated;
grant select, insert, update, delete on public.task_notify_windows to service_role;

comment on table public.task_notify_windows is
  '#689 D: one row per (task, actor, recipient, kind) that was pushed, holding when its 60-second collapse window closes. Written only by task_notify_claim. Cascades with the task.';

-- Returns the recipients who WON the window: the ones to push now. A recipient
-- already pushed for the same actor, task and kind inside the window is left
-- out. One statement, so the row lock on the conflicting key serialises two
-- isolates and the loser re-reads the winner's window_until.
create or replace function public.task_notify_claim(
  p_company_id     uuid,
  p_task_id        uuid,
  p_actor_user_id  uuid,
  p_kind           text,
  p_recipients     uuid[],
  p_window_seconds int default 60
) returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_won uuid[];
begin
  delete from public.task_notify_windows w
   where w.task_id = p_task_id
     and w.window_until < clock_timestamp() - interval '1 hour';

  with won as (
    insert into public.task_notify_windows
      (company_id, task_id, actor_user_id, recipient_user_id, kind, window_until)
    select t.company_id, t.id, p_actor_user_id, r.user_id, p_kind,
           clock_timestamp() + make_interval(secs => p_window_seconds)
      from public.tasks t
      cross join (select distinct unnest(p_recipients) as user_id) r
     where t.id = p_task_id
       and t.company_id = p_company_id
    on conflict (task_id, actor_user_id, recipient_user_id, kind) do update
       set window_until = excluded.window_until
     where public.task_notify_windows.window_until <= clock_timestamp()
    returning recipient_user_id
  )
  select coalesce(array_agg(recipient_user_id), '{}'::uuid[])
    into v_won
    from won;

  return v_won;
end $$;

revoke execute on function public.task_notify_claim(uuid, uuid, uuid, text, uuid[], int)
  from public, anon, authenticated;
grant execute on function public.task_notify_claim(uuid, uuid, uuid, text, uuid[], int)
  to service_role;

-- ---------------------------------------------------------------------------
-- 5. Overdue, once per due time
-- ---------------------------------------------------------------------------
alter table public.tasks
  add column if not exists overdue_notified_at timestamptz;

comment on column public.tasks.overdue_notified_at is
  '#689 D: stamped when the overdue push was claimed. Cleared by tasks_rearm_due_notice when the due time or the assignee changes, so a rescheduled or reassigned job can go overdue again.';

create index if not exists tasks_overdue_pending_idx
  on public.tasks (due_at)
  where overdue_notified_at is null
    and due_at is not null
    and deleted_at is null;

create or replace function public.tasks_rearm_due_notice()
returns trigger
language plpgsql
as $$
begin
  if new.due_at is distinct from old.due_at
     or new.assigned_user_id is distinct from old.assigned_user_id then
    new.due_notified_at := null;
    new.overdue_notified_at := null;
  end if;
  return new;
end;
$$;

revoke all on function public.tasks_rearm_due_notice() from public, anon, authenticated;
