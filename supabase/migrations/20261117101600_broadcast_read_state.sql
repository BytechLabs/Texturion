create or replace function public.broadcast_conversation_read() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid;
  v_number uuid;
  v_newest_not_mine timestamptz;
begin
  select case when b.latest_by is distinct from new.user_id
              then b.latest_at else b.other_at end
    into v_newest_not_mine
    from public.conversation_unread_basis b
   where b.conversation_id = new.conversation_id;

  if tg_op = 'UPDATE'
     and new.conversation_id = old.conversation_id
     and new.user_id = old.user_id
     and coalesce(v_newest_not_mine <= least(old.last_read_at, new.last_read_at), true) then
    return null;
  end if;

  select c.company_id, c.phone_number_id into v_company, v_number
    from public.conversations c
   where c.id = new.conversation_id;
  if v_company is null then return null; end if;

  perform public.broadcast_number_scoped(
    jsonb_build_object('conversation_id', new.conversation_id,
                       'user_id', new.user_id,
                       'is_read', coalesce(v_newest_not_mine <= new.last_read_at, true)),
    'read.conversation', v_company, v_number);
  return null;
end $$;
