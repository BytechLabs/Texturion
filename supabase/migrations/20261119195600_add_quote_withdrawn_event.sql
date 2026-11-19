alter type public.conversation_event_type add value if not exists 'quote_withdrawn';
alter type public.conversation_event_type add value if not exists 'quote_declined';
alter type public.conversation_event_type add value if not exists 'quote_acceptance_reverted';
