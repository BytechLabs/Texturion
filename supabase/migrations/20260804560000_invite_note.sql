-- #521 — the one thing the owner knows and the product was throwing away.
--
-- Split out of #286, whose Scope carried it and whose Acceptance did not:
--
--   "Let the owner set expectations, e.g. an optional note delivered with the
--    invite. The owner knows why they are adding this person; the product
--    currently discards that context entirely."
--
-- The joining orientation #286 shipped tells a new member what the PRODUCT is.
-- It cannot tell them what their own crew expects of them, which is the part
-- they will ask a colleague about on day one.
--
-- WRITE ONCE, and the column carries no update path on purpose. An invite that
-- has been sent is a thing somebody has read; editing the note afterwards would
-- change what the record says without changing what the person saw. There is no
-- PATCH for invites today and this does not add one.
--
-- CAPPED AT 500. The invite form is not a message composer. Long enough for
-- "Dave is covering the north side while Priya is on leave, he mostly needs the
-- schedule", short enough that it renders above an accept button without
-- becoming the email. The cap is a constraint rather than a client-side
-- nicety, because the client is three clients.
--
-- NULLABLE, and null is the ordinary case. An owner who leaves it blank gets
-- exactly today's flow, which is the shape #521 asks for: "optional
-- everywhere".

alter table public.invites
  add column if not exists note text
    check (note is null or char_length(note) <= 500);

comment on column public.invites.note is
  '#521: why this person is being added, in the inviter''s own words. Set at '
  'create, never edited: an invite already sent is a thing somebody has read. '
  'Null is the ordinary case.';
