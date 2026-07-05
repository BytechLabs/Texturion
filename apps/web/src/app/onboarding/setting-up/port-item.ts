import { derivePortUiState } from "@/components/porting/port-ui-state";
import type { PortRequest } from "@/lib/api/types";

/**
 * Port-aware branch of the setting-up checklist (PORTING.md §3.5/§4 P5, §8.1).
 * A port-only signup has NO provisioning saga running — the Telnyx order rests
 * at `draft` until the owner uploads the LOA + a recent bill and submits — so
 * the "Creating your number — under a minute" row would be a flat lie and the
 * required document step would never surface. This module derives which honest
 * port item replaces that row. Pure, so the whole table is unit-testable
 * (mirrors `derivePortUiState`, which it builds on).
 */

export type PortItemPhase =
  /** Draft waiting on the LOA and/or bill — the whole port is gated on this. */
  | "needs_documents"
  /** Draft with both documents on file — one click left, still user-gated. */
  | "needs_submit"
  /** submitted / in-process — with the carrier, honest multi-week window. */
  | "in_review"
  /** foc-date-confirmed / activation-in-progress — the switch date is set. */
  | "date_confirmed"
  /** Voice ported, texting turning on (messaging pending/activating). */
  | "texting_activating"
  /** Voice ported but messaging routing stuck — Telnyx escalates, not the user. */
  | "texting_delayed"
  /** Carrier exception — customer-actionable fix-and-resubmit. */
  | "needs_fix";

export interface PortChecklistItem {
  port: PortRequest;
  phase: PortItemPhase;
  /** True when nothing advances until the owner/admin acts (upload/submit/fix). */
  actionNeeded: boolean;
}

/** The phases where the port sits still until someone at the company acts. */
const ACTION_PHASES: readonly PortItemPhase[] = [
  "needs_documents",
  "needs_submit",
  "needs_fix",
];

function phaseOf(port: PortRequest): PortItemPhase {
  const ui = derivePortUiState(port);
  if (ui.exception === "voice") return "needs_fix";
  if (ui.exception === "messaging") return "texting_delayed";
  if (port.status === "draft") {
    return ui.documentsPending ? "needs_documents" : "needs_submit";
  }
  if (port.status === "ported") return "texting_activating";
  if (
    port.status === "foc-date-confirmed" ||
    port.status === "activation-in-progress"
  ) {
    return "date_confirmed";
  }
  // submitted / in-process — with the losing carrier.
  return "in_review";
}

/**
 * Which port item (if any) replaces the "Creating your number" checklist row.
 *
 *   - An active number (post-cutover, or an opt-in bridge from the paid
 *     webhook) means the plain number row already tells the truth → null.
 *   - No non-cancelled port → null (the new-number provisioning flow).
 *   - Otherwise the newest live port (the API lists `created_at desc`) drives
 *     the row. A provisioning placeholder row (the port's claimed slot) does
 *     NOT suppress the item — that row never advances by itself.
 */
export function resolvePortChecklistItem(
  numbers: readonly { status: string }[],
  ports: readonly PortRequest[],
): PortChecklistItem | null {
  if (numbers.some((n) => n.status === "active")) return null;
  const port = ports.find((p) => !derivePortUiState(p).cancelled);
  if (!port) return null;
  const phase = phaseOf(port);
  return { port, phase, actionNeeded: ACTION_PHASES.includes(phase) };
}

/**
 * Onboarding-only port copy (tone: PORTING.md §9 — plain, honest, no
 * "instant"). The in-flight states reuse `PORT_STATE_COPY` from
 * components/porting/copy.ts; only the strings unique to this checklist
 * surface live here.
 */
export const PORT_CHECKLIST_COPY = {
  /** Replaces the "Creating your number" row title for a port. */
  title: "Transferring your number to Loonext",
  needsDocuments:
    "Upload your signed authorization (LOA) and a recent phone bill to start the transfer — your number can't move until we have both.",
  needsDocumentsCta: "Upload your documents",
  needsSubmit:
    "Your documents are in — send the transfer to your carrier when you're ready.",
  needsSubmitCta: "Review and submit the transfer",
  /** Shown to members, who can't upload — mirrors the OTP row's member line. */
  memberDocuments:
    "Your account owner or an admin uploads the signed authorization (LOA) and a recent phone bill to start the transfer.",
  /** Appended to the §9 "submitted" banner — the honest end-to-end window. */
  inReviewWindow:
    "The whole transfer usually takes a few business days to about two weeks (US) — often faster in Canada.",
  trackLink: "Track it in Settings → Numbers",
} as const;
