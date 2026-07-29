import type {
  CompanyView,
  RegistrationRow,
  RegistrationState,
  SubscriptionStatus,
} from "@/lib/api/types";

/**
 * Onboarding wizard step machine (DESIGN.md G7, SPEC §4.1) as pure functions
 * so routing/resume logic is unit-testable without React.
 *
 * The wizard is resumable: steps `name` and `number` live only in the local
 * draft (the company does not exist yet — POST /v1/companies needs name +
 * country + area code + AUP in one call), everything after company creation
 * is server state (GET /v1/me hydration + GET /v1/registration).
 */

export type WizardStep = "name" | "number" | "business" | "texting" | "plan";

export type OnboardingLocation =
  | { kind: "step"; step: WizardStep }
  | { kind: "setting-up" }
  | { kind: "inbox" };

/**
 * How the company gets its business number (PORTING.md §8.1 / D16 fork). New
 * = the existing area-code flow; port = bring an existing number. `undefined`
 * = not yet chosen (treated as the new-number default everywhere the machine
 * decides). The port sub-wizard lives outside the WizardStep machine, so this
 * field only records the choice and the collected port intake for resume.
 */
export type NumberMode = "new" | "port";

/**
 * Port intake collected pre-company by the port sub-wizard (PORTING.md §8.1
 * steps 1–6). Kept in the local draft so the sub-wizard is resumable; on its
 * final step the company + the `POST /v1/port-requests` draft are created and
 * these fields are cleared alongside the rest of the draft.
 */
export interface PortDraft {
  phoneE164?: string;
  isWireless?: boolean;
  entityName?: string;
  authPersonName?: string;
  accountNumber?: string;
  pinPasscode?: string;
  billingPhoneNumber?: string;
  /** Wireless only — the last 4 of the account holder's SSN/SIN. */
  ssnSinLast4?: string;
  serviceStreet?: string;
  serviceExtended?: string;
  serviceLocality?: string;
  serviceAdminArea?: string;
  servicePostalCode?: string;
  /** Optional requested cutover (ISO 8601 with offset). */
  focDatetimeRequested?: string;
  wantsBridgeNumber?: boolean;
}

/** Local (pre-company) wizard draft — persisted by local-draft.ts. */
export interface OnboardingDraft {
  name?: string;
  country?: "US" | "CA";
  areaCode?: string;
  /** Choose-your-number: the specific E.164 picked in the number step (new mode). */
  chosenNumber?: string;
  /** CA only — "Do you also text US customers?"; undefined = default yes. */
  usTexting?: boolean;
  /** New-number vs. bring-my-number fork (D16). Defaults to "new". */
  mode?: NumberMode;
  /** Port intake, present only while `mode === "port"`. */
  port?: PortDraft;
}

/** The slice of server + local state the step machine decides on. */
export interface OnboardingSnapshot {
  /** Active company view (GET /v1/company) or null before creation. */
  company: Pick<
    CompanyView,
    "country" | "us_texting_enabled" | "subscription_status"
  > & {
    numbers: { status: string }[];
    registration: CompanyView["registration"];
  } | null;
  /** GET /v1/registration rows (wizard data included for owner/admin). */
  registration: RegistrationState | null;
  draft: OnboardingDraft;
}

// ---------------------------------------------------------------------------
// Registration-owed + draft-completeness mirrors (apps/api/src/billing/
// registration-draft.ts — the checkout gate; keys per the SPEC §4.4 mapping).
// ---------------------------------------------------------------------------

/** SPEC §4.2 table: US, or CA with us_texting_enabled. */
export function owesUsRegistration(company: {
  country: string;
  us_texting_enabled: boolean;
}): boolean {
  return (
    company.country === "US" ||
    (company.country === "CA" && company.us_texting_enabled)
  );
}

/** Same rule evaluated on the pre-company local draft. */
export function draftOwesUsRegistration(draft: OnboardingDraft): boolean {
  if (draft.country === "US") return true;
  // CA defaults to US texting on (DB default) until explicitly declined.
  return draft.country === "CA" && draft.usTexting !== false;
}

const BRAND_COMMON_KEYS = [
  "displayName",
  "email",
  "phone",
  "vertical",
  "street",
  "city",
  "state",
  "postalCode",
  "country",
] as const;

