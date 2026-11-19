create function public.api_issue_quote_accept_link(p_view_link_id uuid, p_token_hash text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  view_link public.public_links%rowtype;
  expires timestamptz;
begin
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then return 'unavailable'; end if;

  select l.* into view_link from public.public_links l
  where l.id = p_view_link_id and l.purpose = 'quote_view' and l.subject_type = 'quote'
    and l.revoked_at is null and l.expires_at > now()
    and (l.source_link_id is null or exists (
      select 1 from public.public_links root
      where root.id = l.source_link_id and root.revoked_at is null and root.expires_at > now()
    ));
  if not found then return 'unavailable'; end if;

  select q.expires_at into expires from public.quotes q
  where q.company_id = view_link.company_id and q.id = view_link.subject_id
    and q.status in ('sent', 'viewed') and q.expires_at > now();
  if not found then return 'unavailable'; end if;

  insert into public.public_links (
    token_hash, company_id, purpose, subject_type, subject_id, expires_at, max_uses, source_link_id
  ) values (
    p_token_hash, view_link.company_id, 'quote_accept', 'quote', view_link.subject_id,
    least(view_link.expires_at, expires), 1, view_link.id
  ) on conflict (token_hash) do nothing;
  if found or exists (
    select 1 from public.public_links l where l.token_hash = p_token_hash
      and l.source_link_id = view_link.id and l.purpose = 'quote_accept'
      and l.revoked_at is null and l.uses = 0 and l.expires_at > now()
  ) then return 'ready'; end if;
  return 'spent';
end $$;

revoke execute on function public.api_issue_quote_accept_link(uuid, text) from public, anon, authenticated;
grant execute on function public.api_issue_quote_accept_link(uuid, text) to service_role;
