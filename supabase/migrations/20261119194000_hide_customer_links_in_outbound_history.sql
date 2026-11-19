alter table public.messages add column public_link_ids uuid[];
alter table public.public_links add column source_link_id uuid references public.public_links(id) on delete cascade;
create index public_links_source_idx on public.public_links (source_link_id) where source_link_id is not null;

create function public.hide_message_public_links() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  customer_link constant text := $regex$(^|[^[:alnum:]_./@-])(https://app[.]loonext[.]com/(q|pay|photos)/)([A-Za-z0-9_-]{40,64})(?![A-Za-z0-9_/-])$regex$;
begin
  if new.direction = 'outbound' and new.body ~ customer_link then
    select array_agg(l.id order by item.ordinality) into new.public_link_ids
    from regexp_matches(new.body, customer_link, 'g') with ordinality as item(parts, ordinality)
    left join public.public_links l on l.company_id = new.company_id
      and l.token_hash = encode(sha256(convert_to(item.parts[4], 'UTF8')), 'hex')
      and l.purpose = case item.parts[3] when 'q' then 'quote_view' when 'pay' then 'payment' else 'photo_set' end
      and l.max_uses is null;
    new.body := regexp_replace(new.body, customer_link, '\1\2[private link]', 'g');
  elsif tg_op = 'UPDATE' and new.body is distinct from old.body then
    new.public_link_ids := null;
  end if;
  return new;
end $$;

revoke execute on function public.hide_message_public_links() from public, anon, authenticated;
create trigger messages_hide_public_links before insert or update of body on public.messages
  for each row execute function public.hide_message_public_links();

create function public.api_gate_public_link_send(
  p_company_id uuid,
  p_conversation_id uuid,
  p_sender_user_id uuid,
  p_body text,
  p_idempotency_key text,
  p_segments_estimate integer,
  p_links jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
  link_ids uuid[];
begin
  result := public.gate_outbound_send(
    p_company_id, p_conversation_id, p_sender_user_id, p_body, p_idempotency_key, p_segments_estimate
  );
  if not (result ? 'message') or (result->>'existing')::boolean then return result; end if;

  select array_agg(l.id order by item.ordinality) into link_ids
  from jsonb_array_elements(p_links) with ordinality as item(value, ordinality)
  left join public.public_links l on l.company_id = p_company_id
    and l.token_hash = item.value->>'token_hash'
    and l.purpose = item.value->>'purpose'
    and l.max_uses is null;

  update public.messages set public_link_ids = link_ids
  where company_id = p_company_id and id = (result #>> '{message,id}')::uuid;
  return jsonb_set(result, '{message,public_link_ids}', to_jsonb(link_ids));
end $$;

revoke execute on function public.api_gate_public_link_send(uuid, uuid, uuid, text, text, integer, jsonb)
  from public, anon, authenticated;
grant execute on function public.api_gate_public_link_send(uuid, uuid, uuid, text, text, integer, jsonb)
  to service_role;

create function public.api_remint_outbound_link(
  p_company_id uuid,
  p_link_id uuid,
  p_purpose text,
  p_token_hash text,
  p_actor uuid
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.public_links (
    token_hash, company_id, purpose, subject_type, subject_id, expires_at, created_by, source_link_id
  )
  select p_token_hash, l.company_id, l.purpose, l.subject_type, l.subject_id,
         least(l.expires_at, root.expires_at), p_actor, root.id
  from public.public_links l
  join public.public_links root on root.id = coalesce(l.source_link_id, l.id)
  where l.company_id = p_company_id and l.id = p_link_id and l.purpose = p_purpose
    and l.purpose in ('quote_view', 'payment', 'photo_set')
    and l.max_uses is null and l.revoked_at is null and l.expires_at > now()
    and root.company_id = p_company_id and root.revoked_at is null and root.expires_at > now();
  return found;
end $$;

revoke execute on function public.api_remint_outbound_link(uuid, uuid, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.api_remint_outbound_link(uuid, uuid, text, text, uuid)
  to service_role;

create or replace function public.api_resolve_public_link(
  p_token_hash text,
  p_purpose text,
  p_country text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  link public.public_links%rowtype;
  outcome text;
begin
  select * into link from public.public_links where token_hash = p_token_hash for update;
  if not found then
    insert into public.public_link_access (link_id, outcome, ip_country)
    values (null, 'not_found', p_country);
    return jsonb_build_object('ok', false, 'outcome', 'not_found');
  end if;

  outcome := case
    when link.revoked_at is not null then 'revoked'
    when link.expires_at <= now() then 'expired'
    when link.max_uses is not null and link.uses >= link.max_uses then 'used_up'
    when link.purpose is distinct from p_purpose then 'wrong_purpose'
    when link.source_link_id is not null and not exists (
      select 1 from public.public_links source
      where source.id = link.source_link_id and source.revoked_at is null and source.expires_at > now()
        and (source.source_link_id is null or exists (
          select 1 from public.public_links root
          where root.id = source.source_link_id and root.revoked_at is null and root.expires_at > now()
        ))
    ) then 'revoked'
    else 'ok'
  end;
  insert into public.public_link_access (link_id, outcome, ip_country)
  values (link.id, outcome, p_country);
  if outcome <> 'ok' then return jsonb_build_object('ok', false, 'outcome', outcome); end if;

  update public.public_links set uses = uses + 1, last_used_at = now() where id = link.id;
  return jsonb_build_object(
    'ok', true, 'outcome', 'ok', 'link_id', link.id, 'company_id', link.company_id,
    'subject_type', link.subject_type, 'subject_id', link.subject_id, 'expires_at', link.expires_at
  );
end $$;

do $$
declare
  customer_link text := $regex$(^|[^[:alnum:]_./@-])(https://app[.]loonext[.]com/(q|pay|photos)/)([A-Za-z0-9_-]{40,64})(?![A-Za-z0-9_/-])$regex$;
begin
  update public.messages set body = body where direction = 'outbound' and body ~ customer_link;

  update public.webhook_deliveries d
  set payload = jsonb_set(d.payload, '{data,body}', to_jsonb(
    regexp_replace(d.payload #>> '{data,body}', customer_link, '\1\2[private link]', 'g')
  ))
  where d.event_type = 'message.sent' and d.payload #>> '{data,body}' ~ customer_link;
end $$;
