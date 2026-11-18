create function public.broadcast_contact_opt_out() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_thread record;
begin
  if tg_op = 'UPDATE' then
    if (old.revoked_at is null) = (new.revoked_at is null)
       and (new.revoked_at is not null or old.source is not distinct from new.source) then
      return null;
    end if;
  elsif new.revoked_at is not null then
    return null;
  end if;

  for v_thread in
    select c.id, c.contact_id, c.phone_number_id
      from public.conversations c
      join (
        select id as contact_id from public.contacts
        where company_id = new.company_id and phone_e164 = new.phone_e164
        union
        select contact_id from public.contact_phones
        where company_id = new.company_id and phone_e164 = new.phone_e164
      ) matched on matched.contact_id = c.contact_id
     where c.company_id = new.company_id
       and c.deleted_at is null
       and c.phone_number_id is not null
     order by c.phone_number_id, c.id
  loop
    perform public.broadcast_number_scoped(
      jsonb_build_object('conversation_id', v_thread.id, 'contact_id', v_thread.contact_id),
      'conversation.updated', new.company_id, v_thread.phone_number_id);
  end loop;
  return null;
end $$;

revoke all on function public.broadcast_contact_opt_out() from public, anon, authenticated;

create trigger opt_outs_broadcast
after insert or update of revoked_at, source on public.opt_outs
for each row execute function public.broadcast_contact_opt_out();
