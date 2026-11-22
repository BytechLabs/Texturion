do $migration$
declare
  definition text := pg_get_functiondef(
    'public.api_for_you(uuid,uuid,timestamptz,integer,uuid[])'::regprocedure
  );
  signature constant text := 'public.api_for_you(p_company_id uuid, p_user_id uuid, p_now timestamp with time zone, p_limit integer DEFAULT 20, p_hidden_number_ids uuid[] DEFAULT NULL::uuid[])';
  first_query constant text := '  conv as (';
  conversation_filter constant text := 'not (c.phone_number_id = any(p_hidden_number_ids)))';
  task_filter constant text := 'and public.task_done_at(t) is null';
  follow_up_filter constant text := 'and s.until <= now()';
begin
  if strpos(definition, signature) = 0
     or strpos(definition, first_query) = 0
     or strpos(definition, conversation_filter) = 0
     or strpos(definition, task_filter) = 0
     or strpos(definition, follow_up_filter) = 0 then
    raise exception 'For You queue predicates changed';
  end if;

  definition := replace(definition, signature, 'public.api_for_you_by_line(p_company_id uuid, p_user_id uuid, p_now timestamptz, p_limit integer, p_hidden_number_ids uuid[], p_phone_number_id uuid)');
  definition := replace(definition, first_query, $sql$  selected_line as (
    select id from public.phone_numbers
    where id = p_phone_number_id and company_id = p_company_id and status = 'active'
      and (p_hidden_number_ids is null or not (id = any(p_hidden_number_ids)))
  ),
  conv as ($sql$);
  definition := replace(definition, conversation_filter, conversation_filter || $sql$
      and (p_phone_number_id is null or c.phone_number_id = (select id from selected_line))$sql$);
  definition := replace(definition, task_filter, task_filter || $sql$
      and (p_phone_number_id is null or t.source_line_id = (select id from selected_line))$sql$);
  execute replace(definition, follow_up_filter, follow_up_filter || $sql$
      and (p_phone_number_id is null or exists (
        select 1 from public.conversations c
        where c.id = s.conversation_id and c.company_id = p_company_id
          and c.deleted_at is null
          and c.phone_number_id = (select id from selected_line)
      ))$sql$);
end $migration$;

revoke execute on function public.api_for_you_by_line(uuid, uuid, timestamptz, integer, uuid[], uuid)
  from public, anon, authenticated;
grant execute on function public.api_for_you_by_line(uuid, uuid, timestamptz, integer, uuid[], uuid)
  to service_role;

create or replace function public.api_for_you(
  p_company_id uuid,
  p_user_id uuid,
  p_now timestamptz,
  p_limit integer default 20,
  p_hidden_number_ids uuid[] default null
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $sql$
  select public.api_for_you_by_line(
    p_company_id, p_user_id, p_now, p_limit, p_hidden_number_ids, null
  );
$sql$;
