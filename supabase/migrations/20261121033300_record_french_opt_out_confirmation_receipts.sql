alter table public.messages add column french_opt_out_confirmation_id text;

create unique index messages_french_opt_out_confirmation_id_idx
  on public.messages (french_opt_out_confirmation_id)
  where french_opt_out_confirmation_id is not null;
