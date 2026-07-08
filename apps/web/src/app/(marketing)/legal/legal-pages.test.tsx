import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import AupPage, { metadata as aupMetadata } from "./aup/page";
import MessagingPolicyPage, {
  metadata as messagingMetadata,
} from "./messaging/page";
import PrivacyPage, { metadata as privacyMetadata } from "./privacy/page";
import RefundsPage, { metadata as refundsMetadata } from "./refunds/page";
import SubprocessorsPage, {
  metadata as subprocessorsMetadata,
} from "./subprocessors/page";
import TermsPage, { metadata as termsMetadata } from "./terms/page";

/**
 * The six legal pages (COPY-DECK v2, V4 coverage map): quiet register,
 * substance unchanged, every em-dash and en-dash converted (Law 6), a true
 * Plain English summary atop each, and the load-bearing billing/policy facts
 * intact.
 */

const PAGES = [
  { name: "terms", html: renderToStaticMarkup(<TermsPage />), meta: termsMetadata },
  { name: "privacy", html: renderToStaticMarkup(<PrivacyPage />), meta: privacyMetadata },
  { name: "aup", html: renderToStaticMarkup(<AupPage />), meta: aupMetadata },
  { name: "messaging", html: renderToStaticMarkup(<MessagingPolicyPage />), meta: messagingMetadata },
  { name: "subprocessors", html: renderToStaticMarkup(<SubprocessorsPage />), meta: subprocessorsMetadata },
  { name: "refunds", html: renderToStaticMarkup(<RefundsPage />), meta: refundsMetadata },
];

describe("legal pages — Laws 1 and 6 across all six", () => {
  it("no em-dash or en-dash anywhere in the rendered pages", () => {
    for (const { name, html } of PAGES) {
      expect(html, `em-dash on /legal/${name}`).not.toContain("—");
      expect(html, `en-dash on /legal/${name}`).not.toContain("–");
    }
  });

  it("no em-dash in any metadata description", () => {
    for (const { name, meta } of PAGES) {
      expect(String(meta.description), name).not.toMatch(/—|–/);
    }
  });

  it("no artifact talk or placeholder sentences (Law 1, purge list)", () => {
    for (const { name, html } of PAGES) {
      expect(html, name).not.toMatch(
        /real interface|not a screenshot|stock photos|fake reviews|built with next|pending, added before launch|name provided at launch/i,
      );
    }
  });

  it("every page opens with the Frost Plain English summary chip", () => {
    for (const { name, html } of PAGES) {
      expect(html, name).toContain("Plain English summary");
    }
  });
});

describe("terms — billing and cancellation facts survive", () => {
  const html = PAGES[0].html;
  it("keeps the plan prices, the one-time fee, and the alert thresholds", () => {
    expect(html).toContain("$29/mo");
    expect(html).toContain("$79/mo");
    expect(html).toContain("one-time $29 fee");
    expect(html).toContain("80% and 100%");
  });
  it("keeps the carrier wait and porting windows in 'to' phrasing", () => {
    expect(html).toContain("3 to 7 business");
    expect(html).toContain("1 to 7 business days");
  });
  it("keeps the 30-day number hold and the guarantee", () => {
    expect(html).toContain("hold your number for 30 days");
    expect(html).toContain("30-day money-back guarantee");
  });
});

describe("privacy — the PIPEDA/Law 25 posture survives", () => {
  const html = PAGES[1].html;
  it("names US processing plainly (us-east-1) and the never-sold commitment", () => {
    expect(html).toContain("us-east-1");
    expect(html).toContain(
      "never shared with, or sold to, third parties or affiliates",
    );
    expect(html).toContain("PIPEDA");
    expect(html).toContain("Law 25");
  });
  it("keeps the no-full-SSN/SIN and no-content-in-analytics commitments", () => {
    expect(html).toContain("never collect or store a full SSN/SIN");
    expect(html).toContain("message content");
  });
});

describe("aup — the consent rules survive", () => {
  const html = PAGES[2].html;
  it("keeps SHAFT, the list ban, and immediate opt-out", () => {
    expect(html).toContain("SHAFT");
    expect(html).toContain("purchased, rented, scraped");
    expect(html).toContain("Opt-out is immediate");
  });
});

describe("messaging — the SMS program disclosures survive", () => {
  const html = PAGES[3].html;
  it("keeps STOP, HELP, frequency, and rates disclosures", () => {
    expect(html).toContain("STOP");
    expect(html).toContain("HELP");
    expect(html).toContain("Message frequency varies");
    expect(html).toContain("Message and data rates may apply");
  });
  it("keeps the FCC revocation window", () => {
    expect(html).toContain("10 business days");
  });
});

describe("subprocessors — the vendor ledger survives", () => {
  const html = PAGES[4].html;
  it("lists all seven vendors", () => {
    for (const vendor of [
      "Telnyx",
      "Stripe",
      "Supabase (on AWS)",
      "Cloudflare",
      "Resend",
      "Sentry",
      "PostHog",
    ]) {
      expect(html).toContain(vendor);
    }
  });
  it("renders the table in the Honesty Ledger voice: frost striping, no cell borders", () => {
    expect(html).toContain("--fr-frost");
    expect(html).not.toContain("border-border");
  });
});

describe("refunds — the guarantee promise survives, word for word where it counts", () => {
  const html = PAGES[5].html;
  it("keeps the full-refund-including-registration-fee language", () => {
    expect(html).toContain("refund your first invoice in full");
    expect(html).toContain("one-time $29 registration fee");
  });
  it("keeps the no-deductions and single-email process", () => {
    expect(html).toContain("minus credits used");
    expect(html).toContain("whole process");
  });
  it("keeps the bank settlement window in 'to' phrasing", () => {
    expect(html).toContain("5 to 10 business days");
  });
});
