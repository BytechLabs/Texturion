import { DEFAULT_LOCALE } from "@loonext/shared";

import { makeTranslate, type Translate } from "@/i18n/provider";
import type { PhoneNumberSummary, TextEnablement } from "@/lib/api/types";

/**
 * #228: English is the DEFAULT, not the only option.
 *
 * Every sentence below is asserted by `text-enable-state.test.ts`, which runs
 * with no provider — that is the point of the copy living in a pure module. The
 * card passes the reader's own `t`, so a French owner reads French.
 */
const EN = makeTranslate(DEFAULT_LOCALE);

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
  pending: EN("settingsMore.hostedStatePending"),
  actionRequired: EN("settingsMore.hostedStateActionRequired"),
  inProgress: EN("settingsMore.hostedStateInProgress"),
  completed: EN("settingsMore.hostedStateCompleted"),
  cancelled: EN("settingsMore.hostedStateCancelled"),
  failedFallback: EN("settingsMore.hostedStateFailedFallback"),
} as const;

/** Plain one-liners for the two required documents (PDF only — carrier rule). */
export const HOSTED_DOCUMENT_HINTS = {
  loa: EN("settingsMore.hostedLoaHint"),
  bill: EN("settingsMore.hostedBillHint"),
} as const;

/** The failed banner: the carrier's reason plainly, or a calm fallback. */
export function textEnableFailedLine(
  lastError: string | null,
  t: Translate = EN,
): string {
  const reason = lastError?.trim();
  return reason && reason.length > 0
    ? reason
    : t("settingsMore.hostedStateFailedFallback");
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
  t: Translate = EN,
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
      ? t("settingsMore.hostedStatePending")
      : status === "action-required"
        ? t("settingsMore.hostedStateActionRequired")
        : status === "in-progress"
          ? t("settingsMore.hostedStateInProgress")
          : status === "completed"
            ? t("settingsMore.hostedStateCompleted")
            : status === "failed"
              ? textEnableFailedLine(order.last_error, t)
              : t("settingsMore.hostedStateCancelled");

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
export function validateHostedDocument(
  file: {
    size: number;
    type: string;
    name: string;
  },
  t: Translate = EN,
): string | null {
  if (file.size === 0 || file.size > MAX_HOSTED_DOCUMENT_BYTES) {
    return t("settingsMore.hostedDocSizeError");
  }
  const isPdf =
    file.type === "application/pdf" ||
    (file.type === "" && file.name.toLowerCase().endsWith(".pdf"));
  if (!isPdf) {
    return t("settingsMore.hostedDocTypeError");
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
