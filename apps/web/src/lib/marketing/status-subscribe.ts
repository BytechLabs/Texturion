/**
 * #477 — being TOLD about an incident instead of having to go and look.
 *
 * # Why this lives on the marketing worker and not in the API
 *
 * The list and the sender have to survive the outage they exist to announce.
 * That single sentence decides the whole design, and it rules out the obvious
 * implementation: the API worker already has Resend wired, rate limiting,
 * suppressions and a database, so subscribing there would have been a fraction
 * of this code. But then the notifier shares a failure domain with the product.
 * A bad migration, a Supabase outage, or a broken API deploy — three of the
 * worst incident classes we have — would take the announcement down with the
 * thing it was announcing, and the only incidents it could still report are the
 * ones customers were least hurt by.
 *
 * So the list lives in the same KV namespace as the live line, and the send
 * goes out from the worker that serves the page. That is exactly the argument
 * `docs/INCIDENT-COMMS.md` §5 made for the live line itself: the page is served
 * by Cloudflare, so a Cloudflare dependency adds no failure domain the page did
 * not already have, while a Postgres dependency would ADD one.
 *
 * # Why not buy a status provider, which §5 recommended for this item
 *
 * That recommendation stood on one claim: a provider brings subscribe-by-email
 * along with it, so it is cheaper than building. The claim is true and the
 * conclusion still does not follow, because the build turned out to be a list
 * in KV and two emails — and buying means a recurring bill and a fourth vendor
 * holding our customers' addresses. See D105.
 *
 * # Cost, which is the part that can go wrong quietly
 *
 * Every address here is an email we pay for, and an open subscribe endpoint is
 * a way for a stranger to spend our money and put our domain in front of people
 * who never asked for it. Both are capped, both stop rather than overspend, and
 * the monthly ceiling is the one that actually binds:
 *
 *   MAX_SUBSCRIBERS         the list cannot grow without bound
 *   MAX_CONFIRMS_PER_DAY    a script cannot mint confirmation emails all night
 *   MAX_FANOUTS_PER_DAY     a flapping incident line cannot mail the list ten
 *                           times before anybody notices
 *   MAX_EMAILS_PER_MONTH    the ceiling all of the above roll up into
 *
 * Nothing here alerts a human when a cap is reached, because there is no
 * channel from this worker that would reach one during an incident. It logs and
 * stops, and the page says plainly that subscriptions are closed rather than
 * accepting an address it will never mail.
 */

import type { MarketingLocale } from "@/i18n/marketing/footer";
import { statusCopy } from "@/i18n/marketing/status";

import { absoluteUrl } from "./site";

/** Nothing subscribes, confirms or sends past these. */
export const MAX_SUBSCRIBERS = 200;
export const MAX_CONFIRMS_PER_DAY = 50;
export const MAX_FANOUTS_PER_DAY = 2;
export const MAX_EMAILS_PER_MONTH = 1000;

/** How long an unconfirmed address may sit before it disappears. */
export const PENDING_TTL_SECONDS = 24 * 60 * 60;

/** KV key prefixes, sharing the namespace the live line already uses. */
export const SUBSCRIBE_KEYS = {
  /** `sub:<token>` → `{ email, locale }`. The token is its unsubscribe link. */
  subscriber: "sub:",
  /** `pending:<token>` → `{ email, locale }`, until confirmed or expired. */
  pending: "pending:",
  /** The incident sentence the list was last mailed about. "" means resolved. */
  notified: "notified",
  /** `fanout:<YYYY-MM-DD>` → how many fan-outs went out that day. */
  fanoutDay: "fanout:",
  /** `confirms:<YYYY-MM-DD>` → how many confirmation emails went out. */
  confirmDay: "confirms:",
  /** `emails:<YYYY-MM>` → every status email we sent that month. */
  emailMonth: "emails:",
} as const;

/**
 * The store this module needs. A `KVNamespace` satisfies it; a Map-backed fake
 * satisfies it in tests, which is the reason it is written out rather than
 * imported from the Workers types.
 */
export interface SubscriberStore {
  get(key: string): Promise<string | null>;
  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ): Promise<void>;
  delete(key: string): Promise<void>;
  list(options: { prefix: string }): Promise<{ keys: { name: string }[] }>;
}

export type StatusSubscriptionLocale = MarketingLocale;

interface SubscriberRecord {
  email: string;
  locale: StatusSubscriptionLocale;
}

/** Only URL-backed marketing locales are valid for this anonymous workflow. */
export function statusSubscriptionLocale(
  raw: unknown,
): StatusSubscriptionLocale {
  return raw === "fr-CA" ? "fr-CA" : "en";
}

