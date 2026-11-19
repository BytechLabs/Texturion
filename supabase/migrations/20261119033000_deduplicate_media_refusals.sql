lock table public.conversation_events in share row exclusive mode;

delete from public.conversation_events duplicate
using public.conversation_events first
where duplicate.type = 'media_refused'
  and first.type = 'media_refused'
  and duplicate.payload ->> 'message_id' = first.payload ->> 'message_id'
  and duplicate.payload ->> 'index' = first.payload ->> 'index'
  and (duplicate.created_at, duplicate.id) > (first.created_at, first.id);

create unique index conversation_events_media_refusal_item_idx
  on public.conversation_events ((payload ->> 'message_id'), (payload ->> 'index'))
  where type = 'media_refused';
