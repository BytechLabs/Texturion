-- #521 — the inviter's words, carried to the person they were written for.
--
-- `invites.note` is where an owner says why they are adding somebody. This is
-- where it lands, and the copy is deliberate rather than a normalisation
-- failure.
--
-- WHY COPY RATHER THAN JOIN BACK TO THE INVITE.
--
-- There is no foreign key from a membership to the invite that created it, and
-- there could not usefully be one: the only link is the email address, matched
-- case-insensitively at accept time. Reading the note later would mean
-- re-deriving that match on every orientation load, against a table whose rows
-- are expected to be tidied once they are spent.
--
-- The stronger reason is that the two facts are different. `invites.note` is
-- what an owner wrote on a particular day, and it belongs to the invite - a
-- record of a message that was sent. `company_members.joining_note` is what THIS
-- member was told when they joined, which has to keep being true after the
-- invite is revoked, expired, re-sent to the same address, or deleted. A join
-- would make the second depend on the first still existing, which is exactly
-- what it must not do.
--
-- WRITE ONCE, at accept, and nothing updates it afterwards. The member has read
-- it by then.
--
-- NULLABLE, and null is the ordinary case: every membership that predates this,
-- every owner who created their own workspace, and every invite sent without a
-- note. The orientation shows the screen only when there is something to show.

alter table public.company_members
  add column if not exists joining_note text
    check (joining_note is null or char_length(joining_note) <= 500);

comment on column public.company_members.joining_note is
  '#521: what this member was told about why they were added, copied from '
  'invites.note when they accepted. Copied rather than joined so it survives '
  'the invite being revoked, re-sent or tidied away. Null is the ordinary case.';
