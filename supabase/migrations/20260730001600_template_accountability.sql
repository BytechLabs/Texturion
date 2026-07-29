-- #419 — a saved reply is the only object where one person's edit changes what
-- everyone else says to customers.
--
-- A bad message is one message. A bad template is every future send by every
-- crew member until somebody notices — and nobody notices quickly, because the
-- whole point of a saved reply is that you use it without reading it.
--
-- ---------------------------------------------------------------------------
-- THE PERMISSION IS NOT THE PROBLEM AND IS NOT CHANGED.
--
-- All four operations stay member-level. A three-person crew has no approval
-- workflow, and making a tech ask the owner before saving a reply they use
-- twenty times a day would kill the feature; the friction would cost more than
-- the risk. What was wrong is that the permission was paired with NO
-- RECOVERABILITY and NO ACCOUNTABILITY, and both are cheap to add without
-- touching who is allowed to do what.
--
-- It also scales badly in the direction the product sells. At 3 seats this is
-- nothing. At 15 on Pro — the plan we upsell into — "anyone can permanently
-- delete anyone's saved replies" is a different proposition.

alter table public.templates
  add column if not exists deleted_at timestamptz,
  -- Ask 3: not a permission, just visibility. In a crew of ten, "Sam changed
  -- this on Tuesday" settles the question before it becomes a dispute.
  add column if not exists updated_by uuid references auth.users(id) on delete set null;

comment on column public.templates.deleted_at is
  '#419: soft delete, consistent with tasks (D17) and attachments (D19). '
  'Templates were the one shared object that simply ceased to exist.';
comment on column public.templates.updated_by is
  '#419: who last edited this shared copy. Null means nobody has edited it '
  'since the column existed — created_by still says who wrote it.';

-- The unique name index has to ignore deleted rows, or a deleted saved reply
-- keeps its name hostage forever and recreating "On my way" fails with a
-- conflict pointing at a row nobody can see.
drop index if exists public.templates_name_uq;
create unique index if not exists templates_name_uq
  on public.templates (company_id, lower(name))
  where deleted_at is null;

-- Live rows only, which is every read path. Partial so the index stays the
-- size of the working set rather than the history.
create index if not exists templates_live_idx
  on public.templates (company_id, name) where deleted_at is null;
