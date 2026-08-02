-- ---------------------------------------------------------------------------
-- #246 — a merged number keeps resolving to the surviving contact.
--
-- The merge leaves a tombstone so the loser's number still has a row (see
-- 20260802020000). What that migration did NOT do is make anything FOLLOW it,
-- and without this the merge quietly undoes itself: the customer's next text
-- from the old number threads onto the tombstone, a conversation appears under
-- a contact nobody can see, and the history splits again.
--
-- # Why a trigger and not three edited functions
--
-- Three live functions upsert a contact by number and thread from it:
-- `thread_inbound_message`, `api_thread_call` and `claim_missed_call_text`.
-- Editing all three would mean reproducing three long bodies verbatim to change
-- one line each — the exact shape of edit that silently drops a statement
-- somebody added last month, and every future threading path would have to
-- remember the hop.
--
-- A trigger on the two tables that carry `contact_id` is one rule in one place,
-- and it holds for paths that do not exist yet. The redirect is idempotent and
-- one hop deep, which is all it can ever need: `api_merge_contacts` refuses to
-- merge into a row that is itself merged, so chains cannot form.
-- ---------------------------------------------------------------------------

create or replace function public.follow_merged_contact()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_target uuid;
begin
  if new.contact_id is null then
    return new;
  end if;

  select c.merged_into into v_target
    from public.contacts c
   where c.id = new.contact_id;

  if v_target is not null then
    new.contact_id := v_target;
  end if;
  return new;
end;
$$;

comment on function public.follow_merged_contact is
  '#246: rewrites a tombstone contact_id to its survivor on insert/update. One '
  'hop only — api_merge_contacts refuses to merge into an already-merged row, '
  'so chains cannot form.';

drop trigger if exists conversations_follow_merged_contact on public.conversations;
create trigger conversations_follow_merged_contact
  before insert or update of contact_id on public.conversations
  for each row execute function public.follow_merged_contact();

drop trigger if exists calls_follow_merged_contact on public.calls;
create trigger calls_follow_merged_contact
  before insert or update of contact_id on public.calls
  for each row execute function public.follow_merged_contact();

-- ---------------------------------------------------------------------------
-- The merge itself must not fight its own trigger.
--
-- `api_merge_contacts` moves conversations onto the survivor with an UPDATE of
-- contact_id, which now fires this trigger — harmlessly, because the target is
-- the survivor and the survivor is not a tombstone. But the tombstone is
-- stamped AFTER the conversations move in that function, and if it were ever
-- reordered the trigger would silently redirect the moves back onto the
-- survivor's own id. It already does the right thing; this comment exists so a
-- future reorder is a decision rather than an accident.
-- ---------------------------------------------------------------------------
