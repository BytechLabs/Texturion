\set ON_ERROR_STOP on
begin;

do $$
declare
  owner_id uuid := gen_random_uuid();
  crew_id uuid := gen_random_uuid();
  company uuid := gen_random_uuid();
  task uuid := gen_random_uuid();
  first_block uuid := gen_random_uuid();
  next_block uuid := gen_random_uuid();
  when_updated timestamptz;
  booked jsonb;
  next_booking jsonb;
  details jsonb;
  result jsonb;
begin
  insert into auth.users(id, email) values
    (owner_id, 'dispatch-owner@example.test'), (crew_id, 'dispatch-crew@example.test');
  insert into public.companies(id, name, owner_user_id, country, requested_area_code, aup_accepted_at, timezone, business_hours)
  values (company, 'Dispatch test', owner_id, 'CA', '416', now(), 'America/Toronto', '{"mon":{"open":"08:00","close":"17:00"}}');
  insert into public.company_members(company_id, user_id, role) values
    (company, owner_id, 'owner'), (company, crew_id, 'member');
  insert into public.tasks(id, company_id, created_by_user_id, title, due_on)
  values (task, company, owner_id, 'Service follow-up', '2026-11-27')
  returning updated_at into when_updated;

  booked := jsonb_build_object('id', first_block, 'task_id', task, 'updated_at', when_updated,
    'assignee_id', crew_id, 'starts_at', '2026-11-23T15:00:00Z', 'ends_at', '2026-11-23T15:40:00Z',
    'remove', false, 'locked', true, 'visit', false, 'confirm_address', false, 'reschedule', false);
  details := jsonb_build_array(jsonb_build_object('task_id', task, 'updated_at', when_updated, 'estimate', 40,
    'windows', '[{"start":"2026-11-23T15:00:00Z","end":"2026-11-23T18:00:00Z"}]'::jsonb));
  if public.api_dispatch_publish(company, owner_id, 0, jsonb_build_array(booked), details) is distinct from 'ok' then
    raise exception 'Could not publish a remote block';
  end if;
  if public.api_dispatch_publish(company, owner_id, 0, '[]', '[]') is distinct from 'stale' then
    raise exception 'A stale revision was accepted';
  end if;

  result := public.api_dispatch_read(company, crew_id, '2026-11-23', 7);
  if (result -> 'blocks' -> 0 ->> 'id')::uuid is distinct from first_block
    or result -> 'tasks' -> 0 ->> 'due_on' is distinct from '2026-11-27'
    or result -> 'tasks' -> 0 -> 'done' is distinct from 'false'::jsonb
    or (result -> 'days' -> 0 ->> 'opens_at')::timestamptz is distinct from '2026-11-23 13:00+00'::timestamptz
  then raise exception 'Published work was missing or changed the task deadline/status: %', result; end if;

  select updated_at into when_updated from public.tasks where id = task;
  booked := booked || jsonb_build_object('updated_at', when_updated);
  if public.api_dispatch_publish(company, owner_id, 1, jsonb_build_array(
    booked || '{"starts_at":"2026-11-23T15:15:00Z","ends_at":"2026-11-23T15:55:00Z"}'), '[]') is distinct from 'locked'
  then raise exception 'A locked block moved without explicit action'; end if;

  next_booking := booked || jsonb_build_object('id', next_block, 'locked', false);
  if public.api_dispatch_publish(company, owner_id, 1, jsonb_build_array(next_booking), '[]') is distinct from 'overlap'
  then raise exception 'A second booking overlapped the first'; end if;
  next_booking := next_booking || '{"starts_at":"2026-11-23T16:00:00Z","ends_at":"2026-11-23T16:40:00Z"}';
  if public.api_dispatch_publish(company, owner_id, 1, jsonb_build_array(next_booking), '[]') is distinct from 'ok'
  then raise exception 'A second booking could not be added to a task'; end if;
  if (select count(*) from public.task_schedule_blocks where task_id = task) is distinct from 2
  then raise exception 'The second booking overwrote the first'; end if;

  if (select count(*) from public.api_task_published_work(company, crew_id, array[task], '2026-11-23', '2026-11-24')) is distinct from 2
  then raise exception 'The task calendar lost a booking'; end if;
  if (select count(*) from public.api_task_published_work(company, crew_id, array[task], '2026-11-27', '2026-11-28')) is distinct from 0
  then raise exception 'The calendar treated a deadline as a booking'; end if;

  if public.api_dispatch_set_shift(company, crew_id, crew_id, 1, null, 2) is distinct from 'not_found'
  then raise exception 'A worker could edit workspace availability'; end if;
  if public.api_dispatch_set_shift(company, owner_id, crew_id, 1,
    '{"start":"09:00","end":"16:00","breaks":[{"start":"11:00","end":"11:45"}]}', 2) is distinct from 'ok'
  then raise exception 'Could not save a shift'; end if;
  if public.api_dispatch_publish(company, owner_id, 2, '[]', '[]') is distinct from 'stale'
  then raise exception 'A shift edit did not invalidate the prior draft'; end if;
  next_booking := next_booking || '{"starts_at":"2026-11-23T16:35:00Z","ends_at":"2026-11-23T17:20:00Z"}';
  if public.api_dispatch_publish(company, owner_id, 3, jsonb_build_array(next_booking), '[]') is distinct from 'hours'
  then raise exception 'A booking crossed the break'; end if;
  if public.dispatch_fits_worker_shift(company, crew_id, '2026-11-23T16:00Z', '2026-11-23T16:40Z') is distinct from false
  then raise exception 'An existing break conflict was not detected'; end if;
  if (select count(*) from public.task_schedule_blocks where task_id = task) is distinct from 2
  then raise exception 'Changing availability altered an existing booking'; end if;

  if public.api_dispatch_read(company, gen_random_uuid(), '2026-11-23', 7) is not null
  then raise exception 'A non-member could see the schedule'; end if;
  if has_table_privilege('authenticated', 'public.task_schedule_blocks', 'select') then
    raise exception 'An authenticated client could bypass schedule authorization'; end if;

  update public.tasks set deleted_at = now(), purged_at = now() where id = task;
  if exists (select 1 from public.task_schedule_blocks where task_id = task) or
    exists (select 1 from public.tasks where id = task and not isempty(dispatch_windows))
  then raise exception 'Task erasure retained its schedule or availability'; end if;
end;
$$;

rollback;
