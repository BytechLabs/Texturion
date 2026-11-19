alter table public.widget_verifications add column telnyx_message_id text;

create unique index widget_verifications_telnyx_message_id_idx
  on public.widget_verifications (telnyx_message_id)
  where telnyx_message_id is not null;
