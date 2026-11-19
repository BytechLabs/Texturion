do $$
declare
  definition text := pg_get_functiondef(
    'public.thread_inbound_message(uuid,uuid,text,text,text,text,integer,integer,text,text)'::regprocedure
  );
begin
  if strpos(definition, 'v_contact_id uuid;') = 0
     or strpos(definition, 'returning ct.id into v_contact_id;') = 0
     or strpos(definition, '''created'', v_created,') = 0 then
    raise exception 'thread_inbound_message contact creation anchors moved';
  end if;
  definition := replace(definition, 'v_contact_id uuid;',
    'v_contact_id uuid;' || chr(10) || '  v_contact_created boolean := false;');
  definition := replace(definition, 'returning ct.id into v_contact_id;',
    'returning ct.id, ct.xmax = 0 into v_contact_id, v_contact_created;');
  definition := replace(definition, '''created'', v_created,',
    '''created'', v_created,' || chr(10) ||
    '    ''contact_id'', v_contact_id,' || chr(10) ||
    '    ''contact_created'', v_created and v_contact_created,');
  execute definition;
end $$;