/**
 * Existing KV rows contain only an email address. Read those as English while
 * new rows carry their locale in JSON. This is expand-and-contract without a
 * migration job or a window where the outage list cannot send.
 */
function readSubscriberRecord(raw: string | null): SubscriberRecord | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const email = normalizeEmail(parsed.email);
    if (!email) return null;
    return { email, locale: statusSubscriptionLocale(parsed.locale) };
  } catch {
    const email = normalizeEmail(raw);
    return email ? { email, locale: "en" } : null;
  }
}

function writeSubscriberRecord(record: SubscriberRecord): string {
  return JSON.stringify(record);
}

export const STATUS_SUBSCRIPTION_PATHS = {
  en: {
    status: "/status",
    subscribed: "/status/subscribed",
    unsubscribed: "/status/unsubscribed",
  },
  "fr-CA": {
    status: "/fr/etat-du-service",
    subscribed: "/fr/etat-du-service/abonnement-confirme",
    unsubscribed: "/fr/etat-du-service/desabonnement-confirme",
  },
} as const;

/**
 * Normalize an address, or reject it.
 *
 * Deliberately not a full RFC 5322 validator: the only thing that decides
 * whether an address is real is whether the confirmation email arrives, and
 * that check happens anyway. This exists to reject what is obviously not an
 * address and to bound what goes into a KV value.
 */
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim().toLowerCase();
  if (value.length < 6 || value.length > 254) return null;
  if (!/^[^\s@,;<>"]+@[^\s@,;<>".]+\.[a-z]{2,}$/.test(value)) return null;
  return value;
}

/** An unguessable token. It is the confirm link AND the unsubscribe link. */
export function mintToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Tokens arrive from a URL, so they are checked before they touch a key. */
export function isToken(raw: unknown): raw is string {
  return typeof raw === "string" && /^[0-9a-f]{32}$/.test(raw);
}

/** UTC-pinned, so a counter cannot roll over twice by crossing a timezone. */
export function dayKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export function monthKey(now: Date): string {
  return now.toISOString().slice(0, 7);
}

/**
 * Read a counter, add to it, and say whether the addition was allowed.
 *
 * Read-modify-write on KV has no compare-and-set, so two requests in the same
 * instant can both read the same number and one increment is lost. That is
 * accepted here and it is the right direction to be wrong in: a lost increment
 * means a cap that is a little generous, never one that silently blocks. The
 * counters exist to stop runaway spend, not to be an exact ledger.
 */
async function bumpCounter(
  store: SubscriberStore,
  key: string,
  limit: number,
  ttlSeconds: number,
  by = 1,
): Promise<boolean> {
  const current = Number((await store.get(key)) ?? 0);
  const used = Number.isFinite(current) && current > 0 ? current : 0;
  if (used + by > limit) return false;
  await store.put(key, String(used + by), { expirationTtl: ttlSeconds });
  return true;
}

/** Every status email, whatever kind, counts against the monthly ceiling. */
async function claimMonthlyBudget(
  store: SubscriberStore,
  now: Date,
  count: number,
): Promise<boolean> {
  return bumpCounter(
    store,
    `${SUBSCRIBE_KEYS.emailMonth}${monthKey(now)}`,
    MAX_EMAILS_PER_MONTH,
    40 * 24 * 60 * 60,
    count,
  );
}

export type SubscribeOutcome =
  | "sent"
  | "already"
  | "invalid"
  | "full"
  | "rate_limited"
  | "failed";

/** The address rows currently on the list. */
async function listSubscribers(
  store: SubscriberStore,
): Promise<(SubscriberRecord & { token: string })[]> {
  const { keys } = await store.list({ prefix: SUBSCRIBE_KEYS.subscriber });
  const rows = await Promise.all(
    keys.map(async (key) => {
      const record = readSubscriberRecord(await store.get(key.name));
      return record
        ? {
            token: key.name.slice(SUBSCRIBE_KEYS.subscriber.length),
            ...record,
          }
        : null;
    }),
  );
  return rows.filter(
    (row): row is SubscriberRecord & { token: string } => row !== null,
  );
}

/**
 * Step one of double opt-in: record a pending address and email it a link.
 *
 * DOUBLE OPT-IN IS NOT CEREMONY HERE. Anyone can type anyone's address into a
 * public form. Without the confirmation step this endpoint is a way to make our
 * domain send mail to strangers, which is how a sending domain gets burned —
 * and the mail in question announces our outages, so the abuse writes itself.
 *
 * The pending record carries a TTL rather than needing to be cleaned up: an
 * address that is never confirmed disappears on its own, and a list that
 * garbage-collects itself is one nobody has to remember to prune.
 */
