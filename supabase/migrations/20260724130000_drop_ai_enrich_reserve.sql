-- Contract half of the 20260724090000 expand/contract: drop ai_enrich_reserve.
--
-- When the per-feature AI ledger landed, `ai_enrich_reserve` was kept working
-- as a shim, re-pointed at `ai_usage_reserve`, because migrations run BEFORE
-- `wrangler deploy` and the still-deployed Worker was calling it. That Worker
-- has long since been replaced: no code in this repo calls the function any
-- more (the only remaining references are the migrations that defined it), and
-- every AI cost center now reserves through `ai_usage_reserve` with its own
-- feature key.
--
-- Leaving it would be a second, silently-diverging door onto the usage ledger:
-- it hard-codes `feature = 'task_enrichment'`, so any future caller reaching
-- for the shorter name would quietly bill the wrong bucket. Dropping it makes
-- that mistake impossible rather than merely unlikely.
--
-- Safe to drop: a FUNCTION carries no data, so the down-side of being wrong is
-- a failed call, not a lost row, and the sole caller shipped weeks of deploys
-- ago.

drop function if exists public.ai_enrich_reserve(uuid, integer, integer);
