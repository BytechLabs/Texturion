/**
 * #577 — turning a violation report into one log line that is safe to keep.
 *
 * Pure, so what reaches the log can be asserted directly. The route is three
 * lines of plumbing around it, which is the point: the decision about what
 * leaves the browser and stays in a log is the whole of this file.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS DELIBERATELY THROWN AWAY
 *
 * A report is a JSON object the BROWSER composes, and two of its fields are
 * dangerous to keep:
 *
 *   `document-uri`    the page that was loaded. In this product a URL names a
 *                     conversation (`/inbox/<id>`) and can carry a search term
 *                     in its query. Only the PATH SHAPE survives here, with
 *                     ids replaced — a violation is a property of a route, not
 *                     of the customer who happened to be looking at it. #585 is
 *                     the record of what logging a full URL costs.
 *   `script-sample`   up to 40 characters of whatever was about to execute.
 *                     Dropped outright: on an inline handler that is the page's
 *                     own content, and the directive plus the blocked origin
 *                     already say what to fix.
 *
 * `blocked-uri` is kept as an ORIGIN. Which host tried to run something is the
 * entire diagnostic value; the path it wanted is not, and a path on a third
 * party's CDN can carry an id of ours.
 */

/**
 * The largest body this will read.
 *
 * A real report is a few hundred bytes; Chrome's is under 1 KB even with a
 * sample. 8 KB is generous enough that a legitimate report is never dropped and
 * small enough that an open POST cannot be used to write essays into our logs.
 */
export const MAX_CSP_REPORT_BYTES = 8_192;

/** Both wire shapes: the deprecated `report-uri` body and the `report-to` one. */
interface LegacyReport {
  "csp-report"?: Record<string, unknown>;
}

interface ReportToEntry {
  type?: string;
  body?: Record<string, unknown>;
}

/**
 * One log line, or null when there is nothing worth writing.
 *
 * Null rather than a line saying "unparseable": this is an open endpoint, so
 * garbage is the expected steady state from crawlers and scanners, and a log
 * that records every one of them is a log nobody reads on the day a real
 * violation arrives.
 */
export function cspReportLine(raw: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  const bodies = extractBodies(parsed);
  if (bodies.length === 0) return null;

  const lines = bodies.map((body) => {
    // The two shapes spell the same fields differently: `report-uri` uses
    // kebab-case, the Reporting API uses camelCase. Reading only one would
    // collect from half the browsers and look like a quiet policy.
    const directive =
      str(body["effective-directive"]) ??
      str(body["effectiveDirective"]) ??
      str(body["violated-directive"]) ??
      str(body["violatedDirective"]) ??
      "unknown";
    const blocked = originOf(
      str(body["blocked-uri"]) ?? str(body["blockedURL"]) ?? "",
    );
    const document = routeShape(
      str(body["document-uri"]) ?? str(body["documentURL"]) ?? "",
    );
    const disposition =
      str(body["disposition"]) === "enforce" ? "enforce" : "report";
    return `csp-violation ${disposition} directive=${directive} blocked=${blocked} route=${document}`;
  });

  return lines.join("\n");
}

/** Both envelopes, flattened to the report bodies inside them. */
function extractBodies(parsed: unknown): Record<string, unknown>[] {
  if (Array.isArray(parsed)) {
    // The Reporting API posts an ARRAY of reports, and it batches — so one
    // request can carry several. Taking `[0]` would silently drop the rest.
    return parsed
      .filter((entry): entry is ReportToEntry => isRecord(entry))
      .filter((entry) => entry.type === undefined || entry.type === "csp-violation")
      .map((entry) => entry.body)
      .filter(isRecord);
  }
  if (isRecord(parsed)) {
    const legacy = (parsed as LegacyReport)["csp-report"];
    if (isRecord(legacy)) return [legacy];
  }
  return [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * The origin of a blocked URL, or a bare keyword.
 *
 * `blocked-uri` is often not a URL at all — `inline`, `eval` and `data` are the
 * common answers and are the most useful ones, so they pass through untouched.
 */
function originOf(value: string): string {
  if (value === "") return "none";
  if (!value.includes("://")) return value.slice(0, 32);
  try {
    return new URL(value).origin;
  } catch {
    return "unparseable";
  }
}

/**
 * The SHAPE of the page's path: every id-looking segment replaced.
 *
 * `/inbox/9f3c…` and `/inbox/2b71…` are the same fact about the same route, and
 * only one of them is a customer. The query string goes entirely — a search
 * term is a customer's words, and no violation was ever diagnosed from one.
 */
function routeShape(value: string): string {
  if (value === "") return "unknown";
  let path: string;
  try {
    path = new URL(value).pathname;
  } catch {
    path = value.split("?")[0];
  }
  const segments = path
    .split("/")
    .map((segment) => (looksLikeId(segment) ? ":id" : segment));
  return segments.join("/").slice(0, 128) || "/";
}

/**
 * Is this segment an identifier rather than a route name?
 *
 * Deliberately narrow — a uuid, or a long opaque token. Not a general
 * "does this look random" classifier: this repo has learned twice what a
 * threshold-list costs, and the failure here is one-directional anyway. A
 * missed id shows up as a route nobody recognises; a route name wrongly
 * replaced by `:id` costs a little diagnosis.
 */
function looksLikeId(segment: string): boolean {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment)) {
    return true;
  }
  return segment.length >= 24 && !segment.includes(".") && !segment.includes("-");
}
