alter table public.data_exports
  add column table_cursors jsonb not null default '{}'::jsonb;
