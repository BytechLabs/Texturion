create function public.broadcast_quote_acceptance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  quote_id uuid;
  number_id uuid;
begin
  if jsonb_typeof(new.payload -> 'quote_id') is distinct from 'string'
     or not pg_input_is_valid(new.payload ->> 'quote_id', 'pg_catalog.uuid') then
    return null;
  end if;

  quote_id := (new.payload ->> 'quote_id')::uuid;
  select conversations.phone_number_id into number_id
    from public.quotes
    join public.conversations on conversations.id = quotes.conversation_id
     and conversations.company_id = quotes.company_id
   where quotes.id = quote_id
     and quotes.company_id = new.company_id
     and quotes.conversation_id = new.conversation_id
     and conversations.deleted_at is null;

  if number_id is not null then
    perform public.broadcast_number_scoped(
      jsonb_build_object('conversation_id', new.conversation_id, 'quote_id', quote_id),
      'quote.updated', new.company_id, number_id
    );
  end if;
  return null;
end;
$$;

revoke all on function public.broadcast_quote_acceptance() from public, anon, authenticated;

create trigger broadcast_quote_acceptance
after insert on public.conversation_events
for each row when (new.type = 'quote_accepted')
execute function public.broadcast_quote_acceptance();
