/**
 * #252 — the product has ONE answer to "what happens if I reply to this?".
 *
 * It had two. Five customer-facing emails told the reader to reply, and the
 * footer printed under every one of them said replies were not read. Both were
 * shipped deliberately, months apart, and neither was wrong on its own terms:
 * the bodies were written when `RESEND_REPLY_TO` was the plan, the footer was
 * written by somebody who could not verify the routing and chose the cautious
 * claim.
 *
 * The cautious claim was the false one, and false in the expensive direction.
 * The workspace-deletion pair says "Closed by mistake? Reply to this email
 * before <date> and we can restore it" — the ONLY stated route to undoing
 * something irreversible — directly above a line telling the reader that route
 * goes nowhere. A customer who believes the footer does not write to support.
 * They conclude they have been ignored, and the workspace is gone in 30 days.
 *
 * A unit test on either file passes with the contradiction intact, because the
 * contradiction is between two files. This one reads the whole source tree.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const SRC = join(import.meta.dirname, "..");
/**
 * The OTHER worker that mails (#477). Scanned too, because a guard that stops
 * at the apps/api boundary is how "the product gives one answer" stayed true
 * only inside one worker: `apps/web/src/lib/marketing/status-mailer.ts` posts
 * to Resend directly and was sending no Reply-To at all.
 */
const WEB_MARKETING = join(SRC, "..", "..", "web", "src", "lib", "marketing");

/** Every .ts in both mailing trees, tests excluded. */
function sources(): string[] {
  const walk = (root: string) =>
    readdirSync(root, { recursive: true, encoding: "utf8" })
      .filter((entry) => entry.endsWith(".ts") && !entry.endsWith(".test.ts"))
      .map((entry) => join(root, entry));
  return [...walk(SRC), ...walk(WEB_MARKETING)];
}

describe("#252 the reply posture is stated once", () => {
  it("reads the tree, so a passing run means something", () => {
    const files = sources();
    expect(files.length).toBeGreaterThan(50);
  });

  it("no email tells the reader their reply will not be read", () => {
    // The posture is: a reply reaches a person. `sendEmail` stamps a Reply-To
    // on every send and falls back to the monitored support address when the
    // operator never set the secret, so this is true by construction rather
    // than by deployment.
    const offenders: string[] = [];
    for (const path of sources()) {
      const text = readFileSync(path, "utf8");
      // The literal the old footer used, and the shapes a rewrite would reach
      // for. Matched against the whole file including comments on purpose: a
      // comment asserting the opposite posture is how the next builder decides
      // which of the two answers is current.
      if (/repl(y|ies|ying)[^.\n]{0,40}(are|is) not read/i.test(text)) {
        offenders.push(path.slice(path.indexOf("apps")));
      }
      if (/do not reply to this (email|address)/i.test(text)) {
        offenders.push(path.slice(path.indexOf("apps")));
      }
    }
    expect(
      offenders,
      `These say replies go unread, which contradicts the Reply-To stamped on ` +
        `every send: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("every path to Resend stamps a Reply-To, not just the main one", () => {
    // The invariant is product-wide or it is not an invariant. Two files post
    // to Resend: apps/api's `sendEmail` and the marketing worker's tiny direct
    // client. A reader of either one alone would conclude replies are handled.
    // Test scaffolding names the same URL in order to INTERCEPT it, so match on
    // sending rather than mentioning: a real sender POSTs, a stub matches.
    const isScaffolding = (path: string) =>
      /[\\/]test[\\/]|test-support|harness/.test(path);
    const posters = sources()
      .filter((path) => !isScaffolding(path))
      .filter((path) => {
        const text = readFileSync(path, "utf8");
        return (
          /api\.resend\.com\/emails/.test(text) && /method:\s*"POST"/.test(text)
        );
      });
    expect(posters.length).toBeGreaterThan(1);
    const missing = posters.filter(
      (path) => !/reply_to/.test(readFileSync(path, "utf8")),
    );
    expect(
      missing,
      `These POST to Resend without a reply_to, so replies land on the ` +
        `unmonitored sender: ${missing.map((p) => p.slice(p.indexOf("apps"))).join(", ")}`,
    ).toEqual([]);
  });

  it("the emails that promise a reply are still there to be kept", () => {
    // The other direction, and the reason this guard is not simply "delete the
    // sentence". If the bodies below ever lose their promise, the fix above
    // became pointless and somebody should notice. The deletion pair is named
    // explicitly because it is the one where being ignored is unrecoverable.
    const deletion = readFileSync(
      join(SRC, "workspace", "deletion-emails.ts"),
      "utf8",
    );
    expect(deletion).toMatch(/Closed by mistake\? Reply to this email/);
  });
});
