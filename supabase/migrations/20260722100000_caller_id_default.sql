-- #193: caller ID defaults to the company name platform-wide.
--
--   cnam_display_name stays the owner's EXPLICIT override (null = default).
--   The effective outbound listing is now cnam_display_name, or the company
--   name sanitized to the carrier CNAM alphabet when unset — resolved
--   server-side everywhere (GET /v1/company's caller_id_effective and the
--   Telnyx cnam_listing push both apply the same rule).
--
--   cnam_submitted_at records when the effective listing was last pushed to
--   the carrier side. CNAM propagation across carrier databases takes days
--   and Telnyx's phone-number voice settings API gives no propagation status
--   (the PATCH just echoes the stored settings), so this timestamp is the
--   whole honest state machine: clients show "submitted <when>, carriers
--   take a few days" from it; there is no fabricated "done" transition.

alter table public.companies
  add column cnam_submitted_at timestamptz;
