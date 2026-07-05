import type {
  PhoneNumberSummary,
  PortMessagingStatus,
  PortRequest,
  PortStatus,
} from "@/lib/api/types";

/**
 * Port state machine → plain 4-step tracker (PORTING.md §8.2). Pure so the
 * whole state table is unit-testable; the Settings port card renders from it.
 *
 * No jargon reaches the tracker (§8.2 / APP-UI-ELEVATION §5): we say "sent the
 * transfer request" / "the switch", never FOC/LOA in a heading. The four steps
 * fold the raw Telnyx enum (`draft…ported` + the messaging sub-track) into the
 * owner-facing meaning; the exception states surface separately as an alert.
 */

/** The four human tracker steps + the terminal "needs a fix" alert. */
export type PortStepKey =
  | "submitted"
  | "date_confirmed"
  | "number_switched"
  | "texting_live";

export type PortStepState = "done" | "active" | "todo";

export interface PortStep {
  key: PortStepKey;
  /** done = passed, active = current, todo = ahead. */
  state: PortStepState;
}

/**
 * Which of the two orthogonal tracks needs a fix, if any (PORTING.md §1 / §9):
 *   - "voice"    → the carrier rejected the transfer (data mismatch, illegible
 *                  LOA…) — customer-actionable via fix-and-resubmit.
 *   - "messaging"→ texting routing not yet released by the old carrier; Telnyx
 *                  is escalating — NOT customer-actionable, just slower.
 */
export type PortExceptionKind = "voice" | "messaging" | null;

export interface PortUiState {
  /** The 4 tracker steps with their resolved states. */
  steps: PortStep[];
  /** Which track (if any) is in an exception state. */
  exception: PortExceptionKind;
  /** True once texting is fully live (messaging ported). */
  live: boolean;
  /** True once the whole port is abandoned (cancelled / cancel-pending). */
  cancelled: boolean;
  /** Whether the owner can still edit the port data (draft/exception). */
  editable: boolean;
  /** Whether the LOA + invoice still need uploading before submit can run. */
  documentsPending: boolean;
  /** Whether the documents-gated "Submit port" action applies right now. */
  canSubmit: boolean;
  /** Whether the fix-and-resubmit action applies (voice exception, docs ok). */
  canResubmit: boolean;
  /**
   * Post-port 10DLC assignment FAILED (§8.2/§9): render the quiet amber "ask
   * your previous texting provider to remove this number from their carrier
   * campaign" guidance. Orthogonal to the tracker — it can coexist with any
   * post-cutover step (and even with `live`, since the messaging port and the
   * campaign linkage are separate tracks).
   */
  assignmentBlocked: boolean;
  /**
   * The live temporary (bridge) number to show while the transfer is still in
   * flight (PORTING.md D16 opt-in "text today" number), or null. Goes quiet
   * once texting is live on the real number (releasing the bridge takes over
   * as the story) or the port is abandoned.
   */
  bridge: string | null;
}

/**
 * A `phone_numbers` row belongs to a number transfer (port-in), NOT the plain
 * provisioned-number surface — so Settings → Numbers renders it ONCE, through
 * the port stepper (`PortSection`/`PortCard`), never as a `NumberCard` with the
 * "under a minute" provisioning copy (which would be a flat contradiction of
 * the honest multi-day transfer window, PORTING.md §2.3/§8.2).
 *
 * The API `/v1/numbers` serializer omits `source`, so we discriminate from data
 * the client already has. A ported row is unmistakable on two independent
 * signals, either of which is sufficient:
 *   1. It carries NO `requested_area_code`. A port buys no new inventory, so
 *      `claim_port_slot` inserts the row with a null area code; every
 *      provisioned number (including an opt-in bridge) always has one from the
 *      area-code picker (`provision_number_slot`). This holds for the WHOLE port
 *      lifecycle — while `provisioning` (no `number_e164` yet) and after P6
 *      flips it `active` — so it is the primary, lifecycle-stable check.
 *   2. Its `number_e164` matches a live port's `phone_e164` (belt-and-suspenders
 *      for the post-cutover `active` row).
 */
