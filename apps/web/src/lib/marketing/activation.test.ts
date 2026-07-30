import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  ACTIVATION_CHIP,
  ACTIVATION_CLAIM,
  ACTIVATION_CLAIM_SHORT,
  RETIRED_ACTIVATION_CLAIM,
} from "./activation";

/**
 * #437 — the activation claim, and why this is a filesystem sweep rather than a
 * copy assertion.
 *
 * The issue reported "live in minutes" on the blog CTA and the feature pages. A
 * case-insensitive grep found SIXTEEN copies across nine files: every trade page
 * carried it twice (a trust-bar chip and a closing subhead), plus pricing and a
 * feature page. Nobody had grepped, which is the actual bug — one wrong sentence is
 * a typo, sixteen is a missing constant.
 *
 * So the test walks the marketing source and fails on the phrase itself. A future
 * copy edit that types it again fails here, which is the only version of this fix
 * that survives the next person who has not read the issue.
 */

const MARKETING_DIRS = [
  join(process.cwd(), "src", "app", "(marketing)"),
  join(process.cwd(), "src", "components", "marketing"),
];

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(tsx?|mdx)$/.test(entry)) continue;
      if (entry.endsWith(".test.ts") || entry.endsWith(".test.tsx")) continue;
      found.push(full);
    }
  };
  walk(dir);
  return found;
}

describe("#437 — no marketing surface promises US texting is live immediately", () => {
  it("contains no copy of the retired phrase", () => {
    const offenders: string[] = [];
    for (const dir of MARKETING_DIRS) {
      for (const file of sourceFiles(dir)) {
        const source = readFileSync(file, "utf8");
        if (source.toLowerCase().includes(RETIRED_ACTIVATION_CLAIM)) {
          offenders.push(file.replace(process.cwd(), ""));
        }
      }
    }
    expect(
      offenders,
      `\n\n"${RETIRED_ACTIVATION_CLAIM}" is back in: ${offenders.join(", ")}\n\n` +
        `It is true for a Canadian shop and for anyone who only RECEIVES texts, and\n` +
        `wrong by about a week for a US business that wants to send — which is most\n` +
        `readers. blog/a2p-10dlc-registration-honest-timeline tells readers to\n` +
        `distrust exactly this claim, so on that page it contradicted our own advice.\n` +
        `Use ACTIVATION_CLAIM, ACTIVATION_CLAIM_SHORT, or ACTIVATION_CHIP from\n` +
        `lib/marketing/activation.ts.\n`,
    ).toEqual([]);
  });

  it("the replacements all name the carrier wait, except the chip", () => {
    // The two sentence-length forms must carry the qualifier; a shorter version
    // that dropped it would recreate the bug in a tighter space.
    expect(ACTIVATION_CLAIM).toMatch(/carriers approve/i);
    expect(ACTIVATION_CLAIM_SHORT).toMatch(/carriers approve/i);
    // The chip is honest compression: it claims setup, not outbound.
    expect(ACTIVATION_CHIP).toBe("Set up today");
    expect(ACTIVATION_CHIP).not.toMatch(/minute|instant|live/i);
  });

  it("keeps Law 6: no em or en dashes in copy that renders", () => {
    for (const phrase of [ACTIVATION_CLAIM, ACTIVATION_CLAIM_SHORT, ACTIVATION_CHIP]) {
      expect(phrase).not.toMatch(/[—–]/);
    }
  });

  it("reads as a sentence fragment that slots after a comma", () => {
    // Both long forms are used as `…the whole team can see, ${CLAIM}.` so they must
    // start lowercase and carry no trailing period of their own.
    for (const phrase of [ACTIVATION_CLAIM, ACTIVATION_CLAIM_SHORT]) {
      expect(phrase[0]).toBe(phrase[0].toLowerCase());
      expect(phrase.endsWith(".")).toBe(false);
    }
  });
});
