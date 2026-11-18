alter table public.messages
  add column receipt_checked_at timestamptz,
  add column receipt_finalized_at timestamptz;

create index messages_outbound_receipt_reconcile_idx
  on public.messages (receipt_checked_at asc nulls first, created_at, id)
  where direction = 'outbound' and telnyx_message_id is not null
    and status in ('queued', 'sent') and receipt_finalized_at is null;
