import type { OnboardingDraft, PortDraft } from "./steps";

/**
 * Pre-company wizard draft (steps "name" and "number"). POST /v1/companies
 * needs name + country + area code + AUP in a single call, so these two
 * screens persist locally until the company exists; every later step writes
 * server-side immediately (G7 resumability).
 */
const DRAFT_KEY = "loonext:onboarding-draft";

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

export function readOnboardingDraft(): OnboardingDraft {
  if (typeof window === "undefined") return {};
  try {
    return parseDraft(window.localStorage.getItem(DRAFT_KEY));
  } catch {
    return {}; // storage blocked (private mode) — wizard still works per-visit
  }
}

export function writeOnboardingDraft(patch: Partial<OnboardingDraft>): void {
  if (typeof window === "undefined") return;
  try {
    const next = { ...readOnboardingDraft(), ...patch };
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
    const next: OnboardingDraft = {
      ...current,
      mode: "port",
      port: { ...current.port, ...patch },
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
