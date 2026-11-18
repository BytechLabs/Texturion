create extension if not exists unaccent with schema extensions;

create text search configuration public.search_english (copy = pg_catalog.english);
alter text search configuration public.search_english
  alter mapping for word, hword, hword_part, asciiword, asciihword, hword_asciipart
  with extensions.unaccent, pg_catalog.english_stem;

create index messages_search_english_idx
  on public.messages using gin (to_tsvector('public.search_english'::regconfig, body))
  where deleted_at is null and reaction_to_message_id is null;

create function public.search_text_snippet(p_text text, p_query text)
returns text language sql immutable strict set search_path = ''
as $$
  select case when hit_position > 0 then
    (case when start_at > 1 then '…' else '' end) ||
    substr(p_text, start_at, 160) ||
    (case when length(p_text) >= start_at + 160 then '…' else '' end)
  else
    ts_headline('public.search_english', p_text, public.search_tsquery(p_query),
      'MaxFragments=1, MinWords=8, MaxWords=24')
  end
  from (select strpos(lower(p_text), lower(p_query)) as hit_position) match
  cross join lateral (select greatest(1, hit_position - 40) as start_at) excerpt;
$$;

do $migration$
declare
  definition text;
  updated text;
  edit record;
begin
  for edit in select * from (values
    ('public.search_tsquery(text)', '''english''', '''public.search_english'''),
    ('public.api_find_thread_messages(uuid,uuid,text)',
     'm.body_tsv @@ public.search_tsquery(p_query)',
     'to_tsvector(''public.search_english''::regconfig, m.body) @@ public.search_tsquery(p_query)'),
    ('public.api_search_v2(uuid,text,integer,integer,integer,integer,integer,timestamptz,uuid,uuid[],integer)',
     'm0.body_tsv @@ public.search_tsquery(p_q)',
     'm0.reaction_to_message_id is null and to_tsvector(''public.search_english''::regconfig, m0.body) @@ public.search_tsquery(p_q)'),
    ('public.api_search_v2(uuid,text,integer,integer,integer,integer,integer,timestamptz,uuid,uuid[],integer)',
     $old$ts_headline('english', m.body,
                                        public.search_tsquery(p_q))$old$,
     $new$ts_headline('public.search_english', m.body, public.search_tsquery(p_q),
                                        'MaxFragments=1, MinWords=8, MaxWords=24')$new$),
    ('public.api_search_v2(uuid,text,integer,integer,integer,integer,integer,timestamptz,uuid,uuid[],integer)',
     'left(t.body, 160)', 'public.search_text_snippet(t.body, p_q)'),
    ('public.api_search_v2(uuid,text,integer,integer,integer,integer,integer,timestamptz,uuid,uuid[],integer)',
     'left(c.voicemail_transcript, 160)', 'public.search_text_snippet(c.voicemail_transcript, p_q)'),
    ('public.api_search_v2(uuid,text,integer,integer,integer,integer,integer,timestamptz,uuid,uuid[],integer)',
     $old$c.voicemail_transcript ilike ('%' || replace(replace(replace(p_q, '', '\'), '%', '\%'), '_', '\_') || '%')$old$,
     $new$c.voicemail_transcript ilike ('%' || replace(replace(replace(p_q, '\', '\\'), '%', '\%'), '_', '\_') || '%')$new$)
  ) as edits(signature, anchor, replacement)
  loop
    definition := pg_get_functiondef(edit.signature::regprocedure);
    updated := replace(definition, edit.anchor, edit.replacement);
    if updated = definition then
      raise exception 'Search snippet anchor missing from %: %', edit.signature, edit.anchor;
    end if;
    execute updated;
  end loop;
end $migration$;

revoke execute on function public.search_text_snippet(text, text) from public, anon, authenticated;
