create function public.search_tsquery(p_query text)
returns tsquery
language plpgsql
immutable strict
set search_path = ''
as $$
declare
  parsed tsquery := websearch_to_tsquery('english', p_query);
  last_word text := substring(p_query from '(?:^|[[:space:]])([[:alnum:]]{3,})[[:space:]]*$');
  term tsquery;
begin
  -- An unmatched quote makes the remaining input a phrase.
  if last_word is null or mod(length(p_query) - length(replace(p_query, '"', '')), 2) <> 0 then
    return parsed;
  end if;

  term := plainto_tsquery('english', last_word);
  if numnode(term) = 1 and right(parsed::text, length(term::text)) = term::text then
    -- Append to the parsed lexeme so operators, stemming and quoting stay intact.
    return (parsed::text || ':*')::tsquery;
  end if;
  return parsed;
end;
$$;

revoke execute on function public.search_tsquery(text) from public, anon, authenticated;

do $migration$
declare
  search_function regprocedure :=
    'public.api_search_v2(uuid,text,integer,integer,integer,integer,integer,timestamptz,uuid,uuid[],integer)'::regprocedure;
  definition text := pg_get_functiondef(search_function);
  original text := 'websearch_to_tsquery(''english'', p_q)';
  updated text := replace(definition, original, 'public.search_tsquery(p_q)');
begin
  if (length(definition) - length(replace(definition, original, ''))) / length(original) <> 2 then
    raise exception 'api_search_v2: expected the message predicate and headline to use websearch_to_tsquery';
  end if;
  execute updated;
end;
$migration$;

revoke execute on function public.api_search_v2(uuid, text, int, int, int, int, int, timestamptz, uuid, uuid[], int)
  from public, anon, authenticated;
grant execute on function public.api_search_v2(uuid, text, int, int, int, int, int, timestamptz, uuid, uuid[], int)
  to service_role;