export function isPortedNumber(
  number: PhoneNumberSummary,
  portedE164: ReadonlySet<string>,
): boolean {
  if (number.requested_area_code === null) return true;
  return number.number_e164 !== null && portedE164.has(number.number_e164);
}

/**
 * Split the company's `/v1/numbers` rows into the plain provisioned numbers
 * (rendered as `NumberCard`) and the transfer rows (owned by `PortSection`).
 * De-duplicates the page: a ported number is shown once, in the stepper.
 */
export function partitionNumbers(
  numbers: readonly PhoneNumberSummary[],
  ports: readonly PortRequest[],
): { provisioned: PhoneNumberSummary[]; ported: PhoneNumberSummary[] } {
  const portedE164 = new Set(
    ports
      .filter((p) => p.status !== "cancelled")
      .map((p) => p.phone_e164),
  );
  const provisioned: PhoneNumberSummary[] = [];
  const ported: PhoneNumberSummary[] = [];
  for (const number of numbers) {
    if (isPortedNumber(number, portedE164)) ported.push(number);
    else provisioned.push(number);
  }
  return { provisioned, ported };
}

/** Step 1 "Submitted" is done the moment the order left `draft`. */
function submittedState(status: PortStatus): PortStepState {
  if (status === "draft") return "active";
  return "done";
}

/** Step 2 "Date confirmed" — the carrier confirmed the switch-over date. */
function dateConfirmedState(status: PortStatus): PortStepState {
  if (
    status === "foc-date-confirmed" ||
    status === "activation-in-progress" ||
    status === "ported"
  ) {
    return "done";
  }
  return "todo";
}

/** Step 3 "Number switched" — voice cut over to Loonext. */
function numberSwitchedState(status: PortStatus): PortStepState {
  return status === "ported" ? "done" : "todo";
}

/** Step 4 "Texting live" — messaging ported (the readiness gate, §1). */
function textingLiveState(
  status: PortStatus,
  messaging: PortMessagingStatus,
): PortStepState {
  if (messaging === "ported") return "done";
  // Voice ported but messaging still activating → this is the current step.
  if (status === "ported") return "active";
  return "todo";
}

/**
 * Fold a port row into the tracker state (PORTING.md §8.2). Voidance:
 * cancelled ports carry no live steps (the caller renders a released card).
 */
export function derivePortUiState(port: PortRequest): PortUiState {
  const { status, messaging_port_status: messaging } = port;
  const cancelled = status === "cancelled" || status === "cancel-pending";
  const voiceException = status === "exception";
  const messagingException = messaging === "exception";
  const live = messaging === "ported";
  const hasDocuments = port.has_loa && port.has_invoice;

  const submitted = submittedState(status);
  const dateConfirmed = dateConfirmedState(status);
  const numberSwitched = numberSwitchedState(status);
  const textingLive = textingLiveState(status, messaging);

  // The "active" step is the first not-done one (the one obvious thing to watch)
  // — unless a track is in exception, where the alert takes over the narrative.
  const steps: PortStep[] = [
    { key: "submitted", state: submitted },
    { key: "date_confirmed", state: dateConfirmed },
    { key: "number_switched", state: numberSwitched },
    { key: "texting_live", state: textingLive },
  ];
  if (!voiceException && !live && !cancelled) {
    const firstTodo = steps.find((s) => s.state === "todo");
    if (firstTodo && steps.every((s) => s.state !== "active")) {
      firstTodo.state = "active";
    }
  }

  return {
    steps,
    exception: voiceException ? "voice" : messagingException ? "messaging" : null,
    live,
    cancelled,
    editable: status === "draft" || status === "exception",
    documentsPending: !hasDocuments,
    canSubmit: status === "draft" && hasDocuments,
    canResubmit: status === "exception" && hasDocuments,
    assignmentBlocked: port.assignment_blocked === true && !cancelled,
    // `?? null` tolerates pre-bridge cached shapes that lack the field.
    bridge: !live && !cancelled ? (port.bridge_number_e164 ?? null) : null,
  };
}
