/**
 * TEST-ONLY stand-in for the telnyx track's `src/telnyx/porting.ts`
 * (cross-track contract) — see ./provisioning.ts for why this exists. The
 * cross-track suites (stripe.test.ts checkout branch, dispatch, the mounted
 * cron map) assert against these recording doubles; the port saga's own Telnyx
 * HTTP sequence is exercised by the REAL porting suites (src/telnyx/*.test.ts).
 *
 * Every name the real module exposes to OTHER tracks (stripe.ts's
 * startPortSaga, dispatch.ts's handlePortingEvent, index.ts's pollPortRequests)
 * must exist here — vitest fails loudly on a missing export.
 */
import { vi } from "vitest";

import type { Env } from "../../env";

export const startPortSaga = vi.fn<
  (
    env: Env,
    input: { companyId: string; portRequestId: string },
  ) => Promise<null>
>(async () => null);

export const submitPortRequest = vi.fn<
  (
    env: Env,
    input: { companyId: string; portRequestId: string },
  ) => Promise<null>
>(async () => null);

export const handlePortingEvent = vi.fn<
  (env: Env, event: unknown) => Promise<void>
>(async () => {});

export const pollPortRequests = vi.fn<
  (env: Env, now?: Date) => Promise<void>
>(async () => {});

/** Contract mirror of the real hasRequiredDocuments (both doc UUIDs present). */
export function hasRequiredDocuments(row: {
  telnyx_loa_document_id?: string | null;
  telnyx_invoice_document_id?: string | null;
}): boolean {
  return (
    typeof row.telnyx_loa_document_id === "string" &&
    row.telnyx_loa_document_id.length > 0 &&
    typeof row.telnyx_invoice_document_id === "string" &&
    row.telnyx_invoice_document_id.length > 0
  );
}

/** Contract mirror of the real error type (route maps it to §7 `conflict`). */
export class PortDocumentsMissingError extends Error {
  constructor() {
    super("Upload the signed LOA and a recent bill before submitting the transfer.");
    this.name = "PortDocumentsMissingError";
  }
}
