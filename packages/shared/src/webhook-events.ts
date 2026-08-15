/**
 * #243 — the outbound webhook contract, in one place.
 *
 * A public integration surface is a promise: the event names, the signature
 * scheme and the retry schedule are things other people's code depends on, and
 * the moment any of them is written down twice one copy starts drifting. This
 * module is the single home for all three, and the API, the three clients and
 * the docs all read it rather than restating it.
 *
 * Deliberately dependency-free and synchronous. The Worker signs with
 * WebCrypto, the clients only ever validate and label, and nothing here needs
 * either — so the same file is importable from a Kotlin/Swift hand-port
 * without dragging a runtime in.
 */

/**
 * The events a workspace can subscribe to.
 *
 * Chosen to be the things an outside system acts on, not everything that
 * happens. A connector wants to know a customer wrote in, a job was booked, a
 * message failed — it does not want our internal state transitions, and every
 * name added here is a name we can never remove without breaking somebody.
 */
export const WEBHOOK_EVENT_TYPES = [
  "message.received",
  "message.sent",
  "message.failed",
  "call.completed",
  "voicemail.received",
  "task.created",
  "task.completed",
  "contact.created",
] as const;

export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

export function isWebhookEventType(value: string): value is WebhookEventType {
  return (WEBHOOK_EVENT_TYPES as readonly string[]).includes(value);
}

/**
 * The catalogue key that names an event to a human.
 *
 * Derived rather than listed: the event name IS the key suffix, dot-segments
 * camel-cased. A hand-written map would be a second copy of the vocabulary,
 * and #548's lesson is that the second copy is the one that goes stale.
 */
export function webhookEventLabelKey(type: WebhookEventType): string {
  const camel = type.replace(/\.(\w)/g, (_, c: string) => c.toUpperCase());
  return `webhooks.event.${camel}`;
}

// ---------------------------------------------------------------------------
// Signing
// ---------------------------------------------------------------------------

/**
 * The header carrying the signature, in the `t=<unix>,v1=<hex>` shape.
 *
 * Versioned from the first delivery (`v1=`) because #243 asks for a
 * compatibility policy on day one, and the cheapest version marker is one that
 * is already in every request when it is first needed.
 */
export const WEBHOOK_SIGNATURE_HEADER = "loonext-signature";

/** The header naming the event, so a receiver can route without parsing a body. */
export const WEBHOOK_EVENT_HEADER = "loonext-event";

/** The header carrying the delivery id, so a receiver can dedupe redeliveries. */
export const WEBHOOK_DELIVERY_HEADER = "loonext-delivery";

/**
 * How far out of step a receiver should tolerate before rejecting as a replay.
 *
 * Five minutes each way: long enough for a slow retry and a clock that has
 * never been disciplined, short enough that a captured request stops being
 * useful quickly.
 */
export const WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS = 300;

/**
 * The exact bytes that get signed.
 *
 * The timestamp is INSIDE the signed material, which is the whole point — a
 * signature over the body alone is replayable forever, because the attacker
 * can resend the same bytes with a fresh timestamp and it still verifies.
 */
export function webhookSignaturePayload(timestampSeconds: number, body: string): string {
  return `${timestampSeconds}.${body}`;
}

/** Format the header value for a computed hex signature. */
export function webhookSignatureHeader(timestampSeconds: number, hexSignature: string): string {
  return `t=${timestampSeconds},v1=${hexSignature}`;
}

/**
 * Read a `t=…,v1=…` header back apart.
 *
 * Tolerant of order and of unknown `vN=` schemes so that adding `v2` later
 * does not break a receiver written against this parser — it returns what it
 * understands and ignores what it does not.
 */
export function parseWebhookSignatureHeader(
  header: string,
): { timestampSeconds: number; v1: string } | null {
  let timestamp: number | null = null;
  let v1: string | null = null;
  for (const part of header.split(",")) {
    const [rawKey, ...rest] = part.split("=");
    if (rest.length === 0) continue;
    const key = rawKey.trim();
    const value = rest.join("=").trim();
    if (key === "t") {
      const parsed = Number(value);
      if (Number.isInteger(parsed) && parsed > 0) timestamp = parsed;
    } else if (key === "v1") {
      v1 = value;
    }
  }
  if (timestamp === null || v1 === null || v1.length === 0) return null;
  return { timestampSeconds: timestamp, v1 };
}

// ---------------------------------------------------------------------------
// Retry
// ---------------------------------------------------------------------------

/**
 * The gaps between attempts, in seconds, after the first one fails.
 *
 * Six attempts total spanning about eight hours. Long enough that a receiver
 * doing a deploy or sleeping off an incident wakes up to its events; short
 * enough that the queue does not carry a dead endpoint's backlog for days at
 * our expense.
 */
export const WEBHOOK_RETRY_SCHEDULE_SECONDS = [30, 120, 600, 3_600, 21_600] as const;

export const WEBHOOK_MAX_ATTEMPTS = WEBHOOK_RETRY_SCHEDULE_SECONDS.length + 1;

/**
 * How long to wait before attempt number `attemptsSoFar + 1`, or null when
 * there is no next attempt and the delivery is finished failing.
 */
export function webhookRetryDelaySeconds(attemptsSoFar: number): number | null {
  if (attemptsSoFar < 1) return 0;
  const next = WEBHOOK_RETRY_SCHEDULE_SECONDS[attemptsSoFar - 1];
  return next === undefined ? null : next;
}

