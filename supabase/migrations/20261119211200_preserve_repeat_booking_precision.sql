create function public.record_task_due_day() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.task_events(company_id, task_id, actor_user_id, kind, from_value, to_value)
  values (
    new.company_id, new.id, nullif(current_setting('loonext.task_actor', true), '')::uuid,
    'due', to_jsonb(old.due_on), to_jsonb(new.due_on)
  );
  return new;
end;
$$;

revoke execute on function public.record_task_due_day() from public, anon, authenticated;

create trigger tasks_record_due_day after update of due_on on public.tasks for each row
  when (new.due_on is distinct from old.due_on and new.due_at is not distinct from old.due_at)
  execute function public.record_task_due_day();

do $migration$
declare
  v_series text := pg_get_functiondef('public.api_edit_task_series(uuid,uuid,uuid,jsonb)'::regprocedure);
  v_link text := pg_get_functiondef('public.set_task_links(uuid,uuid,uuid,uuid,uuid)'::regprocedure);
  v_template constant text := 'due_time = coalesce(v_time, due_time),';
  v_occurrence constant text :=
    $sql$due_at = case when v_time is not null and t.due_at is not null
                       then ((t.due_at at time zone s.time_zone)::date + v_time)
                            at time zone s.time_zone
                       else t.due_at end$sql$;
  v_customer constant text := 'set contact_id = v_contact_id, conversation_id = p_conversation_id';
begin
  if strpos(v_series, v_template) = 0 or strpos(v_series, v_occurrence) = 0
     or strpos(v_link, v_customer) = 0 then
    raise exception 'Booking series definition changed';
  end if;
  v_series := replace(v_series, v_template, v_template ||
    $sql$
           due_time_set = case when s.kind = 'schedule' and p_changes->>'due_on' is not null then false
                               when v_time is not null then true else due_time_set end,$sql$);
  execute replace(v_series, v_occurrence,
    $sql$due_at = case when s.kind = 'schedule' and p_changes->>'due_on' is not null then null
                        when v_time is not null then
                          (coalesce(t.due_on, (t.due_at at time zone s.time_zone)::date) + v_time)
                          at time zone s.time_zone
                        else t.due_at end,
           due_on = case when s.kind = 'schedule' and p_changes->>'due_on' is not null then
                           coalesce(t.due_on, (t.due_at at time zone s.time_zone)::date)
                         when v_time is not null then null else t.due_on end$sql$);
  execute replace(v_link,
    v_customer || E'\n   where company_id = p_company_id and id = v_task.series_id;',
    v_customer || E', remind_customer = false\n   where company_id = p_company_id and id = v_task.series_id;');
end $migration$;
