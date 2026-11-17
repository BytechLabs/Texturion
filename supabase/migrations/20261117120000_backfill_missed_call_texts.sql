-- Missed-call events identify old text-backs exactly; content and timing do not.
update public.messages m
   set automated = true,
       automation = 'missed_call_text'
  from public.conversation_events e
 where e.type = 'missed_call'
   and e.payload ->> 'message_id' = m.id::text
   and (not coalesce(m.automated, false)
        or m.automation is distinct from 'missed_call_text');
