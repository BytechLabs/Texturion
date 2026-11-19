alter table public.task_series
  add column remind_customer boolean not null default false,
  add column due_time_set boolean not null default true;

create or replace function public.internal_task_reminder_default() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if ((new.message_id is null and new.source_call_id is null) and not exists (
    select 1 from public.task_series s where s.company_id = new.company_id and s.id = new.series_id
      and s.kind = 'schedule' and s.remind_customer and s.conversation_id = new.conversation_id
  )) or exists (
    select 1 from public.messages m where m.id = new.message_id and m.company_id = new.company_id
      and m.direction = 'note'
  ) then
    new.reminders_off := true;
  end if;
  return new;
end;
$$;

create function public.apply_series_reminder_choice(
  p_series public.task_series,
  p_first_occurrence integer,
  p_actor uuid
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_task_id uuid;
  v_enabled boolean := p_series.remind_customer and p_series.kind = 'schedule'
    and p_series.conversation_id is not null;
begin
  for v_task_id in
    update public.tasks t set reminders_off = not v_enabled
     where t.company_id = p_series.company_id and t.series_id = p_series.id
       and t.deleted_at is null and public.task_done_at(t) is null
       and t.occurrence_no >= p_first_occurrence and t.reminders_off = v_enabled
    returning t.id
  loop
    perform public.calendar_enqueue_reminder_replan(p_series.company_id, v_task_id, p_actor);
  end loop;
end;
$$;

revoke execute on function public.apply_series_reminder_choice(public.task_series,integer,uuid)
  from public, anon, authenticated;

do $migration$
declare
  v_spawn text := pg_get_functiondef('public.task_series_spawn(public.task_series,integer,date,timestamptz)'::regprocedure);
  v_rule text := pg_get_functiondef('public.api_set_task_repeat(uuid,uuid,uuid,jsonb)'::regprocedure);
  v_summary text := pg_get_functiondef('public.task_series_summary(public.task_series)'::regprocedure);
  v_spawn_fields constant text := 'due_at, created_by_user_id, priority,';
  v_spawn_value constant text := 'p_due, s.created_by_user_id, s.priority,';
  v_default_off constant text := E'     true,\n     s.id, p_no, p_on)';
  v_spawn_return constant text := 'return v_id;';
  v_anchor constant text := 'when v_task.due_at is not null then';
  v_same_branch constant text := E'    if v_new.kind = ''schedule'' then\n      perform';
  v_new_branch constant text := E'  if v_new.kind = ''schedule'' then\n    perform';
  v_same_paused constant text := $$paused = (v_rule->>'paused')::boolean,$$;
begin
  if strpos(v_spawn, v_spawn_fields) = 0 or strpos(v_spawn, v_spawn_value) = 0
     or strpos(v_spawn, v_default_off) = 0 or strpos(v_spawn, v_spawn_return) = 0
     or strpos(v_rule, v_anchor) = 0 or strpos(v_rule, v_same_branch) = 0
     or strpos(v_rule, v_new_branch) = 0 or strpos(v_rule, v_same_paused) = 0 then
    raise exception 'Repeat definition changed';
  end if;

  v_spawn := replace(v_spawn, v_spawn_fields, 'due_at, due_on, created_by_user_id, priority,');
  v_spawn := replace(v_spawn, v_spawn_value,
    $sql$case when s.due_time_set or s.kind = 'after_done' then p_due end,
     case when not s.due_time_set and s.kind = 'schedule' then p_on end,
     s.created_by_user_id, s.priority,$sql$);
  v_spawn := replace(v_spawn, v_default_off,
    $sql$     not (s.remind_customer and s.kind = 'schedule' and s.conversation_id is not null),
     s.id, p_no, p_on)$sql$);
  execute replace(v_spawn, v_spawn_return,
    $sql$if s.remind_customer and s.kind = 'schedule' and s.conversation_id is not null then
    perform public.calendar_enqueue_reminder_replan(s.company_id, v_id, s.created_by_user_id);
  end if;
  return v_id;$sql$);

  v_rule := replace(v_rule, 'v_anchor date;', E'v_anchor date;\n  v_remind boolean;');
  v_rule := replace(v_rule, v_anchor, 'when v_task.due_on is not null then v_task.due_on when v_task.due_at is not null then');
  v_rule := replace(v_rule, $sql$if v_rule->>'kind' = 'schedule' and v_task.due_at is null then$sql$,
    $sql$v_remind := v_rule->>'kind' = 'schedule' and v_task.conversation_id is not null
    and coalesce((p_repeat->>'remind_customer')::boolean, v_old.remind_customer, false);
  if v_rule->>'kind' = 'schedule' and v_task.due_at is null and v_task.due_on is null then$sql$);
  v_rule := replace(v_rule, v_same_paused, v_same_paused || E'\n           remind_customer = v_remind,');
  v_rule := replace(v_rule, v_same_branch,
    $sql$    if v_old.remind_customer is distinct from v_new.remind_customer then
      perform public.apply_series_reminder_choice(v_new, v_task.occurrence_no, p_actor_user_id);
    end if;
$sql$ || v_same_branch);
  v_rule := replace(v_rule, 'time_zone, due_time, anchor_on,', 'time_zone, due_time, due_time_set, anchor_on, remind_customer,');
  v_rule := replace(v_rule, 'v_anchor, 1, v_anchor,', 'v_task.due_on is null, v_anchor, v_remind, 1, v_anchor,');
  v_rule := replace(v_rule, v_new_branch,
    $sql$  if v_remind or coalesce(v_old.remind_customer, false) then
    perform public.apply_series_reminder_choice(v_new, 1, p_actor_user_id);
  end if;
$sql$ || v_new_branch);
  execute v_rule;
  execute replace(v_summary, $$'paused', s.paused$$, $$'paused', s.paused, 'remind_customer', s.remind_customer$$);
end $migration$;
