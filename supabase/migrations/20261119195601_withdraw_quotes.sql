create or replace function public.quotes_transition_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status and not (
       (old.status = 'draft' and new.status in ('sent'))
    or (old.status = 'sent' and new.status in ('viewed', 'accepted', 'declined', 'expired', 'withdrawn'))
    or (old.status = 'viewed' and new.status in ('accepted', 'declined', 'expired', 'withdrawn'))
    or (old.status = 'accepted' and new.status in ('viewed'))
  ) then
    raise exception 'quote % cannot go from % to %', old.id, old.status, new.status using errcode = 'check_violation';
  end if;
  return new;
end $$;

alter function public.state_transition_expected(text, text, text) rename to state_transition_expected_before_quote_withdrawal;

create function public.state_transition_expected(p_machine text, p_from text, p_to text)
returns boolean
language sql immutable set search_path = '' as $$
  select public.state_transition_expected_before_quote_withdrawal(p_machine, p_from, p_to) or exists (
    select 1 from (values
      ('quote', 'sent', 'withdrawn'),
      ('quote', 'viewed', 'withdrawn'),
      ('quote', 'accepted', 'viewed')
    ) e(machine, from_state, to_state)
    where e.machine = p_machine and e.from_state = p_from and e.to_state = p_to
  );
$$;

revoke execute on function public.state_transition_expected(text, text, text) from public, anon, authenticated;

create function public.api_withdraw_quote(p_company_id uuid, p_quote_id uuid, p_actor uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  withdrawn public.quotes%rowtype;
begin
  update public.quotes q
  set status = 'withdrawn', decided_at = now(), updated_at = now()
  where q.company_id = p_company_id and q.id = p_quote_id
    and q.status in ('sent', 'viewed') and q.expires_at > now()
    and exists (select 1 from public.conversations c
      where c.company_id = q.company_id and c.id = q.conversation_id
        and c.deleted_at is null and c.purged_at is null)
  returning * into withdrawn;
  if not found then return false; end if;

  update public.public_links
  set revoked_at = now(), revoke_reason = 'quote withdrawn'
  where company_id = p_company_id and subject_type = 'quote' and subject_id = p_quote_id
    and purpose in ('quote_view', 'quote_accept', 'quote_decline') and revoked_at is null;

  insert into public.conversation_events (company_id, conversation_id, actor_user_id, type, payload)
  values (p_company_id, withdrawn.conversation_id, p_actor, 'quote_withdrawn',
    jsonb_build_object('quote_id', p_quote_id));
  return true;
end $$;

create function public.api_public_quote_withdrawal(p_token_hash text) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('contact_locale', contact.locale, 'company_locale', company.locale)
  from public.public_links l
  join public.quotes q on q.company_id = l.company_id and q.id = l.subject_id
  join public.companies company on company.id = q.company_id and company.deleted_at is null
  join public.conversations c on c.company_id = q.company_id and c.id = q.conversation_id
    and c.deleted_at is null and c.purged_at is null
  left join public.contacts contact on contact.company_id = q.company_id and contact.id = q.contact_id
  left join public.public_links source on source.id = l.source_link_id
  where l.token_hash = p_token_hash and l.purpose = 'quote_view' and l.subject_type = 'quote'
    and l.expires_at > now() and q.status = 'withdrawn'
    and (l.revoke_reason = 'quote withdrawn' or source.revoke_reason = 'quote withdrawn');
$$;

revoke execute on function public.api_withdraw_quote(uuid, uuid, uuid), public.api_public_quote_withdrawal(text)
  from public, anon, authenticated;
grant execute on function public.api_withdraw_quote(uuid, uuid, uuid), public.api_public_quote_withdrawal(text)
  to service_role;
