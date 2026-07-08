/**
 * Plan intent: the /pricing plan-builder configuration, carried through signup
 * into the onboarding plan step so "what you build here is exactly what
 * checkout starts from" is literally true.
 *
 * The builder emits `/signup?plan=<PlanId>&modules=<comma list>`
 * (components/marketing/pricing/plan-math.ts signupHref). Signup parses and
 * validates that intent, stashes it in sessionStorage, and threads it through
 * BOTH auth paths as `/onboarding?plan=…&modules=…`:
 *   - password + confirm-email: appended to `emailRedirectTo`, so the intent
 *     survives the confirmation link being opened in a fresh browser context
 *     (where sessionStorage from the pricing tab does not exist);
 *   - OAuth: appended to the sanitized `next` param on /auth/callback (the
 *     PKCE round trip stays in the same tab, so the stash survives too —
 *     the URL copy is belt and suspenders).
 * The onboarding dispatcher re-stashes any URL intent before it replaces the
 * URL with the resume step, and the plan step consumes the stash (URL wins
 * over stash; the stash is cleared on consume so a later, different signup in
 * the same tab never inherits a stale configuration).
 *
 * VALIDATION IS A WHITELIST, applied to URL input and to the stash alike
 * (sessionStorage is attacker-adjacent: any same-origin script could write
 * it): `plan` must be a known PlanId, `modules` keeps only the SELLABLE
 * add-ons — `regions_ca` is inert in the single-region model and is never
 * accepted, exactly like the checkout API's gate.
 */

import { PLAN_MODULE_IDS, type PlanId, type PlanModule } from "@/lib/api/types";

/** A validated plan-builder selection. `modules` is deduped and sellable-only. */
export interface PlanIntent {
  plan: PlanId;
  modules: PlanModule[];
}

/** sessionStorage key for the stashed intent. */
export const PLAN_INTENT_STORAGE_KEY = "loonext.plan_intent";

/** Every plan the builder can emit (mirrors the PlanId union). */
const PLAN_IDS: readonly PlanId[] = ["starter", "pro"];

/**
 * The add-ons a signup may carry into checkout: the sellable set. regions_ca
 * is excluded on purpose (inert single-region module — the onboarding builder
 * and the checkout API both refuse it).
 */
const SELLABLE_MODULES: readonly PlanModule[] = PLAN_MODULE_IDS.filter(
  (id) => id !== "regions_ca",
);

function isPlanId(value: unknown): value is PlanId {
  return typeof value === "string" && (PLAN_IDS as readonly string[]).includes(value);
}

function isSellableModule(value: unknown): value is PlanModule {
  return (
    typeof value === "string" &&
    (SELLABLE_MODULES as readonly string[]).includes(value)
  );
}

/** Whitelist + dedupe an untrusted module list (order preserved). */
function sanitizeModules(values: readonly unknown[]): PlanModule[] {
  const out: PlanModule[] = [];
  for (const value of values) {
    if (isSellableModule(value) && !out.includes(value)) out.push(value);
  }
  return out;
}

/**
 * Parse `?plan=…&modules=…` from a query string (with or without the leading
 * `?`) or URLSearchParams. Returns null unless `plan` is a valid PlanId —
 * modules without a plan are not an intent (the builder always sets both).
 * Unknown or unsellable modules are dropped silently, never rejected wholesale
 * (`?plan=pro&modules=regions_ca,voice` → pro + [voice]).
 */
export function parsePlanIntent(
  search: string | URLSearchParams | null | undefined,
): PlanIntent | null {
  if (search === null || search === undefined) return null;
  const params =
    typeof search === "string" ? new URLSearchParams(search) : search;
  const plan = params.get("plan");
  if (!isPlanId(plan)) return null;
  const modules = sanitizeModules((params.get("modules") ?? "").split(","));
  return { plan, modules };
}

/**
 * Serialize an intent back to the canonical `plan=…&modules=…` query (no
 * leading `?`; `modules` omitted when empty) for appending to a redirect URL.
 * Output is `URLSearchParams`-encoded, so it round-trips through
 * `parsePlanIntent` and passes `safeNextPath` (no spaces, no backslashes).
 */
export function planIntentSearch(intent: PlanIntent): string {
  const params = new URLSearchParams({ plan: intent.plan });
  if (intent.modules.length > 0) params.set("modules", intent.modules.join(","));
  return params.toString();
}

/** SSR-safe, quota/privacy-mode-safe sessionStorage access. */
function storage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.sessionStorage;
  } catch {
    // Some privacy modes throw on the accessor itself.
    return null;
  }
}

/** Persist a validated intent for the rest of this tab's auth journey. */
export function stashPlanIntent(intent: PlanIntent): void {
  try {
    storage()?.setItem(PLAN_INTENT_STORAGE_KEY, JSON.stringify(intent));
  } catch {
    // Storage full / blocked — the URL-threaded copy still carries the intent.
  }
}

/**
 * Read the stashed intent, re-validating through the same whitelist as URL
 * input (the stash is just as untrusted). Malformed JSON reads as null.
 */
export function readPlanIntentStash(): PlanIntent | null {
  try {
    const raw = storage()?.getItem(PLAN_INTENT_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const candidate = parsed as { plan?: unknown; modules?: unknown };
    if (!isPlanId(candidate.plan)) return null;
    const modules = Array.isArray(candidate.modules)
      ? sanitizeModules(candidate.modules)
      : [];
    return { plan: candidate.plan, modules };
  } catch {
    return null;
  }
}

/** Drop the stash (after consume, or when a journey is abandoned). */
export function clearPlanIntentStash(): void {
  try {
    storage()?.removeItem(PLAN_INTENT_STORAGE_KEY);
  } catch {
    // Nothing to clear when storage is unavailable.
  }
}

/**
 * Landing-page hook (signup, the onboarding dispatcher): if the current URL
 * carries a valid intent, stash it and return it; otherwise return whatever
 * is already stashed (an earlier landing in this tab). Never clears — the
 * plan step owns consumption.
 */
export function stashPlanIntentFromSearch(
  search: string | URLSearchParams | null | undefined,
): PlanIntent | null {
  const fromUrl = parsePlanIntent(search);
  if (fromUrl) {
    stashPlanIntent(fromUrl);
    return fromUrl;
  }
  return readPlanIntentStash();
}

/**
 * The plan step's hydration source: URL param wins over the stash, and the
 * stash is cleared either way (consumed exactly once — a checkout built from
 * this intent must never resurrect on a later visit).
 */
export function consumePlanIntent(
  search: string | URLSearchParams | null | undefined,
): PlanIntent | null {
  const fromUrl = parsePlanIntent(search);
  const stashed = readPlanIntentStash();
  clearPlanIntentStash();
  return fromUrl ?? stashed;
}