function present(data: Record<string, unknown>, key: string): boolean {
  const value = data[key];
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * A row no longer needs the wizard once it has been submitted (submitted /
 * pending / approved); draft and rejected rows count as complete only when
 * the wizard data carries every field the Telnyx payload requires.
 */
function pastSubmission(row: { status: string }): boolean {
  return (
    row.status === "submitted" ||
    row.status === "pending" ||
    row.status === "approved"
  );
}

/**
 * Has this registration ever been sent to the carrier?
 *
 * #381/#458: the one signal that separates a paid signup which still owes its
 * identity details from a live workspace whose registration was deactivated.
 * Both look "complete"; only one has ever been submitted.
 */
function everSubmitted(snapshot: OnboardingSnapshot): boolean {
  // The COMPANY's embedded pair first: for a paid workspace that is hydrated
  // server truth and is always present, whereas the standalone `registration`
  // is only fetched on the pre-checkout path. `setupComplete` reads it the
  // same way for the same reason.
  const pair = snapshot.company?.registration ?? snapshot.registration ?? null;
  const brand = pair?.brand ?? null;
  const campaign = pair?.campaign ?? null;
  return (
    (brand !== null && pastSubmission(brand)) ||
    (campaign !== null && pastSubmission(campaign))
  );
}

export function brandRowComplete(row: RegistrationRow | null): boolean {
  if (!row) return false;
  if (pastSubmission(row)) return true;
  const data = row.data;
  if (!data) return false;
  if (!BRAND_COMMON_KEYS.every((key) => present(data, key))) return false;
  if (row.sole_proprietor) {
    return ["firstName", "lastName", "ein", "mobilePhone"].every((key) =>
      present(data, key),
    );
  }
  return ["companyName", "ein"].every((key) => present(data, key));
}

export function campaignRowComplete(row: RegistrationRow | null): boolean {
  if (!row) return false;
  if (pastSubmission(row)) return true;
  const data = row.data;
  if (!data) return false;
  return ["messageFlow", "sample1", "sample2"].every((key) =>
    present(data, key),
  );
}

// ---------------------------------------------------------------------------
// Step machine
// ---------------------------------------------------------------------------

/** Subscription states that mean "checkout already happened and stuck". */
const PAID_STATUSES: readonly SubscriptionStatus[] = [
  "active",
  "past_due",
  "unpaid",
];

export function hasPaid(status: SubscriptionStatus): boolean {
  return PAID_STATUSES.includes(status);
}

/** The steps this signup actually walks (CA-no-US skips the registration pair). */
export function applicableSteps(snapshot: OnboardingSnapshot): WizardStep[] {
  const owes = snapshot.company
    ? owesUsRegistration(snapshot.company)
    : draftOwesUsRegistration(snapshot.draft);
  // #381/#458: `business` comes AFTER `plan`. The SSN/SIN last-4 it collects
  // is not read until submission, which happens post-payment — so gathering it
  // before the paywall held a partial government identifier for every signup
  // that abandoned, for no operational reason. PIPEDA and Law 25 both run on
  // collecting no more than necessary, and this was the clearest case of
  // unnecessary in the funnel.
  return owes
    ? ["name", "number", "texting", "plan", "business"]
    : ["name", "number", "plan"];
}

/** Post-payment setup is finished: number live + US gate open (or N/A). */
export function setupComplete(snapshot: OnboardingSnapshot): boolean {
  const { company } = snapshot;
  if (!company) return false;
  const numberActive = company.numbers.some((n) => n.status === "active");
  if (!numberActive) return false;
  if (!owesUsRegistration(company)) return true;
  const campaign = company.registration.campaign;
  return (
    campaign !== null &&
    campaign.status === "approved" &&
    campaign.deactivated_at === null
  );
}

/**
 * Where a resuming user belongs (G7: state persisted server-side, resumable).
 * Every §4.1 phase maps to exactly one surface.
 */
export function resolveOnboardingLocation(
  snapshot: OnboardingSnapshot,
): OnboardingLocation {
  const { company, registration, draft } = snapshot;

  if (!company) {
    if (!draft.name?.trim()) return { kind: "step", step: "name" };
    if (!draft.country || !draft.areaCode) {
      return { kind: "step", step: "number" };
    }
    // CA-no-US creates the company on the number step itself, so reaching
    // here without a company means the registration branch. #381/#458: that is
    // now `texting` (the opt-in description), not `business` — the identity
    // ask waits until after payment.
    if (draftOwesUsRegistration(draft)) {
      return { kind: "step", step: "texting" };
    }
    return { kind: "step", step: "number" };
  }

  // #381/#458: `business` is the one step that now lives AFTER payment, so a
  // paid company still owing its identity details has to be routed back to it.
  // Before the reorder no paid company ever returned to a wizard step, and
  // leaving that unchanged would have stranded them on `setting-up` waiting
  // for a submission that could never happen.
  //
  // Guarded on SUBMISSION, not on completeness, and the distinction is
  // load-bearing. Under the new order a paid signup has a complete campaign
  // draft and no brand — exactly the case that must reach `business`. A
  // post-grace resubscribe ALSO has a complete campaign, but its campaign has
  // been submitted, which proves a brand exists at the carrier whatever our
  // rows say. Testing completeness would pull that live workspace out of
  // `setting-up` and back into an identity form it filled months ago.
  if (
    hasPaid(company.subscription_status) &&
    owesUsRegistration(company) &&
    !brandRowComplete(registration?.brand ?? null) &&
    !everSubmitted(snapshot)
  ) {
    return { kind: "step", step: "business" };
  }

  if (hasPaid(company.subscription_status)) {
    // Covers port-in signups too: setting-up renders the honest transfer item
    // (upload LOA + bill → submit → carrier window, PORTING.md §8.1) until the
    // ported/bridge number goes active. This routing only governs /onboarding
    // pages — a user following the item's CTA into /settings/numbers is never
    // pulled back here.
    return setupComplete(snapshot) ? { kind: "inbox" } : { kind: "setting-up" };
  }

  // incomplete / incomplete_expired / canceled → still needs (re)checkout.
  if (owesUsRegistration(company)) {
    // #381/#458: only the campaign half sits before `plan` now. The brand
    // (identity) half is collected after payment.
    if (!campaignRowComplete(registration?.campaign ?? null)) {
      return { kind: "step", step: "texting" };
    }
  }
  return { kind: "step", step: "plan" };
}

/**
 * May this step render right now? False → the guard redirects to
 * resolveOnboardingLocation. Back-navigation to still-editable steps stays
 * allowed (G7: back always available).
 */
export function stepAllowed(
  step: WizardStep,
  snapshot: OnboardingSnapshot,
): boolean {
  const { company, draft } = snapshot;

  if (step === "name") {
    // The workspace name is fixed at creation here (it stays editable later in
    // Settings). Locking it keeps the pre-company draft the single source.
    return company === null;
  }

  if (step === "number") {
    // Country / area code / number stay editable until CHECKOUT, not just until
    // company creation (#79): the plan-step summary already PATCHes them
    // pre-checkout, so a customer who picked the wrong country can step Back and
    // switch. This mirrors the server PATCH gate (routes/companies.ts) EXACTLY:
    // only the never-checked-out states. A 'canceled' company already ordered
    // its number, so it locks like a paid one (the server would 409 an edit).
    return (
      company === null ||
      company.subscription_status === "incomplete" ||
      company.subscription_status === "incomplete_expired"
    );
  }

  if (company === null) {
    // business needs the local draft to be able to create the company on
    // submit; texting/plan need the company to exist.
    return (
      step === "business" &&
      Boolean(draft.name?.trim() && draft.country && draft.areaCode) &&
      draftOwesUsRegistration(draft)
    );
  }

  if (hasPaid(company.subscription_status)) return false; // → setting-up

  if (step === "business" || step === "texting") {
    return owesUsRegistration(company);
  }
  // plan: reachable once any owed registration drafts are submittable —
  // matches the POST /v1/billing/checkout 409 gate (SPEC §4.1 step 4).
  if (owesUsRegistration(company)) {
    return (
      brandRowComplete(snapshot.registration?.brand ?? null) &&
      campaignRowComplete(snapshot.registration?.campaign ?? null)
    );
  }
  return true;
}

/** Progress-dots position: 1-based index within the applicable steps. */
export function stepProgress(
  step: WizardStep,
  snapshot: OnboardingSnapshot,
): { index: number; total: number } {
  const steps = applicableSteps(snapshot);
  const at = steps.indexOf(step);
  return { index: at === -1 ? steps.length : at + 1, total: steps.length };
}

export function pathForLocation(location: OnboardingLocation): string {
  if (location.kind === "inbox") return "/inbox";
  if (location.kind === "setting-up") return "/onboarding/setting-up";
  return `/onboarding/${location.step}`;
}

/**
 * The destination for a step's Back link: the nearest PRECEDING applicable step
 * the guard would actually let the user render, or null when nothing editable
 * sits behind this one.
 *
 * Why not just hardcode the previous step: `name` and `number` LOCK the moment
 * the company is created (stepAllowed → false once `company !== null`, because
 * name/country/area code are fixed at creation). A back link pointing straight
 * at a locked step makes the guard bounce the user forward again — the reported
 * "Back does nothing on /onboarding/plan" (CA-no-US, whose only preceding steps
 * are the locked name/number). Resolving to a genuinely-allowed step, or hiding
 * the Back link when there is none, keeps G7's "back is always honest".
 */
export function previousStepHref(
  step: WizardStep,
  snapshot: OnboardingSnapshot,
): string | null {
  const steps = applicableSteps(snapshot);
  const at = steps.indexOf(step);
  if (at <= 0) return null;
  for (let i = at - 1; i >= 0; i -= 1) {
    if (stepAllowed(steps[i], snapshot)) return `/onboarding/${steps[i]}`;
  }
  return null;
}
