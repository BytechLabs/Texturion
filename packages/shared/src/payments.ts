/**
 * #224 / D133 — text-to-pay, the parts all four surfaces have to agree on.
 *
 * Web, Android, iOS and the API each render the same payment request, and the
 * API composes the text the customer receives. Three of those are hand-ported
 * from this file, which is the whole reason it is small and total: a rule
 * written three times drifts (#548), so what is written here is the rule and
 * the ports are checked against these vectors.
 *
 * ## The one modelling decision worth reading
 *
 * `status` in the database has four values and the thread shows six states.
 * That is deliberate, not an omission. A REFUND and a DISPUTE happen to a
 * request that is, and stays, PAID — money changed hands and then moved back —
 * so folding them into `status` would destroy the fact the crew most needs.
 * They are timestamps beside the status, and the six-state answer is DERIVED,
 * once, here.
 */

/** The stored status. Mirrors the SQL CHECK exactly. */
export type PaymentRequestStatus = "requested" | "paid" | "cancelled" | "expired";

/** What the thread actually shows. Derived — never stored. */
export type PaymentRequestState =
  | "requested"
  | "paid"
  | "refunded"
  | "disputed"
  | "cancelled"
  | "expired";

/** The fields the derivation needs. Every client's row is a superset. */
export interface PaymentRequestFacts {
  status: PaymentRequestStatus;
  paid_at?: string | null;
  refunded_at?: string | null;
  disputed_at?: string | null;
}

/**
 * The six-state answer, in the order that matters.
 *
 * ORDER IS THE DESIGN. A disputed payment that was also refunded reads as
 * DISPUTED, because a chargeback is the thing somebody has to act on and a
 * refund is not. A cancelled request that was somehow paid anyway reads as
 * PAID, because the money is real and telling a crew otherwise is how a
 * customer gets chased for a bill they settled.
 */
export function paymentRequestState(row: PaymentRequestFacts): PaymentRequestState {
  if (row.disputed_at) return "disputed";
  if (row.refunded_at) return "refunded";
  if (row.paid_at || row.status === "paid") return "paid";
  if (row.status === "cancelled") return "cancelled";
  if (row.status === "expired") return "expired";
  return "requested";
}

/** One word for the state, as the crew reads it in the thread. */
export function paymentRequestLabel(state: PaymentRequestState): string {
  switch (state) {
    case "requested":
      return "Waiting";
    case "paid":
      return "Paid";
    case "refunded":
      return "Refunded";
    case "disputed":
      return "Disputed";
    case "cancelled":
      return "Cancelled";
    case "expired":
      return "Expired";
  }
}

/**
 * Whether this request can still be cancelled.
 *
 * Paid is excluded for the obvious reason and expired for a less obvious one:
 * an expired request is already dead, and offering a Cancel on it invites a tap
 * that does nothing, which reads as a broken button rather than a settled state.
 */
export function paymentRequestCancellable(row: PaymentRequestFacts): boolean {
  return paymentRequestState(row) === "requested";
}

/**
 * The floor, in cents.
 *
 * Not arbitrary: Stripe refuses a charge under 50 cents in both USD and CAD,
 * and a request that mints a link the customer cannot pay is worse than a
 * refusal at the keyboard. Stated once here so the API, the three composers and
 * the tests cannot disagree about it.
 */
export const PAYMENT_MIN_CENTS = 100;

/**
 * The ceiling, in cents — $25,000.
 *
 * A cap exists because a typo in a phone keypad is a real event and "$450"
 * becoming "$45000" is one missed decimal. It sits well above any residential
 * trade job and below the point where a mistyped figure is plausible, which is
 * the only job a cap of this kind can do. A business with a genuinely larger
 * invoice has a bank transfer and an accountant; they do not need it collected
 * by text.
 */
export const PAYMENT_MAX_CENTS = 2_500_000;

/** The description ceiling — it rides in an SMS and on a card statement. */
export const PAYMENT_DESCRIPTION_MAX = 200;

export type PaymentAmountProblem = "too_small" | "too_large" | "not_whole";

/**
 * Is this a chargeable amount? Returns the problem, or null when it is fine.
 *
 * Shared rather than per-client because the phone keypads and the web input
 * each need the same answer BEFORE the request is sent — a validation that only
 * exists on the server is a validation the customer's crew meets as a red toast
 * after typing everything twice.
 */
