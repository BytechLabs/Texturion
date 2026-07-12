-- D43 (#135) deletion wave: cell forwarding and the cell bridge are GONE —
-- the browser is the phone, both directions. Founder-binding ("No forwarding
-- whatsoever, delete all that"):
--
--   * companies.forward_to_cell — the MCTB forward target. The webhook
--     stopped reading it in the phase-2 rework; the settings PATCH and the
--     UI card die in the same commit as this migration.
--   * company_members.call_cell_* — the D38 outbound cell-bridge target and
--     its D40 SMS verification state. POST /v1/calls (dial-me-first bridge)
--     and the code-send/verify endpoints are deleted; browser calls carry
--     no cell anywhere.
--
-- Data loss is the point: a phone number we no longer use is a liability
-- row, not an asset.

alter table public.companies
  drop column if exists forward_to_cell;

alter table public.company_members
  drop column if exists call_cell_e164,
  drop column if exists call_cell_verified_at,
  drop column if exists call_cell_code_hash,
  drop column if exists call_cell_code_expires_at,
  drop column if exists call_cell_code_attempts,
  drop column if exists call_cell_code_sent_at,
  drop column if exists call_cell_code_window_start,
  drop column if exists call_cell_code_window_sends;
