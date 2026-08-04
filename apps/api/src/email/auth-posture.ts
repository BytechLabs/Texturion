/**
 * #252 — the authentication posture, re-checked rather than remembered.
 *
 * The issue's own words about why this file exists: *"An unrecorded fact is one
 * nobody re-checks."* We recorded it — `docs/deploy/08-operations.md` §4b has
 * SPF, DKIM and DMARC verified by DNS lookup with a date against each. But a
 * dated line in a document is only true on the day it was written. DNS is
 * edited by hand, at a registrar, by one person, usually while doing something
 * else; a record can be deleted, replaced, or moved to a new provider and the
 * document will go on saying it was fine in August.
 *
 * So this asks the DNS, on the schedule the deliverability job already runs on,
 * and says something when the answer stops matching. It closes the same gap the
 * doc closed, one layer down: recorded → checked.
 *
 * ── WHAT IT CANNOT DO, AND WHY THAT IS NOT A REASON TO SKIP IT ────────────
 *
 * It cannot FIX anything. Adding a TXT record needs zone access no token in
 * this project has (docs/deploy §4b), so both remaining gaps — DMARC, and the
 * second sending subdomain that would separate the critical stream — are
 * founder actions and will stay founder actions.
 *
 * That is precisely the argument for checking. A gap somebody has to act on is
 * exactly the kind that gets forgotten, and the failure is silent for months
 * and then total: the first symptom of a deliverability problem is a customer
 * saying they never got the grace-period warning, at which point the number is
 * already gone. An alert that says "still missing" is the only thing standing
 * between a known gap and a forgotten one.
 *
 * ── DNS-over-HTTPS, BECAUSE A WORKER HAS NO RESOLVER ──────────────────────
 *
 * Workers cannot open a UDP socket, so there is no `dig` here. Cloudflare's
 * public resolver answers DNS queries over HTTPS as JSON, which is a plain
 * `fetch`. It is the same resolver the deploy doc's `nslookup … 8.8.8.8`
 * recipe consults a different copy of, so the two agree.
 *
 * EVERY FAILURE IS SILENT, deliberately. A resolver that times out, answers
 * badly, or rate-limits us says nothing about our DNS — and an ops alert that
 * fires on the checker's own bad day is an alert somebody learns to ignore,
 * which costs more than the gap it was watching.
 */
import type { Env } from "../env";

/** Cloudflare's public resolver, JSON API. */
const DOH_ENDPOINT = "https://cloudflare-dns.com/dns-query";

/** TXT. */
const TYPE_TXT = 16;

/**
 * Short. This runs inside an hourly cron alongside real work, and a resolver
 * that is slow is a resolver whose answer we are happy to skip.
 */
const LOOKUP_TIMEOUT_MS = 4_000;

export interface PostureRecord {
  /** The host asked about, e.g. `_dmarc.loonext.com`. */
  host: string;
  /** The matching TXT value, or null when there is none. */
  value: string | null;
  /** False when the lookup itself failed — NOT the same as "absent". */
  resolved: boolean;
}

export interface AuthPosture {
  domain: string;
  spf: PostureRecord;
  dkim: PostureRecord;
  dmarc: PostureRecord;
}

/**
 * The domain a message is actually FROM, out of a `RESEND_FROM` that may be
 * `Name <box@domain>` or a bare address. Null when there is nothing to check,
 * which is a configuration this job simply skips.
 */
export function sendingDomain(from: string | null | undefined): string | null {
  if (!from) return null;
  const angle = /<([^>]+)>/.exec(from);
  const address = (angle ? angle[1] : from).trim();
  const at = address.lastIndexOf("@");
  if (at === -1) return null;
  const domain = address.slice(at + 1).trim().toLowerCase();
  // A bare label is not a domain, and asking a resolver about one wastes a
  // round trip to learn that.
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain) ? domain : null;
}

/** One TXT lookup. Never throws — see the header. */
async function txt(host: string): Promise<PostureRecord> {
  const url = `${DOH_ENDPOINT}?name=${encodeURIComponent(host)}&type=TXT`;
  try {
    const response = await fetch(url, {
      headers: { accept: "application/dns-json" },
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    });
    if (!response.ok) return { host, value: null, resolved: false };
    const body = (await response.json()) as {
      Status?: number;
      Answer?: { type?: number; data?: string }[];
    };
    // NXDOMAIN (3) is a real ANSWER: the host does not exist, so the record is
    // absent. Anything else non-zero is the resolver failing to tell us.
    if (body.Status !== 0 && body.Status !== 3) {
      return { host, value: null, resolved: false };
    }
    const values = (body.Answer ?? [])
      .filter((answer) => answer.type === TYPE_TXT)
      .map((answer) => unquote(answer.data ?? ""))
      .filter((value) => value.length > 0);
    return { host, value: values[0] ?? null, resolved: true };
  } catch {
    return { host, value: null, resolved: false };
  }
}

