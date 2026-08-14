import { type NextRequest } from "next/server";

import { cspReportLine, MAX_CSP_REPORT_BYTES } from "@/lib/observability/csp-report";

/**
 * #577 step 2 — where a Content-Security-Policy violation lands.
 *
 * The last pass refused to stage report-only because there was nowhere honest
 * to send reports: Sentry's client path is blocked by ad blockers for a large
 * share of real users, so the data would be silently partial — worse than
 * knowing it is absent. That reasoning is about a THIRD PARTY's collector, and
 * it stops applying the moment the collector is ours. This is same-origin, so
 * no blocker list contains it and no CORS rule governs it, and it writes to the
 * same Worker log every other line goes to.
 *
 * ---------------------------------------------------------------------------
 * IT IS A PUBLIC, UNAUTHENTICATED POST, SO IT IS BUILT LIKE ONE
 *
 * A browser sends these with no session and no way to be asked for one, so the
 * endpoint cannot be gated. What it can do is refuse to be useful to anybody
 * else:
 *
 *   - the body is read with a HARD byte cap. An unbounded read on an open POST
 *     is a way to spend our CPU and fill our logs with somebody else's text.
 *   - nothing is stored, only logged, and what is logged is a fixed set of
 *     fields — never the report wholesale. A violation report carries
 *     `document-uri` and `script-sample`, and this product's URLs name a
 *     conversation while a sample is whatever was on the page. #585 is the
 *     record of what it costs to log a URL from a place nobody was watching.
 *   - the answer is always 204. A report is not a request for information, and
 *     a body that varies with the input is a probe surface.
 */
export async function POST(request: NextRequest): Promise<Response> {
  // 204 whatever happens below. The browser cannot act on an error here and
  // will not retry, so the only thing a status code can do is tell a stranger
  // whether their input parsed.
  const noContent = new Response(null, { status: 204 });

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_CSP_REPORT_BYTES) {
    return noContent;
  }

  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return noContent;
  }
  // Re-checked after reading: `content-length` is the sender's claim, and a
  // chunked body does not carry one at all.
  if (raw.length > MAX_CSP_REPORT_BYTES) return noContent;

  const line = cspReportLine(raw);
  if (line) console.warn(line);
  return noContent;
}
