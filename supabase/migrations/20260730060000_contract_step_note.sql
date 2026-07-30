-- #480 — correcting how the contract step must be performed.
--
-- The previous migration's comment says "deleting this one statement is the
-- contract step". **That instruction is wrong, and following it literally would
-- lose events.** Found by an adversarial review of #483 before anyone acted on
-- it; this migration replaces the function so the correction lives with the code
-- rather than in a commit message nobody reads at the moment they need it.
--
-- WHY A DELETION IS WRONG. The per-number send is guarded by
-- `if p_number is not null`. Delete the company send and a payload with no number
-- has nowhere left to go — and there is exactly one such event, `call.updated`
-- for a call whose number was deleted (`calls.phone_number_id` is
-- `on delete set null`). It would stop being delivered to anybody, silently.
--
-- So the contract step is turning the two sends into an EITHER/OR, which is what
-- this function now already expresses. When the store-distributed clients have
-- adopted the per-number topic, the change is to delete the marked line below —
-- the unconditional company send — leaving the `else` in place. The `else` is not
-- a fallback for the transition; it is the permanent route for an event that has
-- no number to be scoped to.
--
-- `supabase/tests/number_scoped_topics.test.sql` NT-4 is what would catch the
-- mistake: it asserts a null-number `call.updated` reaches the company topic. It
-- was written for this migration and it is the reason a wrong contract step
-- fails a gate instead of shipping.

create or replace function public.broadcast_number_scoped(
  p_payload jsonb,
  p_event text,
  p_company uuid,
  p_number uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if p_company is null then
    -- No company means no topic to send on. Silently doing nothing is right
    -- here: every caller is a trigger, and raising would abort the write that
    -- the event is merely describing.
    return;
  end if;

  -- ===== THE CONTRACT STEP DELETES EXACTLY THIS LINE =====
  -- The transition send, for clients that have not yet adopted the per-number
  -- topic. Two of the three ship through app stores, so removing it before they
  -- have updated would stop realtime for anyone still on an older build.
  --
  -- Delete this line and NOTHING ELSE. The if/else below is permanent.
  perform realtime.send(p_payload, p_event, 'company:' || p_company::text, true);
  -- ===== END OF THE TRANSITION =====

  if p_number is not null then
    -- The real boundary. Authorized by `is_company_topic_member`, which admits
    -- this shape only when `member_number_level` is not 'none' (D88).
    perform realtime.send(
      p_payload,
      p_event,
      'company:' || p_company::text || ':number:' || p_number::text,
      true);
  else
    -- PERMANENT, not a transitional fallback. An event with no number cannot be
    -- scoped to one, and there is exactly one: `call.updated` for a call whose
    -- number was deleted. Its access rule was deleted along with the number
    -- (`number_access.phone_number_id` is `on delete cascade`), so there is no
    -- restriction left to honour — a leak requires a restriction. Dropping the
    -- event instead would lose a state update to protect nothing.
    --
    -- Until the line above is deleted this is a duplicate of it, which is
    -- harmless: every handler is an idempotent, id-only refetch trigger.
    perform realtime.send(p_payload, p_event, 'company:' || p_company::text, true);
  end if;
end;
$function$;

comment on function public.broadcast_number_scoped(jsonb, text, uuid, uuid) is
  '#480: publish a number-scoped event to the per-number topic, or to the company '
  'topic when it has no number (permanent — a null-number call.updated has no '
  'other route). Plus, until the clients have adopted, one transition send to the '
  'company topic. The contract step deletes ONLY that marked line; NT-4 fails if '
  'the else goes with it.';
