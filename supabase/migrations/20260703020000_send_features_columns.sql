-- FEATURE-GAPS BUILD-NOW (Steps 1 & 2): company settings + auto-reply throttle
-- state for the after-hours away-reply and the one-tap review-request link.
-- A NEW migration — never edits a shipped one (D7/D14).
--
-- Three distinct clocks/settings, kept deliberately separate (FEATURE-GAPS §2):
--   * companies.timezone (D15, already shipped)     — the SHOP's civil clock.
--   * per-contact quiet hours (D4, destinationLocalHour) — the RECIPIENT clock
--     that gates COLD outbound. UNCHANGED here.
--   * companies.business_hours (this migration)     — the shop's OPEN-hours
--     window, interpreted in companies.timezone, that drives the away-reply.
--     This is NOT quiet hours and never gates a reply-exempt send.
--
-- ---------------------------------------------------------------------------
-- 1. After-hours / away auto-reply (Step 1) — company-level settings.
-- ---------------------------------------------------------------------------
-- business_hours: jsonb map of weekday -> { open, close } in 24h "HH:MM"
-- (company-local per companies.timezone). Keys are lowercase weekday names
-- ('mon'..'sun'); a weekday ABSENT from the map (or null) means "closed all
-- day" (every inbound that day is after-hours). The shape is validated in the
-- API layer (routes/company-hours) on every write, so the column stays a plain
-- jsonb with a sane default (all-empty = always after-hours until the owner
-- sets hours, but away_enabled defaults false so nothing fires until opted in).
--
-- away_enabled: master toggle. Default FALSE — the feature is inert until the
-- owner turns it on AND authors a message.
--
-- away_message: the OWNER-AUTHORED away text (FEATURE-GAPS §2 / DECISIONS: we
-- NEVER hard-code "we're closed"; emergency-aware wording is the owner's to
-- write). Merge-fields ({first_name}/{business_name}/{review_link}) are applied
-- at send time. Nullable; the away-reply guard requires a non-empty message
-- (checked in the send path AND the away-reply RPC), so enabling the toggle
-- without authoring a message sends nothing.
alter table public.companies
  add column business_hours jsonb   not null default '{}'::jsonb,
  add column away_enabled   boolean not null default false,
  add column away_message   text;

-- ---------------------------------------------------------------------------
-- 2. Review-request link (Step 2) — company-level Google review deep-link.
-- ---------------------------------------------------------------------------
-- google_review_link: the Place-ID writereview URL or a g.page/r short link,
-- stored once in settings. Nullable; the one-tap "Ask for a review" action is
-- disabled (with a reason) until it is set. We do NOT build review
-- monitoring/aggregation (FEATURE-GAPS §3 non-goal) — this is the entire
-- review-management surface: one link, merged into a manual one-tap send.
-- Validity (http/https URL) is enforced in the API layer on write.
alter table public.companies
  add column google_review_link text;

-- ---------------------------------------------------------------------------
-- 3. Auto-send throttle state (Step 0b) — per-conversation last auto-reply.
-- ---------------------------------------------------------------------------
-- conversations.last_auto_reply_at: the timestamp of the most recent
-- guard-mediated AUTO message (away-reply, and any future auto/assisted send)
-- into this conversation. The shared auto-send guard refuses to fire again
-- within a throttle window (default a few hours) so a burst of inbound texts
-- yields at most one auto-reply. Distinct from last_notified_at (§8
-- notification debounce) — that gates human alerts, this gates outbound
-- auto-messages. NULL = never auto-replied.
alter table public.conversations
  add column last_auto_reply_at timestamptz;

-- RLS / grants posture MIRRORS the existing columns exactly: companies and
-- conversations both have RLS enabled deny-by-default with NO anon/authenticated
-- grants (20260701000300_rls.sql); the Worker uses the service_role sb_secret_
-- key whose table-level DML grant (20260701030000_service_role_grants.sql)
-- already covers every column, so new columns need NO additional grant. Adding
-- nullable/defaulted columns touches no policy and no grant.
