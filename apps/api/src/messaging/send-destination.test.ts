/**
 * #291 — a send goes to the number the THREAD is with.
 *
 * Ten call sites read a destination out of a conversation. Every one of them
 * used to read `contacts.phone_e164` — the customer's PRIMARY number — which
 * is the right answer only while a customer has exactly one. The moment they
 * have two, a reply on the landline thread goes to the mobile, and there is no
 * error, no bounce and no failed delivery: just a customer who never answers
 * and a crew who thinks they did.
 *
 * A reviewer cannot hold ten files in their head, and the eleventh site will
 * be written by somebody who never read this issue. So the rule is enforced by
 * reading the source: a file that sends, and that pulls `contacts(phone_e164)`
 * out of a `conversations` query, is almost certainly about to send to the
 * wrong line.
 *
 * The exemption list is the honest part. `contacts.phone_e164` is still the
 * right column in several places — creating a thread that does not exist yet,
 * showing who a contact IS, checking an opt-out that belongs to a number
 * rather than a thread. Each one says why.
 */
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { sourceFiles, sourceText } from "../test/source-tree";

const API_SRC = join(import.meta.dirname, "..");

/**
 * Files that legitimately read a contact's primary number.
 *
 * Adding to this list is a decision, not a formality: it says "this really is
 * about the customer, not about a thread".
 */
const ALLOWED: Record<string, string> = {
  "routes/conversations.ts":
    "opening a thread that does not exist yet, where the primary is the only " +
    "number there is",
  "messaging/delivery-by-country.ts":
    "counts sends by the DESTINATION COUNTRY of the customer; the country of " +
    "a second number in the same country is the same country",
  "notifications/inbound.ts":
    "the notification's title — who texted, not where a reply goes",
  "notifications/missed-call.ts":
    "the notification's title — who called, not where a reply goes",
  "notifications/contact-name.ts":
    "the one place an alert resolves WHO a thread is with — a title, never a " +
    "destination. The assignment and payment alerts read it from here rather " +
    "than each holding its own copy of the fallback",
  "routes/calls.ts":
    "the call DETAIL view names the customer; the dial destination on the " +
    "same file reads `contact_phone_e164`",
  "routes/scheduled-messages.ts":
    "lists a queued text beside the customer it is for; the destination it " +
    "schedules against reads `contact_phone_e164`",
  "routes/usage.ts":
    "counts sends by DESTINATION COUNTRY; a second number in the same " +
    "country is the same country",
};

/**
 * Production sources only.
 *
 * `sourceFiles` is #492's shared reader — memoised and `withFileTypes`, so this
 * guard does not add a twenty-second synchronous walk to a full run and time
 * out some unrelated suite that then reports an assertion failure about
 * whatever it was checking.
 */
function productionFiles(): string[] {
  return sourceFiles(API_SRC, [".ts"]).filter(
    (path) => !path.endsWith(".test.ts"),
  );
}

/** The source with comments removed — prose about the rule is not a breach. */
function code(path: string): string {
  return sourceText(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/(^|\s)\/\/.*$/, "$1"))
    .join("\n");
}

describe("#291 a send goes to the number the thread is with", () => {
  it("reads the whole API source, so a passing run means something", () => {
    // A scan that walked nothing would pass forever. Asserted rather than
    // assumed, because that is the failure this whole file exists to prevent
    // in the product.
    const files = productionFiles();
    expect(files.length).toBeGreaterThan(100);
    expect(
      files.some((f) => f.replace(/\\/g, "/").endsWith("routes/messages.ts")),
    ).toBe(true);
  });

  it("never pulls a contact's primary number out of a conversation query", () => {
    const offenders: string[] = [];
    for (const path of productionFiles()) {
      const rel = path.slice(API_SRC.length + 1).replace(/\\/g, "/");
      if (rel in ALLOWED) continue;
      const text = code(path);
      // The embed form — `conversations(contacts(phone_e164))` or a select on
      // `conversations` that reaches into `contacts(...phone_e164...)`.
      const embedsContactPhone =
        /contacts\([^)]*phone_e164/.test(text) &&
        /from\("conversations"\)|conversations\(/.test(text);
      if (embedsContactPhone) offenders.push(rel);
    }
    expect(
      offenders,
      "These files read a contact's PRIMARY number out of a conversation. " +
        "The destination is `conversations.contact_phone_e164` — the number " +
        "the thread is with. If the primary really is right here, add the " +
        "file to ALLOWED with the reason:",
    ).toEqual([]);
  });

  it("keeps the exemption list honest — every entry still exists", () => {
    // A stale exemption is worse than none: it reads as a considered decision
    // about a file that has since been renamed or deleted, and it silently
    // widens to whatever takes that path next.
    const all = new Set(
      productionFiles().map((p) =>
        p.slice(API_SRC.length + 1).replace(/\\/g, "/"),
      ),
    );
    const missing = Object.keys(ALLOWED).filter((rel) => !all.has(rel));
    expect(missing, "Exempted files that no longer exist:").toEqual([]);
  });

  it("keeps the exemption list honest — every entry still needs exempting", () => {
    // The other half. A file that stopped reading the primary number should
    // lose its exemption, so the next one to start reading it gets caught.
    const stale = Object.keys(ALLOWED).filter((rel) => {
      const text = code(join(API_SRC, rel));
      return !/contacts\([^)]*phone_e164/.test(text);
    });
    expect(
      stale,
      "These files no longer read a contact's primary number, so their " +
        "exemption is dead weight and would silently cover a future breach:",
    ).toEqual([]);
  });
});
