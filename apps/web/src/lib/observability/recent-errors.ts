/**
 * #253 — the last few things that went wrong on this device, for a report.
 *
 * The acceptance criterion is that a report carries recent errors "without the
 * user assembling them". Android and iOS already had a diagnostics ring
 * (#197/#198); the web had nothing but Sentry, which the customer cannot read
 * and which [[observability-state]] records as blocked by ad blockers for a
 * large share of real browsers. So on the surface where the founder's own
 * screenshots come from, the errors were being thrown away.
 *
 * # In memory only, on purpose
 *
 * Not localStorage. This holds error text from a signed-in session, and a
 * shared work tablet outlives the session it was typed in. A ring that empties
 * on reload is worth less than one that persists — and worth much more than one
 * that leaves a previous crew member's customer data readable on a device
 * somebody else picked up.
 *
 * # Scrubbed at the door
 *
 * Anything that looks like a phone number or an email is redacted before it is
 * stored, not before it is sent. A buffer that holds PII and filters on read is
 * one careless caller away from leaking it, and the value of the raw digits was
 * never the point: "send failed: carrier_rejected" is the diagnostic.
 */

/** How many we keep. Matches SUPPORT_ERROR_LINES — more would never be sent. */
const CAPACITY = 12;

interface Entry {
  at: number;
  line: string;
}

let ring: Entry[] = [];

/** Digits that could be a NANP number, and anything shaped like an email. */
const PHONE = /\+?\d[\d\s().-]{6,}\d/g;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;

/**
 * Redact the two things a customer's error text most often carries.
 *
 * Deliberately blunt. A regex that tries to be clever about which digit runs
 * are phone numbers will miss one, and the cost of over-redacting is a slightly
 * less specific diagnostic line, which is a cost worth paying every time.
 */
export function scrubErrorLine(raw: string): string {
  return raw.replace(EMAIL, "[email]").replace(PHONE, "[number]").slice(0, 160);
}

/**
 * Record something that failed. Safe to call from anywhere, including render.
 *
 * Never throws: a diagnostics buffer that can break the app it is diagnosing is
 * strictly worse than no buffer.
 */
export function recordClientError(line: string): void {
  try {
    const clean = scrubErrorLine(line).trim();
    if (clean === "") return;
    ring.push({ at: Date.now(), line: clean });
    if (ring.length > CAPACITY) ring = ring.slice(ring.length - CAPACITY);
  } catch {
    // See above.
  }
}

/**
 * Newest first, which is the order somebody reading a bug report wants: the
 * failure that made them write in is the one they hit last.
 */
export function recentClientErrors(): string[] {
  return ring
    .slice()
    .reverse()
    .map((entry) => `${new Date(entry.at).toISOString().slice(11, 19)} ${entry.line}`);
}

/** Test seam, and what a sign-out should call. */
export function clearClientErrors(): void {
  ring = [];
}
