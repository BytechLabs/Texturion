-- Storage usage counts EVERY kind of block storage, and names each honestly.
--
-- Founder report: Settings, Usage read "967.2 KB of files on notes, 1.1 MB of
-- picture messages". Three things were wrong with that.
--
--   1. VOICEMAIL RECORDINGS WERE INVISIBLE. We download every voicemail into
--      our own `voicemails` bucket and delete the Telnyx copy, so the audio is
--      ours to hold — but the figure only summed generic attachments and MMS
--      media. A workspace with megabytes of recordings was told it had none.
--
--   2. "picture messages" stopped being true at #189: an MMS now carries audio,
--      video, PDFs, contact cards, and calendar invites. The founder's own
--      voice message is the counter-example.
--
--   3. Media we SEND is stored too, and was folded in with media we receive, so
--      neither could be seen.
--
-- The function now returns a per-kind breakdown plus `total_bytes` measured
-- from storage.objects — the physical truth of what the buckets hold. Every
-- bucket writes `{company_id}/...` paths (attachments, mms-media, voicemails),
-- so the prefix match covers all three and picks up a future bucket that
-- follows the same convention. `other_bytes` is whatever the physical total
-- exceeds the classified kinds by (a soft-deleted file not yet swept, an
-- unclassified bucket), so the breakdown can never quietly under-report.
--
-- attachments_bytes and mms_bytes keep their exact prior meaning: the upload
-- budget gate reads attachments_bytes, and changing it would change what that
-- gate admits.
--
-- Storage stays FREE and capless (#121/D34) — these are honest figures, never
-- a budget.

create or replace function public.api_storage_usage(
  p_company_id uuid
) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with classified as (
    select
      -- Live generic attachments (files on notes and tasks). UNCHANGED
      -- semantics: this is the arm the upload budget gate reads.
      coalesce((
        select sum(a.size_bytes)
        from public.attachments a
        where a.company_id = p_company_id
          and a.deleted_at is null
      ), 0)::bigint as attachments_bytes,
      -- All stored MMS media, and the same split by who sent it.
      coalesce((
        select sum(m.size_bytes)
        from public.message_attachments m
        where m.company_id = p_company_id
      ), 0)::bigint as mms_bytes,
      coalesce((
        select sum(a.size_bytes)
        from public.message_attachments a
        join public.messages m on m.id = a.message_id
        where a.company_id = p_company_id
          and m.direction = 'inbound'
      ), 0)::bigint as received_media_bytes,
      coalesce((
        select sum(a.size_bytes)
        from public.message_attachments a
        join public.messages m on m.id = a.message_id
        where a.company_id = p_company_id
          and m.direction = 'outbound'
      ), 0)::bigint as sent_media_bytes,
      coalesce((
        select sum((o.metadata->>'size')::bigint)
        from storage.objects o
        where o.bucket_id = 'voicemails'
          and o.name like p_company_id::text || '/%'
      ), 0)::bigint as voicemail_bytes,
      -- The physical truth: everything this company holds, in every bucket.
      coalesce((
        select sum((o.metadata->>'size')::bigint)
        from storage.objects o
        where o.name like p_company_id::text || '/%'
      ), 0)::bigint as total_bytes
  )
  select jsonb_build_object(
    'attachments_bytes', c.attachments_bytes,
    'mms_bytes', c.mms_bytes,
    'received_media_bytes', c.received_media_bytes,
    'sent_media_bytes', c.sent_media_bytes,
    'voicemail_bytes', c.voicemail_bytes,
    'total_bytes', c.total_bytes,
    -- Never negative: the classified sums read live DB rows while the total
    -- reads objects, so a swept-but-not-yet-deleted row could otherwise push
    -- this below zero.
    'other_bytes', greatest(
      c.total_bytes
        - c.attachments_bytes
        - c.mms_bytes
        - c.voicemail_bytes,
      0)
  )
  from classified c
$$;

revoke execute on function public.api_storage_usage(uuid)
  from public, anon, authenticated;
grant execute on function public.api_storage_usage(uuid)
  to service_role;