export function paymentAmountProblem(cents: number): PaymentAmountProblem | null {
  if (!Number.isInteger(cents)) return "not_whole";
  if (cents < PAYMENT_MIN_CENTS) return "too_small";
  if (cents > PAYMENT_MAX_CENTS) return "too_large";
  return null;
}

/**
 * Why a workspace cannot send a payment request yet.
 *
 * The issue's first acceptance criterion is that a workspace which has not
 * finished onboarding is told EXACTLY what is outstanding — so "not ready" is
 * not one state, it is five, and each one has a different next action.
 */
export type PayoutReadiness =
  | "not_connected"
  | "onboarding_incomplete"
  | "pending_verification"
  | "restricted"
  | "ready";

export interface PayoutAccountFacts {
  connected: boolean;
  charges_enabled: boolean;
  details_submitted: boolean;
  disabled_reason?: string | null;
  requirements_due?: readonly string[] | null;
}

/**
 * The readiness answer, derived from Stripe's mirror.
 *
 * `charges_enabled` is the only field that decides whether a send may happen.
 * The others exist to say WHY it is false, and the order below is the order a
 * business moves through them.
 */
export function payoutReadiness(account: PayoutAccountFacts | null): PayoutReadiness {
  if (!account || !account.connected) return "not_connected";
  if (account.charges_enabled) return "ready";
  if (account.disabled_reason) return "restricted";
  if (!account.details_submitted) return "onboarding_incomplete";
  return "pending_verification";
}

/**
 * The catalogue keys for the same five states.
 *
 * #228: these cannot replace [payoutReadinessCopy] — they sit beside it, and
 * the reason is the wire. The API composes those sentences server-side and
 * sends them; a phone built last month renders `title` verbatim and has never
 * heard of `title_key`. #339 says those builds are around for months, so the
 * English below stays on the wire until they are gone. This is the expand half
 * of an expand-and-contract, and the sentences are what contracts.
 *
 * THE SERVER CANNOT RESOLVE THE LANGUAGE ITSELF, which is what forces a key
 * rather than a translated sentence. `profiles.locale` is nullable and its
 * null means "ask the device, then the workspace" — the device half only exists
 * on the client, and no client sends it. A server that translated here would be
 * answering in the company's language to somebody whose phone is set to the
 * other one, silently overriding the resolution order that migration
 * establishes.
 */
export function payoutReadinessKeys(readiness: PayoutReadiness): {
  titleKey: PayoutReadinessKey;
  detailKey: PayoutReadinessKey;
  /** Null where the state has nothing for the owner to do — see below. */
  actionKey: PayoutReadinessKey | null;
} {
  switch (readiness) {
    case "not_connected":
      return {
        titleKey: "payments.payoutNotConnectedTitle",
        detailKey: "payments.payoutNotConnectedDetail",
        actionKey: "payments.payoutActionSetUp",
      };
    case "onboarding_incomplete":
      return {
        titleKey: "payments.payoutIncompleteTitle",
        detailKey: "payments.payoutIncompleteDetail",
        actionKey: "payments.payoutActionFinish",
      };
    case "pending_verification":
      // Null on purpose, and it is the honest answer: there is nothing to press
      // while Stripe checks. A button here would be one that does nothing.
      return {
        titleKey: "payments.payoutPendingTitle",
        detailKey: "payments.payoutPendingDetail",
        actionKey: null,
      };
    case "restricted":
      return {
        titleKey: "payments.payoutRestrictedTitle",
        detailKey: "payments.payoutRestrictedDetail",
        actionKey: "payments.payoutActionOpenStripe",
      };
    case "ready":
      return {
        titleKey: "payments.payoutReadyTitle",
        detailKey: "payments.payoutReadyDetail",
        actionKey: "payments.payoutActionOpenStripe",
      };
  }
}

/** Every catalogue key the five readiness states can name. */
export type PayoutReadinessKey =
  | "payments.payoutNotConnectedTitle"
  | "payments.payoutNotConnectedDetail"
  | "payments.payoutIncompleteTitle"
  | "payments.payoutIncompleteDetail"
  | "payments.payoutPendingTitle"
  | "payments.payoutPendingDetail"
  | "payments.payoutRestrictedTitle"
  | "payments.payoutRestrictedDetail"
  | "payments.payoutReadyTitle"
  | "payments.payoutReadyDetail"
  | "payments.payoutActionSetUp"
  | "payments.payoutActionFinish"
  | "payments.payoutActionOpenStripe";