export async function startSubscription(
  store: SubscriberStore,
  mailer: Mailer,
  email: string,
  locale: StatusSubscriptionLocale,
  now: Date,
): Promise<SubscribeOutcome> {
  const existing = await listSubscribers(store);
  // Already on the list: stop here, and — importantly — the caller says the
  // same thing it says on success. Confirming to a stranger that an address is
  // subscribed is a disclosure the form has no reason to make.
  if (existing.some((row) => row.email === email)) return "already";
  if (existing.length >= MAX_SUBSCRIBERS) return "full";

  const allowedToday = await bumpCounter(
    store,
    `${SUBSCRIBE_KEYS.confirmDay}${dayKey(now)}`,
    MAX_CONFIRMS_PER_DAY,
    2 * 24 * 60 * 60,
  );
  if (!allowedToday) return "rate_limited";
  if (!(await claimMonthlyBudget(store, now, 1))) return "rate_limited";

  const token = mintToken();
  await store.put(
    `${SUBSCRIBE_KEYS.pending}${token}`,
    writeSubscriberRecord({ email, locale }),
    { expirationTtl: PENDING_TTL_SECONDS },
  );
  const copy = statusCopy(locale);
  const sent = await mailer.send({
    to: email,
    subject: copy.confirmEmailSubject,
    text: confirmEmailText(token, locale),
  });
  return sent ? "sent" : "failed";
}

/** Step two: the address proved it wanted this. */
export async function confirmSubscription(
  store: SubscriberStore,
  token: string,
): Promise<StatusSubscriptionLocale | null> {
  if (!isToken(token)) return null;
  const pendingKey = `${SUBSCRIBE_KEYS.pending}${token}`;
  const record = readSubscriberRecord(await store.get(pendingKey));
  if (!record) return null;
  await store.put(
    `${SUBSCRIBE_KEYS.subscriber}${token}`,
    writeSubscriberRecord(record),
  );
  await store.delete(pendingKey);
  return record.locale;
}

/**
 * Leaving, in one click and with no questions.
 *
 * Returns the stored locale when the row still exists. The link also carries
 * that locale because a mail client may prefetch the GET and delete the row
 * before the person clicks it; the visible result must still stay French.
 */
export async function unsubscribe(
  store: SubscriberStore,
  token: string,
): Promise<StatusSubscriptionLocale | null> {
  if (!isToken(token)) return null;
  const subscriberKey = `${SUBSCRIBE_KEYS.subscriber}${token}`;
  const pendingKey = `${SUBSCRIBE_KEYS.pending}${token}`;
  const [subscriber, pending] = await Promise.all([
    store.get(subscriberKey),
    store.get(pendingKey),
  ]);
  await store.delete(subscriberKey);
  await store.delete(pendingKey);
  return (
    readSubscriberRecord(subscriber)?.locale ??
    readSubscriberRecord(pending)?.locale ??
    null
  );
}

export type NotificationKind = "none" | "incident" | "resolved";

/**
 * What, if anything, the list should be told — a pure function of two strings.
 *
 * TRANSITIONS ONLY, which is the pattern `webhook_liveness.test.sql` and
 * `call_silence.test.sql` already establish: alert when the state changes,
 * never on a steady state. A page that emails the list on every render is a
 * page nobody stays subscribed to.
 *
 * The empty string is a real value here and means "nothing is wrong". So the
 * first read on a healthy day compares "" to "" and sends nothing, which is why
 * a fresh namespace does not announce an incident that never happened.
 */
export function decideNotification(
  current: string | null,
  lastNotified: string | null,
): NotificationKind {
  const now = (current ?? "").trim();
  const last = (lastNotified ?? "").trim();
  if (now === last) return "none";
  if (now.length > 0) return "incident";
  return "resolved";
}

export interface Mailer {
  send(message: {
    to: string;
    subject: string;
    text: string;
    listUnsubscribeUrl?: string;
  }): Promise<boolean>;
}

function localeQuery(locale: StatusSubscriptionLocale): string {
  return locale === "fr-CA" ? "&locale=fr-CA" : "";
}

export function confirmUrl(
  token: string,
  locale: StatusSubscriptionLocale = "en",
): string {
  return absoluteUrl(
    `/api/status/confirm?token=${token}${localeQuery(locale)}`,
  );
}

export function confirmEmailText(
  token: string,
  locale: StatusSubscriptionLocale = "en",
): string {
  const copy = statusCopy(locale);
  return [
    copy.confirmEmailIntro,
    "",
    copy.confirmEmailAction,
    confirmUrl(token, locale),
    "",
    copy.confirmEmailIgnore,
  ].join("\n");
}

