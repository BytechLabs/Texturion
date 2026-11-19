create function public.api_record_quote_decision(
  p_company_id uuid,
  p_quote_id uuid,
  p_decision text,
  p_actor uuid,
  p_link_id uuid,
  p_name text,
  p_reason text,
  p_country text
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  quote public.quotes%rowtype;
begin
  if p_decision is null or p_decision not in ('accepted', 'declined')
    or (p_actor is null) = (p_link_id is null) then
    return false;
  end if;
  if p_decision = 'accepted' and
    (p_link_id is null or p_name is null or char_length(btrim(p_name)) not between 1 and 120) then
    return false;
  end if;
  if p_decision = 'declined' and p_actor is not null
    and (p_reason is null or char_length(btrim(p_reason)) not between 1 and 500) then
    return false;
  end if;

  select q.* into quote
  from public.quotes q
  join public.companies company on company.id = q.company_id and company.deleted_at is null
  join public.conversations c on c.company_id = q.company_id and c.id = q.conversation_id
    and c.deleted_at is null and c.purged_at is null
  where q.company_id = p_company_id and q.id = p_quote_id
    and q.status in ('sent', 'viewed') and q.expires_at > now()
  for update of q for share of company, c;
  if not found then return false; end if;

  if p_link_id is not null and not exists (
    select 1 from public.public_links l
    where l.id = p_link_id and l.company_id = p_company_id
      and l.subject_type = 'quote' and l.subject_id = p_quote_id
      and l.purpose = case p_decision when 'accepted' then 'quote_accept' else 'quote_decline' end
      and l.uses = 1 and l.revoked_at is null and l.expires_at > now()
      and (l.source_link_id is null or exists (
        select 1 from public.public_links source
        where source.id = l.source_link_id and source.revoked_at is null and source.expires_at > now()
          and (source.source_link_id is null or exists (
            select 1 from public.public_links root
            where root.id = source.source_link_id and root.revoked_at is null and root.expires_at > now()
          ))
      ))
  ) then return false; end if;

  update public.quotes
  set status = p_decision, decided_at = now(), updated_at = now(),
    decided_by_name = case when p_decision = 'accepted' then btrim(p_name) end,
    decline_reason = case when p_decision = 'declined' then nullif(btrim(p_reason), '') end
  where id = p_quote_id and company_id = p_company_id;

  update public.public_links set revoked_at = now(), revoke_reason = 'quote ' || p_decision
  where company_id = p_company_id and subject_type = 'quote' and subject_id = p_quote_id
    and purpose in ('quote_accept', 'quote_decline') and revoked_at is null;

  insert into public.conversation_events (company_id, conversation_id, actor_user_id, type, payload)
  values (p_company_id, quote.conversation_id, p_actor,
    case p_decision when 'accepted' then 'quote_accepted'::public.conversation_event_type
      else 'quote_declined'::public.conversation_event_type end,
    jsonb_build_object('quote_id', p_quote_id, 'amount_cents', quote.amount_cents,
      'currency', quote.currency, 'description', quote.description, 'ip_country', p_country));
  return true;
end $$;

create function public.api_undo_quote_acceptance(p_company_id uuid, p_quote_id uuid, p_actor uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  conversation uuid;
begin
  update public.quotes q
  set status = 'viewed', decided_by_name = null, decided_at = null,
    decision_version = q.decision_version + 1, viewed_at = coalesce(q.viewed_at, now()), updated_at = now()
  where q.company_id = p_company_id and q.id = p_quote_id
    and q.status = 'accepted' and q.expires_at > now()
    and exists (select 1 from public.conversations c
      where c.company_id = q.company_id and c.id = q.conversation_id
        and c.deleted_at is null and c.purged_at is null)
    and exists (select 1 from public.public_links l
      where l.company_id = q.company_id and l.subject_type = 'quote' and l.subject_id = q.id
        and l.purpose = 'quote_view' and l.source_link_id is null and l.expires_at > now()
        and (l.revoked_at is null or l.revoke_reason = 'quote accepted'))
  returning q.conversation_id into conversation;
  if not found then return false; end if;

  update public.public_links
  set revoked_at = null, revoke_reason = null
  where company_id = p_company_id and subject_type = 'quote' and subject_id = p_quote_id
    and purpose = 'quote_view' and expires_at > now() and revoke_reason = 'quote accepted';

  update public.public_links set revoked_at = now(), revoke_reason = 'quote acceptance reverted'
  where company_id = p_company_id and subject_type = 'quote' and subject_id = p_quote_id
    and purpose in ('quote_accept', 'quote_decline') and revoked_at is null;

  insert into public.conversation_events (company_id, conversation_id, actor_user_id, type, payload)
  values (p_company_id, conversation, p_actor, 'quote_acceptance_reverted',
    jsonb_build_object('quote_id', p_quote_id));
  return true;
end $$;

drop trigger broadcast_quote_acceptance on public.conversation_events;
create trigger broadcast_quote_acceptance
after insert on public.conversation_events
for each row when (new.type in ('quote_accepted', 'quote_declined', 'quote_withdrawn', 'quote_acceptance_reverted'))
execute function public.broadcast_quote_acceptance();

revoke execute on function public.api_record_quote_decision(uuid, uuid, text, uuid, uuid, text, text, text),
  public.api_undo_quote_acceptance(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.api_record_quote_decision(uuid, uuid, text, uuid, uuid, text, text, text),
  public.api_undo_quote_acceptance(uuid, uuid, uuid) to service_role;
