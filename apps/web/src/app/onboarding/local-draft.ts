import type { OnboardingDraft, PortDraft } from "./steps";

/**
 * Pre-company wizard draft (steps "name" and "number"). POST /v1/companies
 * needs name + country + area code + AUP in a single call, so these two
 * screens persist locally until the company exists; every later step writes
 * server-side immediately (G7 resumability).
 */
const DRAFT_KEY = "loonext:onboarding-draft";

/**
 * #381 — how long an abandoned draft may keep identity data.
 *
 * The port sub-wizard collects `ssnSinLast4` (the last 4 of the account
 * holder's SSN/SIN, which the losing carrier requires for a wireless port),
 * plus an account number and a PIN. Those sat in localStorage forever: a
 * signup abandoned in March left a partial government identifier on a shared
 * office machine in December.
 *
 * Seven days is long enough for a real resume — somebody who starts on a phone
 * in a van and finishes at a desk that evening, or over a weekend — and short
 * enough that it is not a filing cabinet. PIPEDA and Law 25 both turn on
 * collecting and RETAINING no more than necessary, and "necessary" for a draft
 * is "long enough to come back to".
 */
const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Pure parser so malformed storage never breaks the wizard. */
export function parseDraft(raw: string | null): OnboardingDraft {
  if (!raw) return {};
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return {};
    const obj = value as Record<string, unknown>;
    const draft: OnboardingDraft = {};
    if (typeof obj.name === "string") draft.name = obj.name;
    if (obj.country === "US" || obj.country === "CA") {
      draft.country = obj.country;
    }
    if (typeof obj.areaCode === "string" && /^\d{3}$/.test(obj.areaCode)) {
      draft.areaCode = obj.areaCode;
    }
    if (
      typeof obj.chosenNumber === "string" &&
      /^\+1\d{10}$/.test(obj.chosenNumber)
    ) {
      draft.chosenNumber = obj.chosenNumber;
    }
    if (typeof obj.usTexting === "boolean") draft.usTexting = obj.usTexting;
    if (obj.mode === "new" || obj.mode === "port") draft.mode = obj.mode;
    if (typeof obj.port === "object" && obj.port !== null) {
      draft.port = parsePortDraft(obj.port as Record<string, unknown>);
    }
    return draft;
  } catch {
    return {};
  }
}

const PORT_STRING_KEYS = [
  "phoneE164",
  "entityName",
  "authPersonName",
  "accountNumber",
  "pinPasscode",
  "billingPhoneNumber",
  "ssnSinLast4",
  "serviceStreet",
  "serviceExtended",
  "serviceLocality",
  "serviceAdminArea",
  "servicePostalCode",
  "focDatetimeRequested",
] as const satisfies readonly (keyof PortDraft)[];

/** Tolerant parser for the port sub-wizard intake (never throws). */
function parsePortDraft(obj: Record<string, unknown>): PortDraft {
  const port: PortDraft = {};
  for (const key of PORT_STRING_KEYS) {
    const value = obj[key];
    if (typeof value === "string" && value.length > 0) {
      port[key] = value;
    }
  }
  if (typeof obj.isWireless === "boolean") port.isWireless = obj.isWireless;
  if (typeof obj.wantsBridgeNumber === "boolean") {
    port.wantsBridgeNumber = obj.wantsBridgeNumber;
  }
  return port;
}

export function readOnboardingDraft(now: number = Date.now()): OnboardingDraft {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    // #381: expire before parsing, and DELETE rather than just ignoring. An
    // expired draft that is merely not read is still a SIN fragment sitting in
    // storage; the point is that it stops existing.
    if (raw !== null && draftIsExpired(raw, now)) {
      window.localStorage.removeItem(DRAFT_KEY);
      return {};
    }
    return parseDraft(raw);
  } catch {
    return {}; // storage blocked (private mode) — wizard still works per-visit
  }
}

/**
 * Is this stored draft past its TTL?
 *
 * A draft with NO timestamp is treated as expired. Those are drafts written
 * before this shipped, and they are exactly the ones that have been sitting
 * around longest — reading them as fresh would exempt the oldest data from the
 * rule written for it. The cost is that somebody mid-signup at deploy time
 * re-enters a name and an area code.
 */
export function draftIsExpired(raw: string, now: number = Date.now()): boolean {
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return false;
    const savedAt = (value as Record<string, unknown>).savedAt;
    if (typeof savedAt !== "number") return true;
    return now - savedAt > DRAFT_TTL_MS;
  } catch {
    // Unparseable: parseDraft returns {} anyway, so there is nothing to expire.
    return false;
  }
}

export function writeOnboardingDraft(patch: Partial<OnboardingDraft>): void {
  if (typeof window === "undefined") return;
  try {
    // Stamped on every write, so the clock runs from last ACTIVITY rather
    // than from first touch — somebody actively working through the wizard is
    // never expired out from under themselves.
    const next = { ...readOnboardingDraft(), ...patch, savedAt: Date.now() };
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify(next));
  } catch {
    // Best-effort persistence only.
  }
}

/**
 * Merge into the nested `port` sub-draft without clobbering fields collected on
 * earlier port sub-steps (a shallow `writeOnboardingDraft({ port })` would). The
 * port sub-wizard (PORTING.md §8.1) uses this on every step so resume works.
 */
export function writeOnboardingPortDraft(patch: Partial<PortDraft>): void {
  if (typeof window === "undefined") return;
  try {
    const current = readOnboardingDraft();
    const next = {
      ...current,
      mode: "port" as const,
      port: { ...current.port, ...patch },
      savedAt: Date.now(),
    };
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify(next));
  } catch {
    // Best-effort persistence only.
  }
}

/** Called once the company row exists — the server owns the state from here. */
export function clearOnboardingDraft(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(DRAFT_KEY);
  } catch {
    // Nothing to clean up.
  }
}
