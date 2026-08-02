-- ---------------------------------------------------------------------------
-- #298 — what a tag MEANS, and a ceiling on how many there can be.
--
-- Two of the issue's scope items that the governance migration left open.
-- Both are about the same failure from opposite ends: a workspace ends up with
-- forty tags, six of which mean the same thing, and nobody can tell which is
-- which. A description settles the question for the tech reading it six months
-- later; the ceiling catches the runaway integration that would make forty into
-- four hundred overnight.
-- ---------------------------------------------------------------------------

alter table public.tags
  add column if not exists description text;

alter table public.tags
  drop constraint if exists tags_description_len;
alter table public.tags
  add constraint tags_description_len
  check (description is null or char_length(description) <= 200);

comment on column public.tags.description is
  '#298: what this tag means, in the crew''s own words. Optional, and it stays '
  'optional — a required field here would be answered with "warranty" for a tag '
  'named Warranty by everybody who was in a hurry, which is worse than nothing '
  'because it looks like an answer. 200 chars: a sentence, not a policy.';

-- ---------------------------------------------------------------------------
-- The ceiling, enforced where tags are actually born.
--
-- #298 asks for "a sane ceiling, high enough that nobody legitimate hits it and
-- low enough to catch runaway automation". 200 (packages/shared
-- TAGS_PER_WORKSPACE) is far past the forty that already makes a tag list
-- unusable, so a crew reaching it has a bug or an integration, not a taxonomy.
--
-- It lives in the same statement as the lock and the existence check, for the
-- same reason: counting in the Worker first would leave a window where two
-- concurrent attaches both saw 199.
--
-- The returned `reason` replaces the bare `refused` boolean, because a refusal
-- with no reason forces the client to invent one, and the two refusals here
-- need different sentences — one is "ask an admin", the other is "something is
-- creating these automatically and you should look at it".
-- ---------------------------------------------------------------------------
drop function if exists public.api_find_or_create_tag(uuid, text, boolean);

create or replace function public.api_find_or_create_tag(
  p_company_id uuid,
  p_name       text,
  -- Defaulted true so every existing caller keeps its behaviour exactly.
  p_may_create boolean default true
)
returns table (id uuid, name text, color text, refused boolean, reason text)
language plpgsql
security definer
set search_path = ''
as $$
-- The OUT parameters above are named `id`, `name` and `color`, which are also
-- column names on `tags`. Inside plpgsql that is ambiguous and fails at RETURN
-- QUERY rather than at CREATE time, so it is only ever found by running the
-- function. The directive belongs INSIDE the body, before `declare`.
#variable_conflict use_column
declare
  v_locked boolean;
  v_count  bigint;
  v_row    public.tags;
begin
  select t.* into v_row from public.tags t
   where t.company_id = p_company_id and lower(t.name) = lower(btrim(p_name));

  -- Whatever the lock or the ceiling say: the restriction is on INVENTING a
  -- tag, never on using one. A member attaching "Warranty" to a second thread
  -- must not be refused because a setting changed in between, and a workspace
  -- sitting at the ceiling must still be able to file things.
  if v_row.id is not null then
    return query select v_row.id, v_row.name, v_row.color, false, null::text;
    return;
  end if;

  if not p_may_create then
    select c.tags_locked into v_locked from public.companies c where c.id = p_company_id;
    if coalesce(v_locked, false) then
      return query select null::uuid, null::text, null::text, true, 'locked'::text;
      return;
    end if;
  end if;

  select count(*) into v_count from public.tags t where t.company_id = p_company_id;
  if v_count >= 200 then
    return query select null::uuid, null::text, null::text, true, 'at_ceiling'::text;
    return;
  end if;

  return query
    insert into public.tags (company_id, name)
    values (p_company_id, p_name)
    on conflict (company_id, lower(name)) do update set name = public.tags.name
    returning public.tags.id, public.tags.name, public.tags.color, false, null::text;
end;
$$;

revoke execute on function public.api_find_or_create_tag(uuid, text, boolean)
  from public, anon, authenticated;
grant execute on function public.api_find_or_create_tag(uuid, text, boolean)
  to service_role;

-- ---------------------------------------------------------------------------
-- Usage, with the description alongside.
--
-- #298 acceptance: "an admin can see usage counts and last-used dates per tag."
-- The description rides along because the list is where somebody decides two
-- tags are the same thing, and that decision is exactly what a description
-- exists to settle.
-- ---------------------------------------------------------------------------
drop function if exists public.api_tag_usage(uuid);

create or replace function public.api_tag_usage(p_company_id uuid)
returns table (
  tag_id      uuid,
  name        text,
  description text,
  uses        bigint,
  last_used   timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    t.id,
    t.name,
    t.description,
    count(ct.conversation_id)::bigint,
    max(ct.created_at)
  from public.tags t
  left join public.conversation_tags ct on ct.tag_id = t.id
  where t.company_id = p_company_id
  group by t.id, t.name, t.description
  -- Busiest first: the ones worth keeping are obvious, and the tail is where
  -- the duplicates and the dead ones both live.
  order by count(ct.conversation_id) desc, t.name
$$;

revoke execute on function public.api_tag_usage(uuid) from public, anon, authenticated;
grant execute on function public.api_tag_usage(uuid) to service_role;
