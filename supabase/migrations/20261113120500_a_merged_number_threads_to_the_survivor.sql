-- A text or call from a merged contact's number threads under the survivor.
-- These functions looked the thread up by the tombstone's id, so they missed the
-- moved thread: an open one made the insert collide and refuse the text, a closed
-- one was duplicated instead of reopened.

create or replace function public.live_contact_id(p_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select c.merged_into from public.contacts c where c.id = p_id), p_id)
$$;

comment on function public.live_contact_id(uuid) is
  'The contact a number''s threads belong to: the survivor for a merged contact, otherwise the contact itself.';

revoke execute on function public.live_contact_id(uuid) from public, anon, authenticated;
grant execute on function public.live_contact_id(uuid) to service_role;

do $mig$
declare
  v_fn     regprocedure;
  v_anchor text;
  v_def    text;
begin
  -- Each anchor is the end of the function's contact resolution, every branch included.
  for v_fn, v_anchor in
    select t.fn, t.anchor from (values
      ('public.thread_inbound_message(uuid, uuid, text, text, text, text, integer, integer, text, text)'::regprocedure,
       E'    returning ct.id into v_contact_id;\n  end if;\n'),
      ('public.claim_missed_call_text(uuid, uuid, text, text, text, integer, integer)'::regprocedure,
       E'    returning ct.id into v_contact_id;\n  end if;\n'),
      ('public.api_thread_call(uuid, uuid, text, text, text, integer, boolean, text)'::regprocedure,
       E'      return ''{}''::jsonb;\n    end if;\n  end if;\n')
    ) as t(fn, anchor)
  loop
    v_def := pg_get_functiondef(v_fn);
    if (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor) is distinct from 1 then
      raise exception '%: the contact resolution anchor was not found exactly once', v_fn;
    end if;
    execute replace(v_def, v_anchor,
      v_anchor || E'\n  v_contact_id := public.live_contact_id(v_contact_id);\n');
  end loop;
end $mig$;

revoke execute on function public.thread_inbound_message(
  uuid, uuid, text, text, text, text, integer, integer, text, text)
  from public, anon, authenticated;
grant execute on function public.thread_inbound_message(
  uuid, uuid, text, text, text, text, integer, integer, text, text)
  to service_role;

revoke execute on function public.claim_missed_call_text(uuid, uuid, text, text, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.claim_missed_call_text(uuid, uuid, text, text, text, integer, integer)
  to service_role;

revoke execute on function public.api_thread_call(uuid, uuid, text, text, text, integer, boolean, text)
  from public, anon, authenticated;
grant execute on function public.api_thread_call(uuid, uuid, text, text, text, integer, boolean, text)
  to service_role;
