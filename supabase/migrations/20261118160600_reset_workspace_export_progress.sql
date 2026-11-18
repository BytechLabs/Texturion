-- An unfinished archive needs to write the widened columns on every page.
update public.data_exports
set completed_tables = '[]'::jsonb,
    row_counts = '{}'::jsonb,
    table_cursors = '{}'::jsonb,
    stored_files = '{}'::jsonb,
    lease_token = null,
    lease_expires_at = null
where kind = 'workspace' and status = 'running';
