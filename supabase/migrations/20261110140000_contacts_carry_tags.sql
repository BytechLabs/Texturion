-- #695: a contact can carry tags from the workspace's one tag vocabulary.
--
-- "All property managers", "commercial accounts", "warranty customers" are
-- properties of the CUSTOMER, not of one thread, so they live on the contact
-- and not on `conversation_tags`. The names come from the same `tags` table the
-- conversations use: a second list would mean two spellings of "warranty" and a
-- Settings screen that cleans up only one of them.
--
-- Deleting a tag, or a contact, removes the link. Merging two tags folds the
-- contact links the same way it folds the conversation links (below), because
-- `tag_id` cascades and a merge that forgot this table would silently strip the
-- survivor of every contact the loser was on.
--
-- A merged-away contact keeps its own links (the tombstone is untouched), so an
-- unmerge puts back exactly what the second record carried; the survivor gets a
-- copy of them from the API at merge time.

create table if not exists public.contact_tags (
  company_id uuid not null references public.companies(id) on delete restrict,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  tag_id     uuid not null references public.tags(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (contact_id, tag_id)
);

-- "Everyone with this tag" for the list filter and the export.
create index if not exists contact_tags_tag_idx
  on public.contact_tags (company_id, tag_id, contact_id);

-- Deny-by-default RLS (SPEC §6 / D8): enabled, no policies, no end-user grants.
-- Every read and write goes through the Worker with the service key, and every
-- query there filters on the caller's company.
alter table public.contact_tags enable row level security;
revoke all on public.contact_tags from public, anon, authenticated;
grant select, insert, update, delete on public.contact_tags to service_role;

comment on table public.contact_tags is
  '#695: which workspace tags a contact carries. Same vocabulary as '
  'conversation_tags. Cascades with the contact and with the tag, so the '
  'workspace purge reaches it through contacts.';

-- ---------------------------------------------------------------------------
-- api_merge_tags: recreated from 20260801150000_tag_governance.sql with the
-- contact links folded in too. Everything above the contact block is unchanged.
-- ---------------------------------------------------------------------------
create or replace function public.api_merge_tags(
  p_company_id uuid,
  p_from_tag   uuid,
  p_into_tag   uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from public.tags;
  v_into public.tags;
  v_moved integer;
  v_merged integer;
begin
  select * into v_from from public.tags
   where id = p_from_tag and company_id = p_company_id;
  select * into v_into from public.tags
   where id = p_into_tag and company_id = p_company_id;

  if v_from.id is null or v_into.id is null then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  if v_from.id = v_into.id then
    return jsonb_build_object('outcome', 'same_tag');
  end if;

  if v_from.pipeline_stage is not null and v_into.pipeline_stage is not null then
    return jsonb_build_object(
      'outcome', 'two_stages',
      'from_stage', v_from.pipeline_stage,
      'into_stage', v_into.pipeline_stage);
  end if;

  update public.conversation_tags into_row
     set created_at = least(into_row.created_at, from_row.created_at)
    from public.conversation_tags from_row
   where into_row.tag_id = p_into_tag
     and from_row.tag_id = p_from_tag
     and from_row.conversation_id = into_row.conversation_id;
  get diagnostics v_merged = row_count;

  delete from public.conversation_tags dup
   where dup.tag_id = p_from_tag
     and exists (select 1 from public.conversation_tags keep
                  where keep.tag_id = p_into_tag
                    and keep.conversation_id = dup.conversation_id);

  update public.conversation_tags set tag_id = p_into_tag where tag_id = p_from_tag;
  get diagnostics v_moved = row_count;

  -- #695: the same fold for contacts.
  update public.contact_tags into_row
     set created_at = least(into_row.created_at, from_row.created_at)
    from public.contact_tags from_row
   where into_row.tag_id = p_into_tag
     and from_row.tag_id = p_from_tag
     and from_row.contact_id = into_row.contact_id;

  delete from public.contact_tags dup
   where dup.tag_id = p_from_tag
     and exists (select 1 from public.contact_tags keep
                  where keep.tag_id = p_into_tag
                    and keep.contact_id = dup.contact_id);

  update public.contact_tags set tag_id = p_into_tag where tag_id = p_from_tag;

  if v_from.pipeline_stage is not null then
    update public.tags set pipeline_stage = null where id = p_from_tag;
    update public.tags set pipeline_stage = v_from.pipeline_stage
     where id = p_into_tag;
  end if;

  delete from public.tags where id = p_from_tag;

  return jsonb_build_object(
    'outcome', 'merged',
    'moved', v_moved,
    'already_both', v_merged,
    'stage_moved', v_from.pipeline_stage is not null);
end;
$$;

revoke execute on function public.api_merge_tags(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.api_merge_tags(uuid, uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- api_tag_usage: a tag used only on contacts is not a dead tag. Without this
-- the cleanup screen would list "Property manager" as unused and invite the
-- admin to delete it.
-- ---------------------------------------------------------------------------
create or replace function public.api_tag_usage(p_company_id uuid)
returns table (
  tag_id     uuid,
  name       text,
  uses       bigint,
  last_used  timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    t.id,
    t.name,
    (select count(*) from public.conversation_tags ct where ct.tag_id = t.id)
      + (select count(*) from public.contact_tags kt where kt.tag_id = t.id),
    greatest(
      (select max(ct.created_at) from public.conversation_tags ct where ct.tag_id = t.id),
      (select max(kt.created_at) from public.contact_tags kt where kt.tag_id = t.id)
    )
  from public.tags t
  where t.company_id = p_company_id
  order by 3 desc, t.name
$$;

revoke execute on function public.api_tag_usage(uuid) from public, anon, authenticated;
grant execute on function public.api_tag_usage(uuid) to service_role;