/**
 * DoH returns TXT data quoted, and splits strings over 255 characters into
 * several quoted chunks that must be concatenated — a long DKIM key arrives
 * that way, and a naive read of only the first chunk reports a valid record as
 * malformed.
 */
function unquote(data: string): string {
  const chunks = data.match(/"([^"]*)"/g);
  if (!chunks) return data.trim();
  return chunks.map((chunk) => chunk.slice(1, -1)).join("");
}

/** Ask the DNS what our authentication looks like right now. */
export async function readAuthPosture(domain: string): Promise<AuthPosture> {
  const [spf, dkim, dmarc] = await Promise.all([
    txt(domain),
    // Resend publishes its key at this selector; §4b records the same host.
    txt(`resend._domainkey.${domain}`),
    txt(`_dmarc.${domain}`),
  ]);
  return {
    domain,
    // A domain's TXT set holds more than SPF. Only the policy record counts.
    spf: spf.value && !/^v=spf1\b/i.test(spf.value) ? { ...spf, value: null } : spf,
    dkim,
    dmarc: dmarc.value && !/^v=DMARC1\b/i.test(dmarc.value)
      ? { ...dmarc, value: null }
      : dmarc,
  };
}

/**
 * What is wrong, in the order it matters. Empty when the posture is sound —
 * or when we could not read it, since a resolver's bad day is not a finding.
 */
export function postureProblems(posture: AuthPosture): string[] {
  const problems: string[] = [];
  if (posture.dmarc.resolved && posture.dmarc.value === null) {
    problems.push(
      `DMARC is absent at _dmarc.${posture.domain}. Without a policy a ` +
        `receiver deciding what to do with mail that fails alignment has ` +
        `nothing from us to go on, and we get no aggregate reports — so the ` +
        `first sign of a delivery problem would be a customer saying they ` +
        `never got the grace-period warning.`,
    );
  }
  if (posture.spf.resolved && posture.spf.value === null) {
    problems.push(
      `SPF is absent at ${posture.domain}. Mail from this domain now has one ` +
        `fewer way to authenticate, and DMARC alignment depends on it.`,
    );
  }
  if (posture.dkim.resolved && posture.dkim.value === null) {
    problems.push(
      `DKIM is absent at resend._domainkey.${posture.domain}. This is the ` +
        `record that survives forwarding, and losing it is the single ` +
        `largest drop in deliverability available to us.`,
    );
  }
  return problems;
}

/**
 * The alert body. Separate from the sending so the copy is testable without a
 * mailbox, the same split `health.ts` uses.
 */
export function postureAlertText(
  posture: AuthPosture,
  problems: string[],
): string {
  return (
    `The sending domain's email authentication is not what ` +
    `docs/deploy/08-operations.md §4b records.\n\n` +
    `${problems.map((line) => `• ${line}`).join("\n\n")}\n\n` +
    `Each of these is a TXT record, and adding one needs zone access no token ` +
    `in this project has — so this is a founder action, and this message is ` +
    `the only thing between a known gap and a forgotten one.\n\n` +
    `DMARC, monitor-only, changes nothing about delivery and starts the ` +
    `reports:\n\n` +
    `  _dmarc.${posture.domain}  TXT  "v=DMARC1; p=none; rua=mailto:dmarc@${posture.domain}"\n\n` +
    `Re-check by hand any time with:\n\n` +
    `  nslookup -type=TXT _dmarc.${posture.domain} 8.8.8.8`
  );
}

/**
 * True when this run should send. Once a day at most.
 *
 * The gap this watches is a DNS record somebody has to go and add, which is
 * days of work-in-progress at best — an hourly reminder would be twenty-four
 * copies of the same sentence before anybody could act on the first, and the
 * mailbox that cries wolf is the one whose next message goes unread. The
 * cadence is derived from the clock rather than stored, so there is no state
 * to keep and nothing to reset.
 */
export function shouldAlertNow(now: Date): boolean {
  return now.getUTCHours() === POSTURE_ALERT_HOUR_UTC;
}

/** Mid-morning UK / early morning North America — a working hour somewhere. */
export const POSTURE_ALERT_HOUR_UTC = 9;

/** The env's sending address, or null when email is not configured at all. */
export function postureDomainFor(env: Env): string | null {
  return sendingDomain(env.RESEND_FROM);
}
