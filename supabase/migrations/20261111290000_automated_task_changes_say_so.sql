-- #725: a task change no person made says which automation made it.
--
-- Two writers change tasks with nobody behind them: the calendar sync, which
-- moves a job when it moves in Google Calendar, and the repeat schedule, which
-- creates the next occurrence of a repeating job. Their history rows read as
-- an anonymous "System" edit or, for a repeat, as the member who set up the
-- series, so nobody could tell a job moved itself.
--
-- `task_events.origin` names the automation. It is stamped on insert from the
-- flag the calendar sync already sets for its own writes
-- (`loonext.calendar_provider_apply`) and from the task itself for a spawned
-- occurrence, so no writer has to remember to pass it. The activity row is
-- then the automation's, with the origin in its payload.

alter table public.task_events add column origin text;
alter table public.task_events add constraint task_events_origin_check
  check (origin in ('calendar', 'repeat'));

comment on column public.task_events.origin is
  '#725: the automation behind this change (calendar sync or the repeat schedule); null when a person made it.';

create or replace function public.task_events_stamp_origin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.origin is null then
    if coalesce(current_setting('loonext.calendar_provider_apply', true), '') = 'on' then
      new.origin := 'calendar';
    elsif new.kind = 'created' and exists (
      select 1 from public.tasks t
       where t.id = new.task_id and t.series_id is not null and t.occurrence_no > 1) then
      new.origin := 'repeat';
    end if;
  end if;
  return new;
end $$;

create trigger task_events_stamp_origin
  before insert on public.task_events
  for each row execute function public.task_events_stamp_origin();

do $mig$
declare
  v_def text;
  v_new text;
begin
  v_def := pg_get_functiondef('public.record_activity_task_event(public.task_events)'::regprocedure);
  v_new := replace(v_def,
$n$  perform public.record_activity_add(e.company_id, 'task', e.task_id, v_kind,$n$,
$n$  if e.origin is not null then
    v_payload := v_payload || jsonb_build_object('origin', e.origin);
  end if;
  perform public.record_activity_add(e.company_id, 'task', e.task_id, v_kind,$n$);
  v_new := replace(v_new, $n$e.actor_user_id, 'system',$n$,
    $n$case when e.origin is null then e.actor_user_id end,
      case when e.origin is null then 'system' else 'automation' end,$n$);
  if v_new = v_def or v_new not like '%v_payload || jsonb_build_object(''origin''%' then
    raise exception 'record_activity_task_event: an anchor was not found';
  end if;
  execute v_new;
end $mig$;
