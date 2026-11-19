create table public.calendar_attention_notices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  link_id uuid not null,
  created_at timestamptz not null default now(),
  foreign key (company_id, link_id)
    references public.task_calendar_links(company_id, id) on delete cascade
);
create index calendar_attention_notices_claim_idx on public.calendar_attention_notices (created_at, id);
create index calendar_attention_notices_link_idx on public.calendar_attention_notices (company_id, link_id);
alter table public.calendar_attention_notices enable row level security;
revoke all on public.calendar_attention_notices from public, anon, authenticated;
grant select, insert, delete on public.calendar_attention_notices to service_role;

create function public.calendar_queue_attention_notice() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_current text := case
    when new.link_state = 'conflict' and new.event_removed_at is not null then 'event_removed'
    when new.link_state = 'conflict' and new.refusal_code is not null then 'refused'
    else new.link_state
  end;
  v_previous text := case
    when old.link_state = 'conflict' and old.event_removed_at is not null then 'event_removed'
    when old.link_state = 'conflict' and old.refusal_code is not null then 'refused'
    else old.link_state
  end;
begin
  if v_current in ('event_removed', 'refused') and v_current is distinct from v_previous then
    insert into public.calendar_attention_notices (company_id, link_id)
    values (new.company_id, new.id);
  end if;
  return new;
end;
$$;
revoke execute on function public.calendar_queue_attention_notice() from public, anon, authenticated;

create trigger task_calendar_links_attention_notice
after update of link_state, event_removed_at, refusal_code on public.task_calendar_links
for each row execute function public.calendar_queue_attention_notice();

create function public.api_claim_calendar_attention_notices(p_limit integer default 50)
returns table (company_id uuid, link_id uuid, user_id uuid)
language sql security definer set search_path = '' as $$
  with claimed as (
    delete from public.calendar_attention_notices n
     where n.id in (
       select q.id from public.calendar_attention_notices q
        order by q.created_at, q.id
        limit least(greatest(p_limit, 1), 100)
        for update skip locked
     )
     returning n.company_id, n.link_id
  )
  select n.company_id, n.link_id, c.user_id
    from claimed n
    join public.task_calendar_links l on (l.company_id, l.id) = (n.company_id, n.link_id)
    join public.calendar_connections c on (c.company_id, c.id) = (l.company_id, l.connection_id)
    join public.tasks t on (t.company_id, t.id) = (l.company_id, l.task_id)
    join public.companies w on w.id = n.company_id
   where c.status = 'active' and c.revoked_at is null and w.deleted_at is null
     and t.deleted_at is null and public.calendar_task_access_allowed(c.user_id, t.company_id, t.conversation_id)
     and (l.link_state in ('event_removed', 'refused')
       or (l.link_state = 'conflict' and (l.event_removed_at is not null or l.refusal_code is not null)));
$$;
revoke execute on function public.api_claim_calendar_attention_notices(integer) from public, anon, authenticated;
grant execute on function public.api_claim_calendar_attention_notices(integer) to service_role;
