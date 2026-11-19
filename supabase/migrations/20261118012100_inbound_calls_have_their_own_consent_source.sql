alter type public.consent_source_t add value if not exists 'inbound_call';

alter table public.contact_consent_events
  drop constraint contact_consent_events_source_check,
  add constraint contact_consent_events_source_check check (source in (
    'inbound_sms', 'inbound_call', 'attested', 'import', 'stop_keyword',
    'start_keyword', 'carrier', 'manual', 'widget_form'
  ));

do $$
declare
  v_sql text := pg_get_functiondef('public.contacts_record_consent()'::regprocedure);
  v_old text := $old$case when new.consent_source = 'inbound_sms' then 'implied' else 'express' end$old$;
begin
  if strpos(v_sql, v_old) = 0 then
    raise exception 'contacts_record_consent: expected consent mapping';
  end if;
  execute replace(v_sql, v_old,
    $new$case when new.consent_source::text in ('inbound_sms', 'inbound_call')
         then 'implied' else 'express' end$new$);
end $$;