/**
 * Consecutive failed deliveries before we stop calling an endpoint at all.
 *
 * A dead endpoint costs us a subrequest per event forever, and the workspace
 * that pointed a webhook at a laptop and closed it is not going to notice.
 * Twenty is roughly a few hours of a busy inbox — well past a transient
 * outage, well short of a standing bill.
 */
export const WEBHOOK_AUTO_DISABLE_AFTER_CONSECUTIVE_FAILURES = 20;

/** Matches the database trigger. Stated here so the UI can say so before the 422. */
export const WEBHOOK_ENDPOINT_CAP = 10;

/** How long we wait on a receiver before calling the attempt failed. */
export const WEBHOOK_TIMEOUT_MS = 10_000;

/**
 * How much of a failing response we keep. Enough to debug a 400 with a body,
 * far short of storing somebody's error page.
 */
export const WEBHOOK_ERROR_EXCERPT_LIMIT = 500;

// ---------------------------------------------------------------------------
// Where a webhook may point
// ---------------------------------------------------------------------------

/**
 * Why a URL was refused. Returned as a reason rather than a boolean so the
 * clients can say WHICH rule bit — "that address is inside a private network"
 * is actionable and "invalid URL" is not.
 */
export type WebhookUrlRejection =
  | "not-a-url"
  | "not-https"
  | "private-host"
  | "loopback-host"
  | "our-own-host"
  | "has-credentials"
  | "too-long";

/**
 * Hosts that would make a webhook point back at us.
 *
 * Not paranoia about the customer — an endpoint aimed at our own API is an
 * amplifier: one inbound message fans out to a delivery, which arrives as a
 * request, which may emit another event. The loop is cheap to write by
 * accident and expensive to run.
 */
const OUR_OWN_HOSTS = ["loonext.com", "api.loonext.com", "www.loonext.com"];

/**
 * IPv4 literals that are not routable on the public internet, plus the two
 * that matter most: 127.0.0.0/8 reaches the Worker's own loopback and
 * 169.254.169.254 is the cloud metadata endpoint on every major provider.
 */
function privateIpv4Reason(host: string): WebhookUrlRejection | null {
  const parts = host.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map((p) => Number(p));
  if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  const [a, b] = octets as [number, number, number, number];
  if (a === 127) return "loopback-host";
  if (a === 10) return "private-host";
  if (a === 192 && b === 168) return "private-host";
  if (a === 172 && b >= 16 && b <= 31) return "private-host";
  if (a === 169 && b === 254) return "private-host"; // link-local, incl. metadata
  if (a === 0) return "private-host";
  if (a >= 224) return "private-host"; // multicast and reserved
  return null;
}

/**
 * Decide whether a customer-supplied webhook URL is one we are willing to make
 * a server-side request to.
 *
 * This is an SSRF gate, and it is honest about its limit: it can only judge
 * the host as WRITTEN. A public name that resolves to 10.0.0.1 defeats it, and
 * no amount of string checking fixes that — what fixes it is that this Worker
 * has no private network to reach. The value here is refusing the obvious
 * cases loudly, at the moment the customer types them, rather than discovering
 * them in a delivery log.
 */
export function webhookUrlRejection(raw: string): WebhookUrlRejection | null {
  if (raw.length > 2000) return "too-long";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "not-a-url";
  }
  if (url.protocol !== "https:") return "not-https";
  if (url.username.length > 0 || url.password.length > 0) return "has-credentials";

  // `URL` KEEPS the brackets on an IPv6 literal — `new URL("https://[::1]/")`
  // has hostname `"[::1]"`, not `"::1"`. Assuming otherwise is how every one of
  // the IPv6 rules below silently matches nothing, which is exactly what the
  // first version of this function did until its own tests said so.
  const host = url.hostname
    .toLowerCase()
    .replace(/\.$/, "")
    .replace(/^\[(.*)\]$/, "$1");
  if (host === "localhost" || host.endsWith(".localhost")) return "loopback-host";
  if (host.endsWith(".local") || host.endsWith(".internal")) return "private-host";
  if (host === "::1" || host === "0:0:0:0:0:0:0:1") return "loopback-host";
  if (host.includes(":")) {
    // Only apply the IPv6 prefix rules to something that really is an IPv6
    // literal — plenty of ordinary names start with `fc` or `fd`.
    if (host.startsWith("fc") || host.startsWith("fd")) return "private-host";
    if (host.startsWith("fe80:")) return "private-host";
    // ::ffff:10.0.0.1 is an IPv4 address wearing an IPv6 hat, and it reaches
    // exactly the same host. It never arrives in that spelling, though: `URL`
    // normalises the dotted quad into hex groups, so what actually shows up is
    // `::ffff:a00:1`. Matching the form somebody TYPES would match nothing.
    const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host);
    if (mapped) {
      const high = Number.parseInt(mapped[1]!, 16);
      const low = Number.parseInt(mapped[2]!, 16);
      const dotted = [high >> 8, high & 0xff, low >> 8, low & 0xff].join(".");
      const inner = privateIpv4Reason(dotted);
      if (inner) return inner;
    }
  }

  const ipv4 = privateIpv4Reason(host);
  if (ipv4) return ipv4;

  if (OUR_OWN_HOSTS.includes(host)) return "our-own-host";

  return null;
}

/** Convenience for call sites that only need the yes/no. */
export function isDeliverableWebhookUrl(raw: string): boolean {
  return webhookUrlRejection(raw) === null;
}

/** The catalogue key explaining a rejection to the person who typed it. */
export function webhookUrlRejectionKey(reason: WebhookUrlRejection): string {
  const camel = reason.replace(/-(\w)/g, (_, c: string) => c.toUpperCase());
  return `webhooks.urlError.${camel}`;
}
