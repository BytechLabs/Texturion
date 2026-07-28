-- The alert ledger could not hold its own largest thresholds.
--
-- `usage_alerts.threshold` was `smallint` (max 32,767) because it was designed
-- for the §6 percent arms, where the only values are 80 and 100. Later arms
-- reused the column as a generic dedupe key holding an ABSOLUTE tier:
--
--   * #121 storage abuse — GB tiers, small, fine.
--   * #449 inbound volume — INBOUND_ABUSE_TIERS_SEGMENTS tops out at 50,000.
--
-- 50,000 does not fit in a smallint. `select 50000::smallint` is
-- "smallint out of range", so the upsert in `recordAndSendAlert` would throw
-- for the top two tiers (25,000 fits; 50,000 does not) — and the alert that
-- throws is the one telling the founder a tenant is flooding us with inbound
-- traffic they cannot cap. The louder the situation, the more certain the
-- failure.
--
-- Nothing had hit it yet: the tiers are per-period and no tenant has reached
-- 50,000 inbound segments in a period. It would have fired the first time one
-- did, which is precisely when nobody wants to be reading a stack trace.
--
-- Widening to `integer` rather than picking a bigger fixed width: the column is
-- a dedupe key that now holds "a percent, a GB count, or a segment count", and
-- the next arm to reuse it will not check this file first. Four bytes buys
-- enough room that it never needs to be asked again.
--
-- Widening is not destructive: every existing smallint value is representable,
-- the CHECK (threshold > 0) is unaffected, and the primary key rebuilds in
-- place.

-- destructive-ok: WIDENING only. smallint -> integer cannot truncate, because
-- every smallint value is representable as an integer; this is the one
-- direction of type change that is total. The CHECK (threshold > 0) is
-- unaffected and the composite primary key rebuilds in place. The reverse
-- (integer -> smallint) would be destructive and is exactly what this fixes.
alter table public.usage_alerts
  alter column threshold type integer;

comment on column public.usage_alerts.threshold is
  'Dedupe key for the alert ledger. 80/100 for the percent arms; an absolute tier for the #121 storage and #449 inbound-volume arms. INTEGER, not smallint: the inbound tiers reach 50,000 and would have overflowed on write.';
