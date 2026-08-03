/**
 * #252 — a commercial email must not wear the transactional footer.
 *
 * `sendEmail` appends "This is a service message about your Loonext account"
 * to every text part, centrally, so no transactional builder can ship without
 * it. That default is right for nearly everything here and WRONG for the one
 * commercial send: the recipient is a captured prospect who by construction has
 * no account, the message is governed by CAN-SPAM/CASL rather than being a
 * service message, and it already carries its own compliance block. Appending
 * ours puts a second footer below the unsubscribe line and misdescribes what
 * the message is.
 *
 * The exemption is opt-in (`kind: "commercial"`), which means the failure mode
 * is a NEW commercial sender inheriting the transactional default by omission.
 * That is what this guard catches: an unsubscribe link is the giveaway that a
 * send is commercial, so any builder that mints one must declare it.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const SRC = join(import.meta.dirname, "..");

function sources(): string[] {
  return readdirSync(SRC, { recursive: true, encoding: "utf8" })
    .filter((entry) => entry.endsWith(".ts") && !entry.endsWith(".test.ts"))
    .map((entry) => join(SRC, entry));
}

describe("#252 commercial sends declare themselves", () => {
  it("reads the tree, so a passing run means something", () => {
    expect(sources().length).toBeGreaterThan(50);
  });

  it("every builder that mints an unsubscribe link declares kind: commercial", () => {
    const offenders: string[] = [];
    for (const path of sources()) {
      const text = readFileSync(path, "utf8");
      // Not merely mentioning "unsubscribe" — transactional notification mail
      // legitimately sets a List-Unsubscribe header. The signal is a builder
      // that both calls sendEmail and produces an unsubscribe URL of its own.
      const sends = /\bsendEmail\s*\(/.test(text);
      const mintsUnsubscribe = /unsubscribeUrl\s*\(/.test(text);
      if (!sends || !mintsUnsubscribe) continue;
      if (!/kind:\s*"commercial"/.test(text)) {
        offenders.push(path.slice(path.indexOf("apps")));
      }
    }
    expect(
      offenders,
      `These send mail with their own unsubscribe link but do not pass ` +
        `kind: "commercial", so sendEmail will append the transactional ` +
        `service-message footer beneath their compliance block: ` +
        offenders.join(", "),
    ).toEqual([]);
  });

  it("the known commercial sender is still found by that rule", () => {
    // Guards against the rule silently matching nothing after a refactor —
    // a sweep that finds no candidates passes vacuously.
    const candidates = sources().filter((path) => {
      const text = readFileSync(path, "utf8");
      return /\bsendEmail\s*\(/.test(text) && /unsubscribeUrl\s*\(/.test(text);
    });
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.some((p) => p.includes("comparison-email"))).toBe(true);
  });
});
