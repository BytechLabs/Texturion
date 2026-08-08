-- #294 — before and after, on the note rather than on the file.
--
-- ## Why the column is here and not on an attachment
--
-- D28 decided attachments enter through exactly two doors — a text, or a note — and
-- that a task's files are a DERIVED view over those, never a third upload path. So
-- "mark this photo as an after" cannot be a property of the photo without inventing
-- the ingress D28 removed.
--
-- A note already IS the link between a set of files and a job: it carries an author,
-- a moment, and a task_id. A tech does not photograph one thing before and a
-- different thing after — they take a handful when they arrive and a handful when
-- they finish, and each handful arrives together on one note. Labelling the note is
-- both the smaller change and the truer model of the work.
--
-- Grouping, ordering and attribution then cost nothing further: a job's photo set
-- groups by note, orders by the note's time, and attributes to the note's author.
--
-- ## Why it is nullable, and why that is the common case
--
-- Most notes are neither. A note saying the part is on order is not an unlabelled
-- before. NULL means neither, not that somebody forgot.
--
-- ## Why only notes
--
-- A customer's inbound photo is not a before. It is what they sent when they asked
-- for help, and letting the crew label somebody else's message would be a claim
-- about the customer's intent that nobody can support. The constraint enforces that
-- rather than leaving it to the route.

alter table public.messages
  add column if not exists work_phase text;

-- NOT VALID, then validated separately, and that ordering is deliberate: `messages`
-- is the largest table in the product, and a plain ADD CONSTRAINT holds an ACCESS
-- EXCLUSIVE lock for a full scan. NOT VALID takes the lock only for a catalogue
-- write and still checks every row written from here on, which is the part that
-- protects the data. VALIDATE then scans under SHARE UPDATE EXCLUSIVE, which reads
-- and writes both run through.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'messages_work_phase_check'
  ) then
    alter table public.messages
      add constraint messages_work_phase_check
      check (
        work_phase is null
        or (direction = 'note' and work_phase in ('before', 'after'))
      )
      not valid;
  end if;
end $$;

alter table public.messages validate constraint messages_work_phase_check;

comment on column public.messages.work_phase is
  '#294: on a NOTE only. Whether its photos show how the job looked on arrival or '
  'how it was left. NULL is the common case and means neither, not unfilled. A task '
  'groups its derived photo set by the note that carried each file, so this one '
  'column also supplies the grouping, the ordering and the attribution.';

-- For the other direction — show me the labelled sets — since the task drawer is
-- already served by the existing task_id index. Partial, so it stays tiny: almost
-- every row in this table is and will remain NULL here.
create index if not exists messages_work_phase_idx
  on public.messages (company_id, task_id)
  where work_phase is not null;