/**
 * What the owner is told, and what to do about it — in English.
 *
 * STILL ENGLISH ON PURPOSE. This is what the API puts on the wire for clients
 * that predate [payoutReadinessKeys]; new ones read the key. When those builds
 * are gone this function goes with them.
 */
export function payoutReadinessCopy(readiness: PayoutReadiness): {
  title: string;
  detail: string;
  action: string | null;
} {
  switch (readiness) {
    case "not_connected":
      return {
        title: "Not set up yet",
        detail:
          "Connect a Stripe account and you can ask a customer for a deposit " +
          "or a final payment straight from the thread. Money goes to your " +
          "bank account — we never hold it, and we take nothing on top.",
        action: "Set up payments",
      };
    case "onboarding_incomplete":
      return {
        title: "Nearly there",
        detail:
          "Stripe still needs a few details about your business before it can " +
          "take a payment. Picking up where you left off takes a couple of minutes.",
        action: "Finish setting up",
      };
    case "pending_verification":
      return {
        title: "Stripe is checking your details",
        detail:
          "You have given Stripe everything it asked for. Verification is " +
          "usually minutes, occasionally a day or two. We will switch payment " +
          "requests on the moment it clears — nothing for you to do.",
        action: null,
      };
    case "restricted":
      return {
        title: "Payments are paused",
        detail:
          "Stripe has paused payments on your account and needs something from " +
          "you before it can take another one. Your Stripe dashboard says what.",
        action: "Open Stripe",
      };
    case "ready":
      return {
        title: "Ready to take payments",
        detail:
          "Ask for a deposit or a final payment from any thread. It arrives as " +
          "an ordinary text with a link, and the money goes to your bank account.",
        action: "Open Stripe",
      };
  }
}

/**
 * A Stripe requirement identifier, in plain words.
 *
 * Stripe returns things like `individual.verification.document` and
 * `external_account`. Showing those to a plumber is showing them a stack trace.
 * Unknown identifiers fall back to a readable version of the identifier itself
 * rather than being dropped — an outstanding requirement nobody can see is the
 * state where an owner concludes the product is broken.
 *
 * #228: the twelve we recognise are KEYS; the fallback stays a sentence and is
 * never translated, because it is Stripe's own identifier tidied up rather than
 * anything we wrote. Exactly one of the two fields is set, and the caller reads
 * whichever it is — the same shape `ApiException.messageKey` uses for the
 * server's own sentences.
 */
const PAYOUT_REQUIREMENT_KEYS = {
  external_account: "payments.reqBankAccount",
  "business_profile.url": "payments.reqWebsite",
  "business_profile.mcc": "payments.reqWorkKind",
  "individual.verification.document": "payments.reqOwnerId",
  "individual.verification.additional_document": "payments.reqOwnerIdSecond",
  "individual.id_number": "payments.reqOwnerSin",
  "individual.address.line1": "payments.reqOwnerAddress",
  "individual.dob.day": "payments.reqOwnerDob",
  "company.tax_id": "payments.reqBusinessNumber",
  "company.verification.document": "payments.reqBusinessDocument",
  "tos_acceptance.date": "payments.reqTos",
  "representative.verification.document": "payments.reqSignatoryId",
} as const;

/** Every catalogue key this module can name for a Stripe requirement. */
export type PayoutRequirementKey =
  (typeof PAYOUT_REQUIREMENT_KEYS)[keyof typeof PAYOUT_REQUIREMENT_KEYS];

/** A requirement said in our words (`key`) or in Stripe's (`literal`). */
export interface PayoutRequirementCopy {
  /** Catalogue key, or null when Stripe named something we have no words for. */
  key: PayoutRequirementKey | null;
  /**
   * Stripe's identifier tidied into something readable, or null when `key`
   * answered. Deliberately NOT translated: inventing French for a requirement
   * we do not recognise would be inventing the requirement.
   */
  literal: string | null;
}

export function payoutRequirementCopy(requirement: string): PayoutRequirementCopy {
  const known = PAYOUT_REQUIREMENT_KEYS[requirement as keyof typeof PAYOUT_REQUIREMENT_KEYS];
  if (known) return { key: known, literal: null };
  const cleaned = requirement.replace(/^(individual|company|representative)\./, "");
  const words = cleaned.replace(/[._]/g, " ").trim();
  return { key: null, literal: words.charAt(0).toUpperCase() + words.slice(1) };
}
