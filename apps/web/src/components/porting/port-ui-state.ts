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
 * `source` IS THE ANSWER, and the two signals below are only its fallback.
 * This function used to open by saying the `/v1/numbers` serializer omits
 * `source`; it does not, and has not since the voice wave — `sanitizeNumber`
 * returns it, the company-view embed returns it, `number_source` is NOT NULL in
 * the database, and `splitHostedNumbers` already partitions on it one step
 * earlier. Inferring provenance beside a field that states it is how the two
 * disagree.
 *
 * That mattered, because the inference is not merely redundant — it is wrong in
 * one direction. A row with no `requested_area_code` was called ported
 * UNCONDITIONALLY, and a ported row is dropped by the caller (the stepper
 * renders from the PORT list, not from this one). So any provisioned row that
 * reached the client without an area code rendered on no surface at all: no
 * card, no status, no release. `source` closes that off.
 *
 * The fallback stands for a cached pre-`source` shape (the field is optional on
 * the client type for exactly that reason). A ported row is unmistakable there
 * on two independent signals, either of which is sufficient:
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
  if (number.source) return number.source === "ported";
  if (number.requested_area_code === null) return true;
  return number.number_e164 !== null && portedE164.has(number.number_e164);
}

/**
 * Split the company's `/v1/numbers` rows into the plain provisioned numbers
 * (rendered as `NumberCard`) and the transfer rows (owned by `PortSection`).
 * De-duplicates the page: a ported number is shown once, in the stepper.
 *
 * # A HELD ported row still does not get a `NumberCard` (#523)
 *
 * The obvious fix for "web cannot release a held ported number" is to let a
 * suspended ported row through to the card list, which is where the release
 * control already lives. It is the wrong one, and the phones are the evidence:
 * they admitted `SUSPENDED` rows to their number-card filter and now draw a card
 * saying the line is on hold BESIDE a tracker whose completed port still shows a
 * green "Ported" pill over a filled stepper. One screen, two stories, and the
 * one a customer believes is whichever they read first.
 *
 * The partition is not a rendering preference, it is the invariant that makes
 * that impossible here: a ported line has exactly ONE card, so it cannot
 * contradict itself. What follows from the invariant is that whichever card a
 * line has must carry every control that applies to it — so the release control
 * went to `PortCard` (see its `number` prop) rather than the row coming here.
 *
 * Two further reasons it belongs there rather than here. The condition would not
 * be "ported and suspended" but "ported and suspended and the subscription is
 * live" — the release rule (`release-number.ts`), imported into a function whose
 * entire job is provenance, where `source` is the answer and lifecycle is not
 * asked about at all. And it would fork this function's meaning: `numberForPort`
 * and `holdForPort` both still resolve the same row for the stepper, so the row
 * would be in both buckets in effect, which is the de-duplication undone by
 * arithmetic instead of by intent.
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

/**
 * The `phone_numbers` row a transfer produced, once the number has actually
 * arrived — or null while it has not.
 *
 * # Why the port card needs this at all (#523)
 *
 * A ported number is rendered ONCE, by the stepper, and the stepper reads the
 * PORT row. The port row knows the transfer finished; it has no idea whether the
 * line it delivered still works. So a workspace that came back on a smaller plan
 * and had its ported line put on hold read "Live on Loonext", four green ticks
 * and "Text your customers straight from here" — on a number that cannot send.
 * The oldest-first restore makes that the LIKELY line rather than a corner: the
 * number a workspace ported in most recently is exactly the one held.
 *
 * Matching on the E.164 rather than on `phone_numbers.porting_status` because
 * the client is never sent that column, and the number is the one identifier
 * both rows are guaranteed to agree on after cutover.
 *
 * RELEASED ROWS ARE NOT A MATCH. A released number has been given up; the card's
 * story there is the release, not the transfer, and letting a released row
 * resolve here would put a hold note on a number nobody holds.
 */
export function numberForPort(
  port: PortRequest,
  numbers: readonly PhoneNumberSummary[],
): PhoneNumberSummary | null {
  return (
    numbers.find(
      (number) =>
        number.status !== "released" && number.number_e164 === port.phone_e164,
    ) ?? null
  );
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
