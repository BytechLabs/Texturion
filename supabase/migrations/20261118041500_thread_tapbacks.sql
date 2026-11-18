alter table public.messages
  add column reaction_to_message_id uuid references public.messages(id) on delete cascade,
  add column reaction_emoji text,
  add column reaction_removed boolean not null default false,
  add constraint messages_reaction_check check (
    (reaction_to_message_id is null and reaction_emoji is null and not reaction_removed)
    or (reaction_to_message_id is not null and direction = 'inbound'
        and reaction_emoji is not null and length(reaction_emoji) between 1 and 32)
  );

create index messages_reaction_target_idx
  on public.messages (reaction_to_message_id)
  where reaction_to_message_id is not null;

create or replace trigger messages_start_lead_clock
  after insert on public.messages
  for each row when (new.reaction_to_message_id is null)
  execute function public.start_lead_response_clock();

create or replace trigger messages_cancel_snoozes
  after insert on public.messages
  for each row when (new.reaction_to_message_id is null)
  execute function public.cancel_snoozes_on_inbound();

create function public.thread_inbound_message(
  p_company_id uuid,
  p_phone_number_id uuid,
  p_from_e164 text,
  p_body text,
  p_telnyx_message_id text,
  p_timezone text,
  p_email_limit integer,
  p_push_limit integer,
  p_reaction jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quote text := trim(p_reaction->>'quote');
  v_emoji text := p_reaction->>'emoji';
  v_removed boolean := p_reaction->'removed' = 'true'::jsonb;
  v_target public.messages%rowtype;
  v_message public.messages%rowtype;
  v_created boolean := false;
begin
  select m.* into v_message
    from public.messages m
   where m.telnyx_message_id = p_telnyx_message_id
     and m.company_id = p_company_id;

  if not found
     and length(v_quote) between 1 and 1600
     and length(v_emoji) between 1 and 32
     and length(trim(p_telnyx_message_id)) > 0 then
    if right(v_quote, 1) = '…' then
      v_quote := rtrim(left(v_quote, -1));
    elsif right(v_quote, 3) = '...' then
      v_quote := rtrim(left(v_quote, -3));
    end if;

    select candidates.* into v_target
      from (
        select m.*
          from public.conversations c
          join public.messages m on m.conversation_id = c.id and m.company_id = c.company_id
         where c.company_id = p_company_id
           and c.phone_number_id = p_phone_number_id
           and c.contact_phone_e164 = p_from_e164
           and c.deleted_at is null and not c.is_spam
           and m.deleted_at is null
           and m.direction = 'outbound'
           and m.status in ('sent', 'delivered')
           and m.created_at >= now() - interval '30 days'
         order by m.created_at desc, m.id desc
         limit 60
      ) candidates
     where v_quote <> ''
       and left(trim(candidates.body), length(v_quote)) = v_quote
     order by (trim(candidates.body) = v_quote) desc, candidates.created_at desc, candidates.id desc
     limit 1;

    if v_target.id is not null then
      insert into public.messages (
        company_id, conversation_id, direction, body, status, telnyx_message_id, source,
        reaction_to_message_id, reaction_emoji, reaction_removed
      ) values (
        p_company_id, v_target.conversation_id, 'inbound', coalesce(p_body, ''), 'received',
        p_telnyx_message_id, 'carrier', v_target.id, v_emoji, coalesce(v_removed, false)
      )
      on conflict (telnyx_message_id) where telnyx_message_id is not null do nothing
      returning * into v_message;

      v_created := found;
      if not v_created then
        select m.* into v_message
          from public.messages m
         where m.telnyx_message_id = p_telnyx_message_id
           and m.company_id = p_company_id;
      end if;
    end if;
  end if;

  if v_message.reaction_to_message_id is not null then
    return jsonb_build_object(
      'message_id', v_message.id,
      'conversation_id', v_message.conversation_id,
      'created', v_created,
      'notify', false,
      'notify_reason', 'reaction'
    );
  end if;

  return public.thread_inbound_message(
    p_company_id, p_phone_number_id, p_from_e164, p_body, p_telnyx_message_id,
    p_timezone, p_email_limit, p_push_limit
  );
end;
$$;

revoke all on function public.thread_inbound_message(uuid, uuid, text, text, text, text, integer, integer, jsonb)
  from public, anon, authenticated;
grant execute on function public.thread_inbound_message(uuid, uuid, text, text, text, text, integer, integer, jsonb)
  to service_role;
