create function public.api_workspace_export_media(
  p_company uuid, p_before timestamptz, p_kind text, p_after uuid,
  p_item uuid, p_limit integer, p_hidden uuid[]
)
returns table (id uuid, file_name text, content_type text, size_bytes bigint, storage_path text)
language sql stable security definer set search_path = ''
as $$
  select files.id, files.file_name, files.content_type, files.size_bytes, files.storage_path
  from (
    select a.id, a.file_name, a.content_type, a.size_bytes, a.storage_path
    from public.attachments a
    left join public.conversations c on c.id = a.conversation_id and c.company_id = a.company_id
    where p_kind = 'attachment' and a.company_id = p_company
      and a.created_at <= p_before and a.deleted_at is null and a.quarantined_at is null
      and a.storage_path is not null
      and (a.conversation_id is null or
        (c.id is not null and c.deleted_at is null and not (c.phone_number_id = any (p_hidden))))
    union all
    select a.id, null::text, a.content_type, a.size_bytes, a.storage_path
    from public.message_attachments a
    join public.messages m on m.id = a.message_id and m.company_id = a.company_id
    join public.conversations c on c.id = m.conversation_id and c.company_id = a.company_id
    where p_kind = 'mms' and a.company_id = p_company
      and a.created_at <= p_before and a.quarantined_at is null and a.storage_path is not null
      and m.deleted_at is null and c.deleted_at is null and not (c.phone_number_id = any (p_hidden))
    union all
    select k.id, 'voicemail-' || k.id::text || '.mp3', 'audio/mpeg', null::bigint, k.voicemail_path
    from public.calls k
    where p_kind = 'voicemail' and k.company_id = p_company and k.created_at <= p_before
      and k.deleted_at is null and k.voicemail_deleted_at is null and k.voicemail_path is not null
      and not (k.phone_number_id = any (p_hidden))
  ) files
  where (p_after is null or files.id > p_after) and (p_item is null or files.id = p_item)
  order by files.id
  limit least(greatest(p_limit, 1), 101);
$$;

revoke execute on function public.api_workspace_export_media(uuid, timestamptz, text, uuid, uuid, integer, uuid[])
  from public, anon, authenticated;
grant execute on function public.api_workspace_export_media(uuid, timestamptz, text, uuid, uuid, integer, uuid[])
  to service_role;