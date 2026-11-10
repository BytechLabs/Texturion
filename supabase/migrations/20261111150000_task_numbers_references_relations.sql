-- #690: a task has a number, can be referenced from notes, descriptions and
-- comments, and can be blocked by or the parent of another task.
--
-- NUMBERS. tasks.number is the short human number per workspace (T-142). It is
-- taken from task_counters, a monotonic per-company counter that only ever goes
-- up, so a deleted or purged task keeps its number and nothing reuses it. A
-- BEFORE INSERT trigger assigns it on every insert path (the RPCs, the repeat
-- spawner, a restore), so no writer can forget; a second trigger refuses any
-- later change. Existing tasks are numbered in creation order.
--
-- REFERENCES. record_references is one row per (source, target). The source is
-- a note, a task description or a task comment; the target is a task, a contact
-- or a conversation. They are parsed from the SAVED TEXT by api_sync_references
-- (#T-142, #contact-1a2b3c4d, #conv-1a2b3c4d), so the text is the truth and an
-- edit that removes a token removes the reference. Nothing parses the text of a
-- customer-facing message.
--
-- A back-reference is visible to a member only if the source's own conversation
-- is on a number the member may see. source_number_id keeps that number on the
-- row for the list filter that cannot join; the readers re-derive it live.
--
-- RELATIONS. task_links holds blocked-by/blocks ('blocks', from blocks to) and
-- parent/sub-task ('parent', from is the parent of to). Done stays per task. A
-- cycle is refused by the function and, as a floor, by a trigger.

-- ---------------------------------------------------------------------------
-- 1. Task numbers
-- ---------------------------------------------------------------------------
create table public.task_counters (
  company_id  uuid primary key references public.companies(id) on delete restrict,
  last_number integer not null default 0 check (last_number >= 0)
);

alter table public.task_counters enable row level security;
revoke all on public.task_counters from public, anon, authenticated;
grant select, insert, update, delete on public.task_counters to service_role;

comment on table public.task_counters is
  '#690: the last task number handed out per workspace. Only ever goes up, so a number is never reused, even after the task is deleted or purged.';

alter table public.tasks add column number integer;

-- The backfill is not a change anybody made: keep the history, the calendar
-- and the broadcast quiet.
alter table public.tasks disable trigger user;

update public.tasks t
   set number = r.rn
  from (select id, row_number() over (
                  partition by company_id order by created_at, id)::int as rn
          from public.tasks) r
 where r.id = t.id;

alter table public.tasks enable trigger user;

insert into public.task_counters (company_id, last_number)
select company_id, max(number) from public.tasks group by company_id;

-- destructive-ok: every existing row was numbered by the update above, in the same transaction.
alter table public.tasks alter column number set not null;
create unique index tasks_company_number_uq on public.tasks (company_id, number);

comment on column public.tasks.number is
  '#690: the per-workspace task number shown as T-<number>. Assigned on insert, never changed, never reused.';

create or replace function public.tasks_assign_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_number integer;
begin
  insert into public.task_counters as c (company_id, last_number)
  values (new.company_id, 1)
  on conflict (company_id)
    do update set last_number = c.last_number + 1
  returning c.last_number into v_number;
  new.number := v_number;
  return new;
end $$;

create or replace function public.tasks_keep_number()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.number is distinct from old.number then
    raise exception 'a task number never changes' using errcode = 'check_violation';
  end if;
  return new;
end $$;

revoke all on function public.tasks_assign_number() from public, anon, authenticated;
revoke all on function public.tasks_keep_number() from public, anon, authenticated;

create trigger tasks_assign_number
  before insert on public.tasks
  for each row execute function public.tasks_assign_number();
create trigger tasks_keep_number
  before update of number on public.tasks
  for each row execute function public.tasks_keep_number();

-- ---------------------------------------------------------------------------
-- 2. References
-- ---------------------------------------------------------------------------
create table public.record_references (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references public.companies(id) on delete restrict,
  source_kind           text not null
    check (source_kind in ('note', 'task_description', 'task_comment')),
  source_id             uuid not null,
  -- The row the source lives on, for the cascade: a note's message, or the
  -- task whose description or comment it is.
  source_message_id     uuid references public.messages(id) on delete cascade,
  source_task_id        uuid references public.tasks(id) on delete cascade,
  -- The number of the source's conversation when it was written; null when the
  -- source has none. A filter that cannot join reads this.
  source_number_id      uuid,
  target_kind           text not null
    check (target_kind in ('task', 'contact', 'conversation')),
  target_task_id        uuid references public.tasks(id) on delete cascade,
  target_contact_id     uuid references public.contacts(id) on delete cascade,
  target_conversation_id uuid references public.conversations(id) on delete cascade,
  created_by            uuid references auth.users(id) on delete set null,
  created_at            timestamptz not null default now(),
  check ((source_kind = 'note' and source_message_id is not null)
      or (source_kind in ('task_description', 'task_comment') and source_task_id is not null)),
  check ((target_kind = 'task' and target_task_id is not null
          and target_contact_id is null and target_conversation_id is null)
      or (target_kind = 'contact' and target_contact_id is not null
          and target_task_id is null and target_conversation_id is null)
      or (target_kind = 'conversation' and target_conversation_id is not null
          and target_task_id is null and target_contact_id is null))
);

create unique index record_references_uq
  on public.record_references
  (source_kind, source_id, target_kind,
   coalesce(target_task_id, target_contact_id, target_conversation_id));
create index record_references_task_idx
  on public.record_references (company_id, target_task_id, created_at desc)
  where target_task_id is not null;
create index record_references_contact_idx
  on public.record_references (company_id, target_contact_id)
  where target_contact_id is not null;
create index record_references_conversation_idx
  on public.record_references (company_id, target_conversation_id)
  where target_conversation_id is not null;
create index record_references_source_idx
  on public.record_references (source_kind, source_id);
create index record_references_message_idx
  on public.record_references (source_message_id) where source_message_id is not null;
create index record_references_source_task_idx
  on public.record_references (source_task_id) where source_task_id is not null;

alter table public.record_references enable row level security;
revoke all on public.record_references from public, anon, authenticated;
grant select, insert, update, delete on public.record_references to service_role;

comment on table public.record_references is
  '#690: where a note, task description or task comment points at a task, contact or conversation, parsed from the saved text by api_sync_references. Cascades with the source and the target.';

-- ---------------------------------------------------------------------------
-- 3. Relations between tasks
-- ---------------------------------------------------------------------------
create table public.task_links (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete restrict,
  kind         text not null check (kind in ('blocks', 'parent')),
  -- 'blocks': from_task blocks to_task. 'parent': from_task is the parent of to_task.
  from_task_id uuid not null references public.tasks(id) on delete cascade,
  to_task_id   uuid not null references public.tasks(id) on delete cascade,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  check (from_task_id <> to_task_id)
);

create unique index task_links_uq on public.task_links (kind, from_task_id, to_task_id);
-- A sub-task has one parent.
create unique index task_links_one_parent_uq
  on public.task_links (to_task_id) where kind = 'parent';
create index task_links_to_idx on public.task_links (company_id, to_task_id);
create index task_links_from_idx on public.task_links (company_id, from_task_id);

alter table public.task_links enable row level security;
revoke all on public.task_links from public, anon, authenticated;
grant select, insert, update, delete on public.task_links to service_role;

comment on table public.task_links is
  '#690: blocked-by/blocks and parent/sub-task between two tasks of one workspace. Done stays per task; a parent never completes by itself.';

-- Would from -> to close a loop of this kind?  True when `from` is already
-- reachable from `to`.
create or replace function public.task_link_would_cycle(
  p_kind text, p_from uuid, p_to uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  with recursive walk(task_id) as (
    select p_to
    union
    select l.to_task_id
      from public.task_links l
      join walk w on w.task_id = l.from_task_id
     where l.kind = p_kind
  )
  select exists (select 1 from walk where task_id = p_from)
$$;

create or replace function public.task_links_refuse_cycle()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.from_task_id = new.to_task_id
     or public.task_link_would_cycle(new.kind, new.from_task_id, new.to_task_id) then
    raise exception 'a task link may not form a cycle' using errcode = 'check_violation';
  end if;
  if (select a.company_id from public.tasks a where a.id = new.from_task_id)
     is distinct from new.company_id
     or (select b.company_id from public.tasks b where b.id = new.to_task_id)
     is distinct from new.company_id then
    raise exception 'a task link stays inside one workspace' using errcode = 'check_violation';
  end if;
  return new;
end $$;

revoke all on function public.task_link_would_cycle(text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.task_link_would_cycle(text, uuid, uuid) to service_role;
revoke all on function public.task_links_refuse_cycle() from public, anon, authenticated;

create trigger task_links_refuse_cycle
  before insert on public.task_links
  for each row execute function public.task_links_refuse_cycle();

alter table public.task_events drop constraint task_events_kind_check;
alter table public.task_events add constraint task_events_kind_check
  check (kind in (
    'created', 'title', 'description', 'address', 'assignee', 'due',
    'reminders', 'confirmation', 'done', 'reopened', 'deleted',
    'priority', 'label_added', 'label_removed', 'repeat',
    'assignee_added', 'assignee_removed',
    'link_added', 'link_removed'));

-- ---------------------------------------------------------------------------
-- 4. api_sync_references: replace one source's references with what its text
--    now says. Tokens: #T-142, #contact-1a2b3c4d, #conv-1a2b3c4d (the first
--    eight hex digits of the id). A target the actor may not see is dropped, so
--    a reference never confirms that a hidden thing exists.
-- ---------------------------------------------------------------------------
create or replace function public.api_sync_references(
  p_company_id        uuid,
  p_source_kind       text,
  p_source_id         uuid,
  p_text              text,
  p_actor_user_id     uuid default null,
  p_hidden_number_ids uuid[] default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_message_id uuid;
  v_task_id    uuid;
  v_conv_id    uuid;
  v_number_id  uuid;
  v_hit        text[];
  v_count      int := 0;
  v_target     uuid;
  v_out        jsonb := '[]'::jsonb;
  v_hex        text;
begin
  if p_source_kind = 'note' then
    select m.id, m.conversation_id into v_message_id, v_conv_id
      from public.messages m
     where m.id = p_source_id and m.company_id = p_company_id
       and m.direction = 'note' and m.deleted_at is null;
  elsif p_source_kind = 'task_description' then
    select t.id, t.conversation_id into v_task_id, v_conv_id
      from public.tasks t
     where t.id = p_source_id and t.company_id = p_company_id and t.deleted_at is null;
  elsif p_source_kind = 'task_comment' then
    select k.task_id, t.conversation_id into v_task_id, v_conv_id
      from public.task_comments k
      join public.tasks t on t.id = k.task_id
     where k.id = p_source_id and k.company_id = p_company_id and k.deleted_at is null;
  else
    return jsonb_build_object('outcome', 'invalid');
  end if;
  if v_message_id is null and v_task_id is null then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  if v_conv_id is not null then
    select c.phone_number_id into v_number_id
      from public.conversations c where c.id = v_conv_id;
  end if;

  delete from public.record_references
   where source_kind = p_source_kind and source_id = p_source_id;

  for v_hit in
    select m
      from regexp_matches(
             coalesce(p_text, ''),
             '(?:^|[^A-Za-z0-9#])#(?:T-([0-9]{1,9})|contact-([0-9a-f]{8})|conv-([0-9a-f]{8}))(?![A-Za-z0-9])',
             'gi') as m
  loop
    exit when v_count >= 25;
    v_target := null;

    if v_hit[1] is not null then
      select t.id into v_target
        from public.tasks t
        left join public.conversations tc on tc.id = t.conversation_id
       where t.company_id = p_company_id
         and t.number = v_hit[1]::int
         and t.deleted_at is null
         and t.id is distinct from v_task_id
         and (p_hidden_number_ids is null
              or tc.phone_number_id is null
              or not (tc.phone_number_id = any (p_hidden_number_ids)));
      if v_target is not null then
        insert into public.record_references
          (company_id, source_kind, source_id, source_message_id, source_task_id,
           source_number_id, target_kind, target_task_id, created_by)
        values (p_company_id, p_source_kind, p_source_id, v_message_id, v_task_id,
                v_number_id, 'task', v_target, p_actor_user_id)
        on conflict do nothing;
        v_out := v_out || jsonb_build_object('kind', 'task', 'id', v_target);
      end if;

    elsif v_hit[2] is not null then
      v_hex := lower(v_hit[2]);
      select ct.id into v_target
        from public.contacts ct
       where ct.company_id = p_company_id and ct.deleted_at is null
         and ct.id >= (v_hex || '-0000-0000-0000-000000000000')::uuid
         and ct.id <= (v_hex || '-ffff-ffff-ffff-ffffffffffff')::uuid
       limit 1;
      if v_target is not null then
        insert into public.record_references
          (company_id, source_kind, source_id, source_message_id, source_task_id,
           source_number_id, target_kind, target_contact_id, created_by)
        values (p_company_id, p_source_kind, p_source_id, v_message_id, v_task_id,
                v_number_id, 'contact', v_target, p_actor_user_id)
        on conflict do nothing;
        v_out := v_out || jsonb_build_object('kind', 'contact', 'id', v_target);
      end if;

    else
      v_hex := lower(v_hit[3]);
      select c.id into v_target
        from public.conversations c
       where c.company_id = p_company_id and c.deleted_at is null
         and c.id >= (v_hex || '-0000-0000-0000-000000000000')::uuid
         and c.id <= (v_hex || '-ffff-ffff-ffff-ffffffffffff')::uuid
         and (p_hidden_number_ids is null
              or c.phone_number_id is null
              or not (c.phone_number_id = any (p_hidden_number_ids)))
       limit 1;
      if v_target is not null then
        insert into public.record_references
          (company_id, source_kind, source_id, source_message_id, source_task_id,
           source_number_id, target_kind, target_conversation_id, created_by)
        values (p_company_id, p_source_kind, p_source_id, v_message_id, v_task_id,
                v_number_id, 'conversation', v_target, p_actor_user_id)
        on conflict do nothing;
        v_out := v_out || jsonb_build_object('kind', 'conversation', 'id', v_target);
      end if;
    end if;
    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('outcome', 'ok', 'references', v_out);
end $$;

revoke execute on function public.api_sync_references(uuid, text, uuid, text, uuid, uuid[])
  from public, anon, authenticated;
grant execute on function public.api_sync_references(uuid, text, uuid, text, uuid, uuid[])
  to service_role;

-- ---------------------------------------------------------------------------
-- 5. api_task_activity: the same timeline, plus where the task is referenced
--    (and what it points at). Restated from 20261110160000 with one added arm.
-- ---------------------------------------------------------------------------
create or replace function public.api_task_activity(
  p_company_id        uuid,
  p_task_id           uuid,
  p_hidden_number_ids uuid[] default null,
  p_limit             int default 50,
  p_before_ts         timestamptz default null,
  p_before_id         uuid default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_visible boolean;
  v_items   jsonb;
begin
  select true
    into v_visible
    from public.tasks t
    left join public.conversations c on c.id = t.conversation_id
   where t.company_id = p_company_id
     and t.id = p_task_id
     and t.deleted_at is null
     and (
       p_hidden_number_ids is null
       or array_length(p_hidden_number_ids, 1) is null
       or c.phone_number_id is null
       or not (c.phone_number_id = any(p_hidden_number_ids)));
  if v_visible is not true then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  with entries as (
    select 'event'::text as kind, e.id, e.created_at as at,
           e.actor_user_id as user_id,
           jsonb_build_object('event', e.kind, 'from', e.from_value,
                              'to', e.to_value) as detail
      from public.task_events e
     where e.company_id = p_company_id
       and e.task_id = p_task_id
    union all
    select 'comment', k.id, k.created_at, k.author_user_id,
           jsonb_build_object('body', k.body, 'edited_at', k.edited_at)
      from public.task_comments k
     where k.company_id = p_company_id
       and k.task_id = p_task_id
       and k.deleted_at is null
    union all
    select 'note', m.id, m.created_at, m.sent_by_user_id,
           jsonb_build_object('body', m.body)
      from public.messages m
     where m.company_id = p_company_id
       and m.task_id = p_task_id
       and m.direction = 'note'
    union all
    -- Back-references: somewhere else points at this task. The source's own
    -- conversation must be on a number the caller may see, or the row is not
    -- there at all.
    select 'reference', r.id, r.created_at, r.created_by,
           jsonb_build_object(
             'direction', 'in',
             'source_kind', r.source_kind,
             'source_id', r.source_id,
             'conversation_id', sc.id,
             'contact_id', sct.id,
             'contact_name', sct.name,
             'task_id', st.id,
             'task_number', st.number,
             'task_title', st.title)
      from public.record_references r
      left join public.messages sm
             on r.source_kind = 'note' and sm.id = r.source_message_id
      left join public.task_comments sk
             on r.source_kind = 'task_comment' and sk.id = r.source_id
      left join public.tasks st on st.id = r.source_task_id
      left join public.conversations sc on sc.id = coalesce(sm.conversation_id, st.conversation_id)
      left join public.contacts sct on sct.id = sc.contact_id
     where r.company_id = p_company_id
       and r.target_task_id = p_task_id
       and (r.source_kind <> 'note' or (sm.id is not null and sm.deleted_at is null))
       and (r.source_kind <> 'task_comment' or (sk.id is not null and sk.deleted_at is null))
       and (r.source_task_id is null or st.deleted_at is null)
       and (sc.id is null or sc.deleted_at is null)
       and (p_hidden_number_ids is null
            or sc.phone_number_id is null
            or not (sc.phone_number_id = any(p_hidden_number_ids)))
    union all
    -- What this task points at: "Linked to contact Jane Smith".
    select 'reference', r.id, r.created_at, r.created_by,
           jsonb_build_object(
             'direction', 'out',
             'source_kind', r.source_kind,
             'source_id', r.source_id,
             'target_kind', r.target_kind,
             'conversation_id', tc.id,
             'contact_id', coalesce(tct.id, cc.id),
             'contact_name', coalesce(tct.name, cc.name),
             'task_id', tt.id,
             'task_number', tt.number,
             'task_title', tt.title)
      from public.record_references r
      left join public.tasks tt on tt.id = r.target_task_id
      left join public.conversations tc on tc.id = r.target_conversation_id
      left join public.contacts tct on tct.id = tc.contact_id
      left join public.contacts cc on cc.id = r.target_contact_id
      left join public.conversations ttc on ttc.id = tt.conversation_id
     where r.company_id = p_company_id
       and r.source_task_id = p_task_id
       and (r.source_kind <> 'task_comment' or exists (
              select 1 from public.task_comments k
               where k.id = r.source_id and k.deleted_at is null))
       and (tt.id is null or tt.deleted_at is null)
       and (tc.id is null or tc.deleted_at is null)
       and (cc.id is null or cc.deleted_at is null)
       and (p_hidden_number_ids is null
            or (coalesce(tc.phone_number_id, ttc.phone_number_id) is null
                or not (coalesce(tc.phone_number_id, ttc.phone_number_id)
                        = any(p_hidden_number_ids))))
  ),
  page as (
    select *
      from entries e
     where p_before_ts is null
        or (e.at, e.id) < (p_before_ts, p_before_id)
     order by e.at desc, e.id desc
     limit greatest(1, least(coalesce(p_limit, 50), 201))
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'kind', p.kind, 'id', p.id, 'at', p.at, 'user_id', p.user_id,
           'detail', p.detail) order by p.at desc, p.id desc), '[]'::jsonb)
    into v_items
    from page p;

  return jsonb_build_object('outcome', 'ok', 'items', v_items);
end $$;

revoke execute on function public.api_task_activity(
  uuid, uuid, uuid[], int, timestamptz, uuid)
  from public, anon, authenticated;
grant execute on function public.api_task_activity(
  uuid, uuid, uuid[], int, timestamptz, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 6. Relations: set, and read.
-- ---------------------------------------------------------------------------
create or replace function public.api_set_task_link(
  p_company_id        uuid,
  p_task_id           uuid,
  p_other_task_id     uuid,
  p_relation          text,
  p_add               boolean,
  p_actor_user_id     uuid default null,
  p_hidden_number_ids uuid[] default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind    text;
  v_from    uuid;
  v_to      uuid;
  v_a       record;
  v_b       record;
  v_link    uuid;
  v_inverse text;
begin
  if p_relation not in ('blocked_by', 'blocks', 'parent', 'sub_task') then
    return jsonb_build_object('outcome', 'invalid');
  end if;
  if p_task_id = p_other_task_id then
    return jsonb_build_object('outcome', 'invalid');
  end if;

  select t.id, t.number, t.title into v_a
    from public.tasks t
    left join public.conversations c on c.id = t.conversation_id
   where t.company_id = p_company_id and t.id = p_task_id and t.deleted_at is null
     and (p_hidden_number_ids is null or c.phone_number_id is null
          or not (c.phone_number_id = any (p_hidden_number_ids)));
  select t.id, t.number, t.title into v_b
    from public.tasks t
    left join public.conversations c on c.id = t.conversation_id
   where t.company_id = p_company_id and t.id = p_other_task_id and t.deleted_at is null
     and (p_hidden_number_ids is null or c.phone_number_id is null
          or not (c.phone_number_id = any (p_hidden_number_ids)));
  if v_a.id is null or v_b.id is null then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  if p_relation = 'blocked_by' then
    v_kind := 'blocks'; v_from := p_other_task_id; v_to := p_task_id; v_inverse := 'blocks';
  elsif p_relation = 'blocks' then
    v_kind := 'blocks'; v_from := p_task_id; v_to := p_other_task_id; v_inverse := 'blocked_by';
  elsif p_relation = 'parent' then
    v_kind := 'parent'; v_from := p_other_task_id; v_to := p_task_id; v_inverse := 'sub_task';
  else
    v_kind := 'parent'; v_from := p_task_id; v_to := p_other_task_id; v_inverse := 'parent';
  end if;

  select l.id into v_link from public.task_links l
   where l.kind = v_kind and l.from_task_id = v_from and l.to_task_id = v_to;

  if p_add then
    if v_link is not null then
      return jsonb_build_object('outcome', 'unchanged');
    end if;
    if public.task_link_would_cycle(v_kind, v_from, v_to) then
      return jsonb_build_object('outcome', 'cycle');
    end if;
    if v_kind = 'parent' and exists (
         select 1 from public.task_links l where l.kind = 'parent' and l.to_task_id = v_to) then
      return jsonb_build_object('outcome', 'has_parent');
    end if;
    if (select count(*) from public.task_links l
         where l.from_task_id = p_task_id or l.to_task_id = p_task_id) >= 50
       or (select count(*) from public.task_links l
            where l.from_task_id = p_other_task_id or l.to_task_id = p_other_task_id) >= 50 then
      return jsonb_build_object('outcome', 'too_many');
    end if;
    insert into public.task_links (company_id, kind, from_task_id, to_task_id, created_by)
    values (p_company_id, v_kind, v_from, v_to, p_actor_user_id);
    insert into public.task_events (company_id, task_id, actor_user_id, kind, to_value)
    values
      (p_company_id, p_task_id, p_actor_user_id, 'link_added',
       jsonb_build_object('relation', p_relation, 'task_id', v_b.id,
                          'number', v_b.number, 'title', v_b.title)),
      (p_company_id, p_other_task_id, p_actor_user_id, 'link_added',
       jsonb_build_object('relation', v_inverse, 'task_id', v_a.id,
                          'number', v_a.number, 'title', v_a.title));
    return jsonb_build_object('outcome', 'ok');
  end if;

  if v_link is null then
    return jsonb_build_object('outcome', 'unchanged');
  end if;
  delete from public.task_links where id = v_link;
  insert into public.task_events (company_id, task_id, actor_user_id, kind, from_value)
  values
    (p_company_id, p_task_id, p_actor_user_id, 'link_removed',
     jsonb_build_object('relation', p_relation, 'task_id', v_b.id,
                        'number', v_b.number, 'title', v_b.title)),
    (p_company_id, p_other_task_id, p_actor_user_id, 'link_removed',
     jsonb_build_object('relation', v_inverse, 'task_id', v_a.id,
                        'number', v_a.number, 'title', v_a.title));
  return jsonb_build_object('outcome', 'ok');
end $$;

revoke execute on function public.api_set_task_link(
  uuid, uuid, uuid, text, boolean, uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.api_set_task_link(
  uuid, uuid, uuid, text, boolean, uuid, uuid[]) to service_role;

create or replace function public.api_task_links(
  p_company_id        uuid,
  p_task_id           uuid,
  p_hidden_number_ids uuid[] default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_visible boolean;
  v_items   jsonb;
begin
  select true into v_visible
    from public.tasks t
    left join public.conversations c on c.id = t.conversation_id
   where t.company_id = p_company_id and t.id = p_task_id and t.deleted_at is null
     and (p_hidden_number_ids is null or c.phone_number_id is null
          or not (c.phone_number_id = any (p_hidden_number_ids)));
  if v_visible is not true then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'relation', x.relation,
           'task_id', x.id, 'number', x.number, 'title', x.title,
           'done', x.done) order by x.relation, x.number), '[]'::jsonb)
    into v_items
    from (
      select case when l.kind = 'blocks' and l.to_task_id = p_task_id then 'blocked_by'
                  when l.kind = 'blocks' then 'blocks'
                  when l.to_task_id = p_task_id then 'parent'
                  else 'sub_task' end as relation,
             o.id, o.number, o.title,
             (coalesce(om.done_at, o.done_at) is not null) as done
        from public.task_links l
        join public.tasks o
          on o.id = case when l.from_task_id = p_task_id then l.to_task_id
                         else l.from_task_id end
        left join public.messages om on om.id = o.message_id
        left join public.conversations oc on oc.id = o.conversation_id
       where l.company_id = p_company_id
         and (l.from_task_id = p_task_id or l.to_task_id = p_task_id)
         and o.deleted_at is null
         and (p_hidden_number_ids is null or oc.phone_number_id is null
              or not (oc.phone_number_id = any (p_hidden_number_ids)))
    ) x;

  return jsonb_build_object('outcome', 'ok', 'items', v_items);
end $$;

revoke execute on function public.api_task_links(uuid, uuid, uuid[])
  from public, anon, authenticated;
grant execute on function public.api_task_links(uuid, uuid, uuid[]) to service_role;

-- ---------------------------------------------------------------------------
-- 7. A conversation or contact lists its linked tasks: tasks anchored to it,
--    tasks its notes mention, tasks whose text points at it.
-- ---------------------------------------------------------------------------
create or replace function public.api_linked_tasks(
  p_company_id        uuid,
  p_kind              text,
  p_id                uuid,
  p_hidden_number_ids uuid[] default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_items jsonb;
begin
  if p_kind = 'conversation' then
    if not exists (
         select 1 from public.conversations c
          where c.id = p_id and c.company_id = p_company_id and c.deleted_at is null
            and (p_hidden_number_ids is null or c.phone_number_id is null
                 or not (c.phone_number_id = any (p_hidden_number_ids)))) then
      return jsonb_build_object('outcome', 'not_found');
    end if;
  elsif p_kind = 'contact' then
    if not exists (
         select 1 from public.contacts ct
          where ct.id = p_id and ct.company_id = p_company_id and ct.deleted_at is null) then
      return jsonb_build_object('outcome', 'not_found');
    end if;
  else
    return jsonb_build_object('outcome', 'invalid');
  end if;

  with linked as (
    select t.id as task_id, 'anchored'::text as how
      from public.tasks t
      left join public.conversations c on c.id = t.conversation_id
     where t.company_id = p_company_id and t.deleted_at is null
       and ((p_kind = 'conversation' and t.conversation_id = p_id)
         or (p_kind = 'contact' and (t.contact_id = p_id or c.contact_id = p_id)))
    union all
    -- A note on the thread points at the task.
    select r.target_task_id, 'mentioned'
      from public.record_references r
      join public.messages m on m.id = r.source_message_id
      join public.conversations c on c.id = m.conversation_id
     where r.company_id = p_company_id and r.source_kind = 'note'
       and r.target_task_id is not null and m.deleted_at is null
       and ((p_kind = 'conversation' and c.id = p_id)
         or (p_kind = 'contact' and c.contact_id = p_id))
    union all
    -- The task's own text points at the thread or the person.
    select r.source_task_id, 'points_at'
      from public.record_references r
     where r.company_id = p_company_id and r.source_task_id is not null
       and ((p_kind = 'conversation' and r.target_conversation_id = p_id)
         or (p_kind = 'contact' and r.target_contact_id = p_id))
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', x.id, 'number', x.number, 'title', x.title, 'done', x.done,
           'due_at', x.due_at, 'how', x.how) order by x.number desc), '[]'::jsonb)
    into v_items
    from (
      select t.id, t.number, t.title, t.due_at,
             (coalesce(tm.done_at, t.done_at) is not null) as done,
             (select jsonb_agg(distinct l.how) from linked l where l.task_id = t.id) as how
        from public.tasks t
        left join public.messages tm on tm.id = t.message_id
        left join public.conversations tc on tc.id = t.conversation_id
       where t.company_id = p_company_id and t.deleted_at is null
         and t.id in (select task_id from linked)
         and (p_hidden_number_ids is null or tc.phone_number_id is null
              or not (tc.phone_number_id = any (p_hidden_number_ids)))
       order by t.number desc
       limit 100
    ) x;

  return jsonb_build_object('outcome', 'ok', 'items', v_items);
end $$;

revoke execute on function public.api_linked_tasks(uuid, text, uuid, uuid[])
  from public, anon, authenticated;
grant execute on function public.api_linked_tasks(uuid, text, uuid, uuid[]) to service_role;

-- ---------------------------------------------------------------------------
-- 7b. Chips: what a #T-142, #contact-xxxx or #conv-xxxx points at right now.
--     A task or conversation on a number the caller is denied is simply not
--     returned, so a chip for it renders as an unknown reference.
-- ---------------------------------------------------------------------------
create or replace function public.api_resolve_references(
  p_company_id        uuid,
  p_task_numbers      int[] default null,
  p_contact_prefixes  text[] default null,
  p_conv_prefixes     text[] default null,
  p_hidden_number_ids uuid[] default null
) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'tasks', coalesce((
      select jsonb_agg(jsonb_build_object(
               'number', t.number, 'id', t.id, 'title', t.title,
               'done', (coalesce(m.done_at, t.done_at) is not null)))
        from public.tasks t
        left join public.messages m on m.id = t.message_id
        left join public.conversations c on c.id = t.conversation_id
       where t.company_id = p_company_id and t.deleted_at is null
         and t.number = any (coalesce(p_task_numbers[1:50], '{}'))
         and (p_hidden_number_ids is null or c.phone_number_id is null
              or not (c.phone_number_id = any (p_hidden_number_ids)))
    ), '[]'::jsonb),
    'contacts', coalesce((
      select jsonb_agg(jsonb_build_object(
               'prefix', lower(pre.prefix), 'id', x.id, 'name', x.name))
        from unnest(coalesce(p_contact_prefixes[1:50], '{}')) as pre(prefix)
        cross join lateral (
          select ct.id, ct.name
            from public.contacts ct
           where pre.prefix ~* '^[0-9a-f]{8}$'
             and ct.company_id = p_company_id and ct.deleted_at is null
             and ct.id >= (lower(pre.prefix) || '-0000-0000-0000-000000000000')::uuid
             and ct.id <= (lower(pre.prefix) || '-ffff-ffff-ffff-ffffffffffff')::uuid
           limit 1) x
    ), '[]'::jsonb),
    'conversations', coalesce((
      select jsonb_agg(jsonb_build_object(
               'prefix', lower(pre.prefix), 'id', x.id,
               'contact_name', x.name))
        from unnest(coalesce(p_conv_prefixes[1:50], '{}')) as pre(prefix)
        cross join lateral (
          select c.id, ct.name
            from public.conversations c
            join public.contacts ct on ct.id = c.contact_id
           where pre.prefix ~* '^[0-9a-f]{8}$'
             and c.company_id = p_company_id and c.deleted_at is null
             and c.id >= (lower(pre.prefix) || '-0000-0000-0000-000000000000')::uuid
             and c.id <= (lower(pre.prefix) || '-ffff-ffff-ffff-ffffffffffff')::uuid
             and (p_hidden_number_ids is null or c.phone_number_id is null
                  or not (c.phone_number_id = any (p_hidden_number_ids)))
           limit 1) x
    ), '[]'::jsonb)
  )
$$;

revoke execute on function public.api_resolve_references(uuid, int[], text[], text[], uuid[])
  from public, anon, authenticated;
grant execute on function public.api_resolve_references(uuid, int[], text[], text[], uuid[])
  to service_role;

-- ---------------------------------------------------------------------------
-- 8. Has attachments: the D28 union, as a column the list can filter on.
-- ---------------------------------------------------------------------------
create or replace function public.task_has_attachments(public.tasks)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (select 1 from public.message_attachments a
                  where a.message_id = $1.message_id)
      or exists (select 1
                   from public.messages n
                   join public.attachments a
                     on a.owner_type = 'note' and a.owner_id = n.id and a.deleted_at is null
                  where n.task_id = $1.id and n.direction = 'note')
      or exists (select 1 from public.attachments a
                  where a.owner_type = 'task' and a.owner_id = $1.id and a.deleted_at is null)
$$;

revoke execute on function public.task_has_attachments(public.tasks)
  from public, anon, authenticated;
grant execute on function public.task_has_attachments(public.tasks) to service_role;

-- ---------------------------------------------------------------------------
-- 9. Search: a task is found by its number (T-142, t142, 142).
-- ---------------------------------------------------------------------------
do $mig$
declare
  v_def text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'api_search_v2';

  v_new := replace(v_def,
    $$select t.id, t.created_at,
               greatest(extensions.word_similarity(p_q, t.title),
                        extensions.word_similarity(p_q, t.description)) as sim,$$,
    $$select t.id, t.created_at,
               case when t.number = (substring(p_q from '(?i)^\s*#?(?:t-?)?([0-9]{1,9})\s*$'))::int
                    then 2::real
                    else greatest(extensions.word_similarity(p_q, t.title),
                                  extensions.word_similarity(p_q, t.description)) end as sim,$$);
  if v_new = v_def then
    raise exception 'api_search_v2: the task similarity anchor was not found';
  end if;
  v_def := v_new;

  v_new := replace(v_def,
    $$and (t.title ilike ('%' || replace(replace(replace(p_q, '\', '\\'), '%', '\%'), '_', '\_') || '%')
               or t.description ilike$$,
    $$and (t.number = (substring(p_q from '(?i)^\s*#?(?:t-?)?([0-9]{1,9})\s*$'))::int
               or t.title ilike ('%' || replace(replace(replace(p_q, '\', '\\'), '%', '\%'), '_', '\_') || '%')
               or t.description ilike$$);
  if v_new = v_def then
    raise exception 'api_search_v2: the task where anchor was not found';
  end if;
  v_def := v_new;

  v_new := replace(v_def,
    $$'id', t.id,
                 'title', t.title,
                 'conversation_id', t.conversation_id,$$,
    $$'id', t.id,
                 'number', t.number,
                 'title', t.title,
                 'conversation_id', t.conversation_id,$$);
  if v_new = v_def then
    raise exception 'api_search_v2: the task row anchor was not found';
  end if;
  execute v_new;
end $mig$;

revoke execute on function public.api_search_v2(uuid, text, integer, integer, integer, integer, integer, timestamptz, uuid, uuid[], integer)
  from public, anon, authenticated;
grant execute on function public.api_search_v2(uuid, text, integer, integer, integer, integer, integer, timestamptz, uuid, uuid[], integer)
  to service_role;

-- ---------------------------------------------------------------------------
-- 10. The erasure and merge paths learn the new tables, rewritten from the live
--     definitions.
-- ---------------------------------------------------------------------------
do $mig$
declare
  v_def text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'purge_workspace_step';
  v_new := replace(v_def, $$'usage_events', 'tasks', 'task_series',$$,
                          $$'usage_events', 'tasks', 'task_series', 'task_counters',$$);
  if v_new = v_def then
    raise exception 'purge_workspace_step: the roster anchor was not found';
  end if;
  execute v_new;

  -- A merged contact's references follow it; one already pointing at the
  -- surviving contact from the same source is simply dropped.
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'api_merge_contacts';
  v_new := replace(v_def,
    $$-- #689: so does a standalone task linked straight to the contact.$$,
    $$-- #690: and what notes and tasks point at them.
  delete from public.record_references r
   where r.company_id = p_company_id and r.target_contact_id = p_from
     and exists (select 1 from public.record_references k
                  where k.source_kind = r.source_kind and k.source_id = r.source_id
                    and k.target_contact_id = p_into);
  update public.record_references set target_contact_id = p_into
   where company_id = p_company_id and target_contact_id = p_from;

  -- #689: so does a standalone task linked straight to the contact.$$);
  if v_new = v_def then
    raise exception 'api_merge_contacts: the task anchor was not found';
  end if;
  execute v_new;
end $mig$;

revoke execute on function public.purge_workspace_step(uuid, int)
  from public, anon, authenticated;
grant execute on function public.purge_workspace_step(uuid, int) to service_role;

revoke execute on function public.api_merge_contacts(uuid, uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.api_merge_contacts(uuid, uuid, uuid, uuid) to service_role;