export function incidentEmailText(
  incident: string,
  token: string,
  locale: StatusSubscriptionLocale = "en",
): string {
  const copy = statusCopy(locale);
  return [
    copy.incidentEmailSubject,
    "",
    incident,
    "",
    copy.incidentEmailBody,
    "",
    absoluteUrl(STATUS_SUBSCRIPTION_PATHS[locale].status),
    "",
    "---",
    `${copy.unsubscribeLabel}: ${unsubscribeUrl(token, locale)}`,
  ].join("\n");
}

export function resolvedEmailText(
  token: string,
  locale: StatusSubscriptionLocale = "en",
): string {
  const copy = statusCopy(locale);
  return [
    copy.resolvedEmailSubject,
    "",
    copy.resolvedEmailBody,
    "",
    absoluteUrl(STATUS_SUBSCRIPTION_PATHS[locale].status),
    "",
    "---",
    `${copy.unsubscribeLabel}: ${unsubscribeUrl(token, locale)}`,
  ].join("\n");
}

export function unsubscribeUrl(
  token: string,
  locale: StatusSubscriptionLocale = "en",
): string {
  return absoluteUrl(
    `/api/status/unsubscribe?token=${token}${localeQuery(locale)}`,
  );
}

export interface StatusIncidentCopy {
  en: string | null;
  "fr-CA": string | null;
}

/**
 * Tell the list, if there is anything to tell.
 *
 * WRITES THE MARKER BEFORE IT SENDS, on purpose. Two page renders in different
 * isolates can reach this at the same moment and KV has no compare-and-set, so
 * one of the two orders has to be chosen. Marking first means a crash halfway
 * through loses an announcement; marking last means a crash sends the list two
 * copies of the same outage notice. Under-notify rather than double-notify:
 * the page still carries the incident, and a duplicate at 3am is how a list
 * loses the subscribers it exists to serve.
 *
 * Never throws. It runs inside `waitUntil` on a page request, and the page must
 * render whatever happens here.
 */
export async function notifySubscribers(
  store: SubscriberStore,
  mailer: Mailer,
  incident: StatusIncidentCopy,
  now: Date,
): Promise<{ kind: NotificationKind; sent: number }> {
  try {
    const last = await store.get(SUBSCRIBE_KEYS.notified);
    const kind = decideNotification(incident.en, last);
    if (kind === "none") return { kind, sent: 0 };

    const subscribers = await listSubscribers(store);
    const marker = (incident.en ?? "").trim();
    if (subscribers.length === 0) {
      // Nobody to tell, but the marker still moves — otherwise the first person
      // to subscribe during an incident gets mailed about it as if it were new.
      await store.put(SUBSCRIBE_KEYS.notified, marker);
      return { kind, sent: 0 };
    }

    const fanoutsLeft = await bumpCounter(
      store,
      `${SUBSCRIBE_KEYS.fanoutDay}${dayKey(now)}`,
      MAX_FANOUTS_PER_DAY,
      2 * 24 * 60 * 60,
    );
    if (!fanoutsLeft) {
      console.error(
        "#477 status fan-out: daily cap reached, not mailing the list",
      );
      return { kind: "none", sent: 0 };
    }
    if (!(await claimMonthlyBudget(store, now, subscribers.length))) {
      console.error(
        "#477 status fan-out: monthly email ceiling reached, not mailing the list",
      );
      return { kind: "none", sent: 0 };
    }

    await store.put(SUBSCRIBE_KEYS.notified, marker);

    const results = await Promise.all(
      subscribers.map((row) => {
        const copy = statusCopy(row.locale);
        const incidentText =
          row.locale === "fr-CA"
            ? incident["fr-CA"] ?? copy.incidentFallback
            : marker;
        return mailer.send({
          to: row.email,
          subject:
            kind === "incident"
              ? copy.incidentEmailSubject
              : copy.resolvedEmailSubject,
          text:
            kind === "incident"
              ? incidentEmailText(incidentText, row.token, row.locale)
              : resolvedEmailText(row.token, row.locale),
          listUnsubscribeUrl: unsubscribeUrl(row.token, row.locale),
        });
      }),
    );
    return { kind, sent: results.filter(Boolean).length };
  } catch (cause) {
    console.error(`#477 status fan-out failed: ${String(cause)}`);
    return { kind: "none", sent: 0 };
  }
}

/** Whether the list is open to new addresses — the form asks before it renders. */
export async function subscriptionsOpen(store: SubscriberStore): Promise<boolean> {
  try {
    const { keys } = await store.list({ prefix: SUBSCRIBE_KEYS.subscriber });
    return keys.length < MAX_SUBSCRIBERS;
  } catch {
    return false;
  }
}
