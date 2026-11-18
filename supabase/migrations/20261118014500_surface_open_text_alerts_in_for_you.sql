create index conversations_outbound_failure_idx
  on public.conversations (company_id, last_outbound_failed_at desc)
  where last_outbound_failed_at is not null and deleted_at is null;

do $$
declare
  v_sql text := pg_get_functiondef(
    'public.api_for_you(uuid, uuid, timestamptz, integer, uuid[])'::regprocedure
  );
  v_cte text := '  contact_map as (';
  v_section text := $old$    'waiting_on_you', coalesce(($old$;
  v_count text := '          ct.distinct_conversations';
begin
  if strpos(v_sql, v_cte) = 0 or strpos(v_sql, v_section) = 0 or strpos(v_sql, v_count) = 0 then
    raise exception 'api_for_you: expected sections and totals';
  end if;

  v_sql := replace(v_sql, v_cte, $new$  text_alerts as (
    select c.id as conversation_id, c.contact_id, c.contact_phone_e164,
           a.kind, a.occurred_at
      from public.conversations c
      cross join lateral (values
        ('opt_out_hint', c.opt_out_hint_at),
        ('text_failed', c.last_outbound_failed_at)
      ) as a(kind, occurred_at)
     where c.company_id = p_company_id and c.deleted_at is null and not c.is_spam
       and (c.opt_out_hint_at is not null or c.last_outbound_failed_at is not null)
       and a.occurred_at is not null
       and (p_hidden_number_ids is null or c.phone_number_id is null
            or not (c.phone_number_id = any(p_hidden_number_ids)))
       and (
         (a.kind = 'opt_out_hint'
          and (c.assigned_user_id is null or c.assigned_user_id = p_user_id)
          and exists (
            select 1 from public.company_members cm
             where cm.company_id = p_company_id and cm.user_id = p_user_id
               and cm.deactivated_at is null and cm.role <> 'read_only'
          ))
         or
         (a.kind = 'text_failed'
          and not exists (
            select 1 from public.conversation_reads r
             where r.conversation_id = c.id and r.user_id = p_user_id
               and r.last_read_at >= a.occurred_at
          )
          and exists (
            select 1 from public.messages m
             where m.company_id = p_company_id and m.conversation_id = c.id
               and m.direction = 'outbound' and m.status = 'failed'
               and m.sent_by_user_id = p_user_id and m.automated = false
               and m.updated_at >= a.occurred_at and m.deleted_at is null
          ))
       )
  ),
  text_alerts_page as (
    select * from text_alerts
     order by kind, occurred_at desc, conversation_id
     limit greatest(p_limit, 0)
  ),
  contact_map as ($new$);

  v_sql := replace(v_sql, v_section, $new$    'text_alerts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'conversation_id', a.conversation_id, 'kind', a.kind,
        'contact', jsonb_build_object('id', ct.id, 'name', ct.name,
                                     'phone_e164', a.contact_phone_e164))
        order by a.kind, a.occurred_at desc, a.conversation_id)
        from text_alerts_page a
        join public.contacts ct on ct.id = a.contact_id and ct.company_id = p_company_id
    ), '[]'::jsonb),
    'waiting_on_you', coalesce(($new$);

  v_sql := replace(v_sql, v_count, $new$          ct.distinct_conversations
          + (select count(distinct a.conversation_id) from text_alerts a
              where not exists (
                select 1 from conv c where c.id = a.conversation_id
                  and ((c.assigned_user_id = p_user_id
                        and (c.status in ('open','waiting') or c.unread_mine))
                    or (c.assigned_user_id is null and c.status in ('new','open','waiting')))
              ) and not exists (
                select 1 from due_follow_ups f where f.conversation_id = a.conversation_id
              ))$new$);
  execute v_sql;
end $$;

do $$
declare
  v_sql text := pg_get_functiondef('public.broadcast_conversation_read()'::regprocedure);
  v_old text := 'coalesce(v_newest_not_mine <= least(old.last_read_at, new.last_read_at), true) then';
begin
  if strpos(v_sql, v_old) = 0 then
    raise exception 'broadcast_conversation_read: expected unchanged-read check';
  end if;
  execute replace(v_sql, v_old, $new$coalesce(v_newest_not_mine <= least(old.last_read_at, new.last_read_at), true)
       and not exists (
         select 1 from public.conversations c where c.id = new.conversation_id
           and c.last_outbound_failed_at > least(old.last_read_at, new.last_read_at)
           and c.last_outbound_failed_at <= greatest(old.last_read_at, new.last_read_at)
       ) then$new$);
end $$;
