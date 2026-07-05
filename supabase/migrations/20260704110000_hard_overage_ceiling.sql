-- #12 Phase 0.3 — the overage cap can no longer be disabled (un-defeatable
-- system ceiling). overage_cap_multiplier was nullable with "NULL = no cap",
-- which let an owner (or a compromised/careless account) send UNBOUNDED metered
-- segments on our dollar — the audit's remaining Phase 0 hole
-- (docs/PRICING-AUDIT.md §5.1.2 / §8). Now the column is NOT NULL and bounded
-- to <= 10x the plan quota (starter 5,000 / pro 25,000 outbound segments per
-- period). Combined with the existing 250-segment/trailing-hour rate limit,
-- unpaid-overage exposure is bounded "no matter what".
--
-- Crucially this needs NO function change: gate_outbound_send + the shared
-- outbound_spend_check already guard the cap behind
-- `if overage_cap_multiplier is not null` — now ALWAYS true, so the cap always
-- applies. The owner's soft cap still lives in the same column (1..10); "no
-- cap" simply resolves to the 10x hard maximum. A deliberate unlimited tier can
-- be added later if wanted (default 10x here, tweakable — §8).

-- Pull a previously-uncapped (NULL) or over-ceiling (>10) company to the 10x max.
update public.companies
   set overage_cap_multiplier = 10.00
 where overage_cap_multiplier is null
    or overage_cap_multiplier > 10;

alter table public.companies
  alter column overage_cap_multiplier set not null,
  alter column overage_cap_multiplier set default 3.00;

-- The soft cap an owner may set is now bounded to the (0, 10] safety range.
alter table public.companies
  add constraint companies_overage_cap_range
  check (overage_cap_multiplier > 0 and overage_cap_multiplier <= 10);
