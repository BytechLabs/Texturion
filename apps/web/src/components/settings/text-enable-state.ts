import type { PhoneNumberSummary, TextEnablement } from "@/lib/api/types";

/**
 * Keep-your-number text-enablement UI state + copy (FEATURE-GAPS voice wave,
 * path B). Pure so the whole state table is unit-testable; the Settings
 * text-enable card renders from it (mirrors `porting/port-ui-state.ts`).
 *
 * Honest states only: a hosted-SMS order is carrier-reviewed for a few
 * business days and there is NO real progress signal between 'pending' and
 * 'completed' — so the card shows one plain status sentence per state, never
 * an invented percentage or a fake stepper. A 'failed' order carries the
 * carrier's real reason in last_error (the raw Telnyx status included) and is
 * rendered verbatim; while under review (pending / action-required /
 * in-progress) the optional number-ownership verification step applies
 * (`canVerify` — POST /:id/verification-codes + /verify).
 */

/** Per-state status sentences (plain, no jargon beyond the LOA field label). */
export const TEXT_ENABLE_STATE_COPY = {
  pending:
    "Waiting on carrier review — typically a few business days. Calls keep working with your current carrier the whole time.",
  actionRequired:
    "The carrier needs your signed authorization (LOA) and a recent bill before it can continue.",
  inProgress:
    "Your documents are with the carrier for review. Nothing to do — texting turns on here the moment it completes.",
  completed:
    "Texting is live on this number. Calls are unchanged — they stay with your current carrier.",
  cancelled:
    "Text-enablement cancelled. Your number is untouched with your current carrier.",
  failedFallback:
    "The carrier couldn't complete this. Check your documents and resubmit.",
} as const;

/** Plain one-liners for the two required documents (PDF only — carrier rule). */
export const HOSTED_DOCUMENT_HINTS = {
  loa: "A signed letter authorizing texting on this number. PDF only, under 5 MB, signed within the last 90 days, listing this number.",
  bill: "A recent bill from your current carrier — less than 30 days old, showing this number. PDF only, under 5 MB.",
} as const;

/** The failed banner: the carrier's reason plainly, or a calm fallback. */
export function textEnableFailedLine(lastError: string | null): string {
  const reason = lastError?.trim();
  return reason && reason.length > 0
    ? reason
    : TEXT_ENABLE_STATE_COPY.failedFallback;
}

export interface TextEnableUiState {
  /** The one plain status sentence for the card banner. */
  statusLine: string;
  /** Banner tint: quiet stone, success once live, warning when actionable. */
  tone: "muted" | "success" | "warning";
  /** Whether the LOA and/or bill still need uploading. */
  documentsPending: boolean;
  /** Whether the upload form applies right now (the API's upload window). */
  showDocumentsForm: boolean;
  /** Whether resubmit applies (failed, or action-required with docs on file). */
  canResubmit: boolean;
  /** Whether the owner can still cancel (any non-terminal state). */
  cancellable: boolean;
  /**
   * Whether the number-ownership verification step applies — the API's
   * verificationGate window (pending / action-required / in-progress). The
   * vendor-order-exists half of that gate stays server-side (vendor ids never
   * reach the client); a too-early request surfaces the API's 409 sentence.
   */
  canVerify: boolean;
  /** True once texting is live (`completed`). */
  live: boolean;
  /** True once abandoned (`cancelled`) — the caller renders a quiet note. */
  cancelled: boolean;
}

