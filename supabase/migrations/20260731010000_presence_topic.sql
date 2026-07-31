-- #302 — authorize a presence topic, so the crew can see who else is on a thread.
--
-- THE PROBLEM. The inbox is shared by design and nothing in it knows two people
-- may be looking at the same conversation. Two answers thirty seconds apart
-- reads, from the customer's side, as a business that does not know what it is
-- doing. The quieter failure costs more: everyone assumes somebody else has it.
--
-- WHY A SEPARATE TOPIC RATHER THAN THE EXISTING NUMBER ONE.
--
-- Presence could ride `company:{id}:number:{n}`, which every client already
-- joins, and that would need no migration at all. Two reasons not to:
--
--   1. LIFECYCLE. The number channel is built and torn down by the realtime
--      provider under rules that took #480 and #483 to get right — it is
--      recreated under the same name whenever the joined-number set changes.
--      Presence tracking hung off that channel would be dropped and re-tracked
--      by an effect that knows nothing about presence, and handlers registered
--      on a channel mid-teardown are the specific failure that file warns about.
--   2. FAN-OUT. Presence is chatty by nature — heartbeats and typing — and the
--      number topic carries message delivery. #251 says this fan-out has never
--      been measured, so the conservative shape is the one where a presence
--      problem cannot starve a customer's message.
--
-- WHY THIS NEEDS NO NEW ACCESS RULE. A conversation belongs to exactly one
-- phone number, so access to the number IS access to the conversation (#106,
-- D88). Suffixing the number topic inherits that boundary exactly: the same
-- `member_number_level(...) <> 'none'` test decides both. A member who cannot
-- see a number cannot see who is looking at its threads, which matters — the
-- presence payload names a conversation.

create or replace function public.is_company_topic_member(topic_text text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (
      select 1
      from public.company_members cm
      where cm.user_id = auth.uid()
        and cm.deactivated_at is null
        and topic_text = 'company:' || cm.company_id::text
    )
    or exists (
      -- The number topic, and (#302) its `:presence` sibling. ONE anchored
      -- pattern decides both, and the uuid it extracts runs the same access
      -- test — so the two cannot drift apart into a topic that is readable but
      -- should not be.
      --
      -- Anchored end to end (`^…$`), which also tightens what came before: the
      -- old rule matched the prefix with LIKE and the tail with a regex, so
      -- nothing said the two had to be adjacent.
      select 1
      from public.company_members cm
      where cm.user_id = auth.uid()
        and cm.deactivated_at is null
        and topic_text ~* (
              '^company:' || cm.company_id::text ||
              ':number:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' ||
              '(:presence)?$'
            )
        and public.member_number_level(
              auth.uid(),
              (regexp_match(
                topic_text,
                ':number:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})'
              ))[1]::uuid
            ) <> 'none'
    );
$$;

revoke execute on function public.is_company_topic_member(text) from public, anon;
grant execute on function public.is_company_topic_member(text) to authenticated;

comment on function public.is_company_topic_member(text) is
  'Realtime topic authorization. Admits company:{id}, company:{id}:number:{n} '
  '(D88) and company:{id}:number:{n}:presence (#302) — the last two share one '
  'access test so a presence topic can never outlive the number access it '
  'inherits.';

-- ---------------------------------------------------------------------------
-- Presence needs its OWN policies, and finding that out took a live browser.
--
-- The existing `company_topic_read` policy is `for select` and filters
-- `extension = 'broadcast'`. That is exactly right for what came before:
-- every broadcast in this system is server-generated (triggers calling
-- `realtime.send`), so a client only ever READS, and only broadcasts exist.
--
-- Presence breaks both halves of that assumption. Its messages carry
-- `extension = 'presence'`, so the broadcast filter refuses them; and a client
-- ANNOUNCES itself with `track()`, so it writes as well as reads.
--
-- WHAT MADE THIS WORTH A COMMENT: the channel still reported SUBSCRIBED. Join
-- succeeded, presence was silently refused underneath, and nothing surfaced —
-- two browsers sat on the same conversation seeing nothing, with no error on
-- either. A policy that admits the join and drops the payload looks exactly
-- like a feature that does not work.
--
-- Scoped to `:presence` topics only. Broadcast authorization is untouched, and
-- write access is granted for presence and nothing else — a client still cannot
-- forge a `message.created`.
-- ---------------------------------------------------------------------------

create policy presence_topic_read on realtime.messages
for select to authenticated using (
  realtime.messages.extension = 'presence'
  and realtime.topic() like '%:presence'
  and public.is_company_topic_member(realtime.topic())
);

create policy presence_topic_write on realtime.messages
for insert to authenticated with check (
  realtime.messages.extension = 'presence'
  and realtime.topic() like '%:presence'
  and public.is_company_topic_member(realtime.topic())
);
