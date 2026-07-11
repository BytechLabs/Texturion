import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The cookies page mounts the consent preferences control (#124), which reads
// publicEnv. Mock the env module (hoisted above the page imports) so the
// suite runs without the required NEXT_PUBLIC_* build vars; GTM stays unset,
// matching every non-production build.
vi.mock("@/env", () => ({ publicEnv: { NEXT_PUBLIC_GTM_ID: undefined } }));

import AupPage, { metadata as aupMetadata } from "./aup/page";
import CookiesPage, { metadata as cookiesMetadata } from "./cookies/page";
import FairUsePage, { metadata as fairUseMetadata } from "./fair-use/page";
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
 * The seven legal pages (COPY-DECK v2, V4 coverage map): quiet register,
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
  // Appended last so the index-based per-page blocks above keep their indices.
  { name: "fair-use", html: renderToStaticMarkup(<FairUsePage />), meta: fairUseMetadata },
  { name: "cookies", html: renderToStaticMarkup(<CookiesPage />), meta: cookiesMetadata },
];

describe("legal pages — Laws 1 and 6 across all seven", () => {
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

describe("fair-use — the plain limits survive", () => {
  const html = PAGES[6].html;
  it("states the included allowances and the spending-cap pause", () => {
    expect(html).toContain("500 texts");
    expect(html).toContain("2,500 texts");
    expect(html).toContain("spending cap");
    expect(html).toContain("80% and again at 100%");
  });
  it("states the voice fair-use figures — the ONLY public home of the minutes (D36/D38)", () => {
    expect(html).toContain("2,500 calling minutes");
    expect(html).toContain("6,000");
    expect(html).toContain("shared by both");
    expect(html).toContain("billed at 1¢ each");
    // Ring time never bills, and the pause lives at the cap, not the allowance.
    expect(html).toContain("ringing that goes unanswered never counts");
    expect(html).not.toContain("300 forwarded minutes");
    expect(html).toContain("Only at your cap does calling pause");
  });
  it("keeps the reasonable-use reservation and the not-a-blaster scope", () => {
    expect(html).toContain("normal, fair, and reasonable");
    expect(html).toContain("application-to-person (A2P)");
  });
  it("frames the allowances as a fair-use line and states the dynamic watch (#85)", () => {
    expect(html).toContain("fair-use line");
    expect(html).toContain("reach out early");
  });
});

describe("cookies — essential cookies plus consent-gated GTM (#87, #124)", () => {
  const html = PAGES[7].html;
  it("names the three essential first-party cookies (session + workspace + consent choice)", () => {
    expect(html).toContain("keeps you signed in");
    expect(html).toContain("remembers which workspace");
    expect(html).toContain("loonext.consent");
    expect(html).toContain("180");
  });
  it("states tracking cookies exist only after a yes to the banner (#124)", () => {
    expect(html).toContain("Google Tag Manager");
    expect(html).toContain("denied-by-default");
    expect(html).toContain("only if you say yes");
  });
  it("keeps the cookieless product-analytics promise and the no-ad-networks stance", () => {
    expect(html).toContain("cookieless");
    expect(html).toContain("no ad networks");
  });
  it("offers the change-your-mind path on the page itself", () => {
    expect(html).toContain("changeable right here");
    expect(html).toContain("changing your mind is one tap");
  });
});