/** Fold an order row into the card state (one honest sentence per status). */
export function deriveTextEnableUiState(
  order: TextEnablement,
): TextEnableUiState {
  const { status } = order;
  const live = status === "completed";
  const cancelled = status === "cancelled";
  const documentsPending = !order.has_loa || !order.has_bill;
  // The server's upload window: before the carrier review starts, or after it
  // rejects (routes/text-enablement.ts documentsUploadable). While pending
  // with both docs on file there is nothing to upload, so the form hides.
  const uploadable =
    status === "pending" || status === "action-required" || status === "failed";
  const showDocumentsForm =
    uploadable && (documentsPending || status !== "pending");

  const statusLine =
    status === "pending"
      ? TEXT_ENABLE_STATE_COPY.pending
      : status === "action-required"
        ? TEXT_ENABLE_STATE_COPY.actionRequired
        : status === "in-progress"
          ? TEXT_ENABLE_STATE_COPY.inProgress
          : status === "completed"
            ? TEXT_ENABLE_STATE_COPY.completed
            : status === "failed"
              ? textEnableFailedLine(order.last_error)
              : TEXT_ENABLE_STATE_COPY.cancelled;

  return {
    statusLine,
    tone: live
      ? "success"
      : status === "failed" || status === "action-required"
        ? "warning"
        : "muted",
    documentsPending,
    showDocumentsForm,
    // The API allows resubmit from failed OR action-required; from
    // action-required it only helps once the missing documents are on file.
    canResubmit:
      status === "failed" || (status === "action-required" && !documentsPending),
    cancellable: !live && !cancelled,
    // Mirrors the API's verification window exactly: an order under (or
    // heading into) carrier review can still prove number ownership.
    canVerify:
      status === "pending" ||
      status === "action-required" ||
      status === "in-progress",
    live,
    cancelled,
  };
}

// ---------------------------------------------------------------------------
// Document validation (the client gate before the multipart PUT)
// ---------------------------------------------------------------------------

// Mirrors the route's MAX_DOCUMENT_BYTES: 5 MB, the Telnyx hosted-SMS per-file
// limit (STRICTER than porting's 10 MB — the file_upload action rejects more).
export const MAX_HOSTED_DOCUMENT_BYTES = 5 * 1024 * 1024;

/**
 * Client-side check mirroring the documents route: non-empty, under 5 MB
 * (the carrier's hosted-SMS file limit), and PDF ONLY (the carrier's
 * hosted-SMS file action accepts nothing else). Structural param so tests
 * never need a real File. Returns the error sentence, or null when the file
 * is acceptable.
 */
export function validateHostedDocument(file: {
  size: number;
  type: string;
  name: string;
}): string | null {
  if (file.size === 0 || file.size > MAX_HOSTED_DOCUMENT_BYTES) {
    return "Each file must be a non-empty PDF under 5 MB (the carrier's limit for these documents).";
  }
  const isPdf =
    file.type === "application/pdf" ||
    (file.type === "" && file.name.toLowerCase().endsWith(".pdf"));
  if (!isPdf) {
    return "The carrier accepts only PDF files for these documents.";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Number partitioning (Settings → Numbers de-duplication)
// ---------------------------------------------------------------------------

/**
 * A `phone_numbers` row with `source='hosted'` belongs to a text-enablement,
 * NOT the plain provisioned-number surface — Settings → Numbers renders it
 * ONCE, through the TextEnableSection order card, never as a NumberCard with
 * the "under a minute" provisioning copy (a flat contradiction of the honest
 * multi-day carrier-review window). Mirrors how ported rows are partitioned
 * out via `porting/port-ui-state.ts`. `source` is read defensively: a missing
 * value (pre-wave cache) means the row is not hosted.
 */
export function splitHostedNumbers(numbers: readonly PhoneNumberSummary[]): {
  hosted: PhoneNumberSummary[];
  rest: PhoneNumberSummary[];
} {
  const hosted: PhoneNumberSummary[] = [];
  const rest: PhoneNumberSummary[] = [];
  for (const number of numbers) {
    if (number.source === "hosted") hosted.push(number);
    else rest.push(number);
  }
  return { hosted, rest };
}

/**
 * True when the company holds numbers and every live one is hosted — i.e.
 * every call still rings the owner's existing carrier, so missed-call
 * text-back has nothing to observe. Drives the one quiet caveat line on
 * Settings → Missed calls. Released rows don't count either way.
 */
export function onlyHostedNumbers(
  numbers: readonly PhoneNumberSummary[],
): boolean {
  const live = numbers.filter((n) => n.status !== "released");
  return live.length > 0 && live.every((n) => n.source === "hosted");
}
