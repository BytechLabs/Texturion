-- #232 phase 3 — which of the workspace's numbers a website conversation lands
-- on.
--
-- Nullable, and null is the answer for nearly every workspace: Starter includes
-- one number, so there is nothing to choose and nothing is asked. It only
-- becomes a question on Pro, where a service line and a sales line can sit in
-- one workspace and the website should reach whichever one the owner staffs.
--
-- ON DELETE SET NULL rather than a cascade or a restrict. Releasing a number is
-- an ordinary act a workspace does from the numbers screen, and it must not be
-- refused because the widget once pointed at it; nor should the row it points
-- at be able to vanish and leave this holding an id that resolves to nothing.
-- Falling back to "we have not been told" is the same state the workspace was
-- in before they chose, which is a state the resolver already handles.
--
-- The Worker matches this against the ACTIVE numbers anyway, so a SUSPENDED
-- choice — which is not a delete and so never fires this — also falls back.
-- Two different ways for the same setting to go stale, both landing on the
-- default rather than on a line that cannot send.

alter table public.companies
  add column if not exists widget_number_id uuid
    references public.phone_numbers(id) on delete set null;

comment on column public.companies.widget_number_id is
  '#232: the number a website-widget conversation lands on. Null means "not '
  'chosen" — the resolver falls back to the oldest active number, which is '
  'what every workspace had before this column existed. A choice that is no '
  'longer active falls back the same way.';
