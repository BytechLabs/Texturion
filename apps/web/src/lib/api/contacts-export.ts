import { ApiError, parseErrorBody } from "./error";

/**
 * CSV export core (D20 §3.1 / APP-FEATURES-V2 §3.1). GET /v1/contacts/export
 * streams a UTF-8 CSV (BOM for Excel) of the company's contacts respecting the
 * current `q` filter ("export what I'm looking at"), with a Content-Disposition
 * attachment header. It is a BINARY body, not the JSON envelope `apiFetch`
 * parses, so this path fetches raw with the same Authorization + X-Company-Id
 * headers and hands back the response text for the caller to download.
 *
 * This module is deliberately ENVIRONMENT-FREE (no `@/env`, no Supabase
 * import) — like `core.ts`, everything it needs is injected — so it is
 * unit-testable in the node test env. The env + session wiring lives in the
 * `useExportContacts` hook (`contacts-export-hook.ts`).
 */

const EXPORT_FILENAME = "contacts.csv";

export interface ExportDeps {
  fetch: typeof fetch;
  getToken: () => Promise<string | null>;
  baseUrl: string;
}

/**
 * Fetch the export as a raw Blob. Reading the body as bytes (never `.text()`)
 * preserves the server's leading UTF-8 BOM — `Response.text()` decodes UTF-8
 * and DROPS a leading U+FEFF, which would defeat Excel's encoding hint (the
 * same reason the API emits the BOM as raw bytes). On a non-2xx it parses the
 * SPEC §7 error envelope into a typed ApiError, so callers surface the same
 * calm messages the JSON client does.
 */
export async function fetchContactsExport(
  companyId: string,
  q: string,
  deps: ExportDeps,
): Promise<{ blob: Blob; filename: string }> {
  const baseUrl = deps.baseUrl.replace(/\/$/, "");

  // Bind-free local, exactly like `core.ts`: calling `deps.fetch(...)` as a
  // METHOD runs native fetch with `this === deps`, which the browser rejects
  // with "Illegal invocation" (fetch must be invoked unbound / on `window`).
  // Assigning to a local first makes the call unbound.
  const fetchImpl = deps.fetch;

  const token = await deps.getToken();
  if (!token) {
    throw new ApiError("unauthorized", "You're signed out. Log in again.", 401);
  }

  const url = new URL(`${baseUrl}/v1/contacts/export`);
  const trimmed = q.trim();
  if (trimmed !== "") url.searchParams.set("q", trimmed);

  const response = await fetchImpl(url.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Company-Id": companyId,
    },
  });

  if (!response.ok) {
    // The error arm still speaks JSON (SPEC §7 envelope) even though the
    // success arm is CSV — parse it for a typed, calm message.
    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    throw parseErrorBody(response.status, payload);
  }

  // Bytes, not text — keep the BOM intact for the downloaded file.
  const bytes = await response.arrayBuffer();
  const blob = new Blob([bytes], { type: "text/csv;charset=utf-8" });
  const filename = parseFilename(response.headers.get("Content-Disposition"));
  return { blob, filename };
}

/** Pull the server's filename from the Content-Disposition header, if any. */
function parseFilename(disposition: string | null): string {
  if (!disposition) return EXPORT_FILENAME;
  const match = /filename="?([^"]+)"?/i.exec(disposition);
  return match?.[1]?.trim() || EXPORT_FILENAME;
}

/** Trigger a browser download of a Blob (no-op outside the browser). */
export function triggerBlobDownload(blob: Blob, filename: string): void {
  if (typeof document === "undefined") return;
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}
