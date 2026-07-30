import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The cookies page mounts the consent preferences control (#124), which reads
// publicEnv. Mock the env module (hoisted above the page imports) so the
// suite runs without the required NEXT_PUBLIC_* build vars; GTM stays unset,
// matching every non-production build.
vi.mock("@/env", () => ({ publicEnv: { NEXT_PUBLIC_GTM_ID: undefined } }));

import AupPage, { metadata as aupMetadata } from "./aup/page";
import CookiesPage, { metadata as cookiesMetadata } from "./cookies/page";
import DeleteMyDataPage, {
  metadata as deleteMyDataMetadata,
} from "./delete-my-data/page";
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
import { DELETION_GAPS, DELETION_GRACE_DAYS } from "@loonext/shared";

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
  {
    name: "delete-my-data",
    html: renderToStaticMarkup(<DeleteMyDataPage />),
    meta: deleteMyDataMetadata,
  },
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

  it("discloses the carrier's own daily ceiling (#351)", () => {
    // Every tenant is registered on a 10DLC use case whose throughput the
    // CARRIERS enforce. A growing crew could hit it on their busiest day with
    // nothing to distinguish a registration-tier ceiling from a bug or an
    // outage — the one gate this product could not name. It is not our limit,
    // which is exactly why it has to be said out loud rather than inferred
    // from our own allowances.
    // The apostrophe renders as &#x27; in static markup, so match around it.
    expect(html).toContain("daily limit");
    expect(html).toContain("2,000 messages a day");
    // And the path up, because discovering the ceiling is only half the
    // problem: the other half is that moving past it takes days.
    expect(html).toContain("fresh carrier registration");
  });

  it("says outright that only sent texts count (#353)", () => {
    // The one question #353 asked, on the page D34 makes canonical for it.
    // Every other surface already said this; §2 described the allowance
    // without ever naming the direction, while §7 named it for photos and for
    // voice minutes. A customer comparing the three could reasonably conclude
    // texts were the exception.
    //
    // D5 is the decision: "only outbound segments count against the quota".
    // Enforced by the `usage_event_type` enum having no inbound member, so a
    // received text is structurally unrecordable as usage.
    expect(html).toContain("Only the texts you send count");
    expect(html).toContain("Receiving is free and unlimited");
  });
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

/**
 * #227 — the public deletion URL. Google Play's Data Safety form requires a
 * web-accessible deletion URL for any app with accounts, reachable without
 * signing in. The path is filed with Google, so renaming it silently breaks a
 * store declaration; these pin the path and the promises the page makes.
 */
describe("delete-my-data — the store-facing deletion page", () => {
  const page = PAGES.find((entry) => entry.name === "delete-my-data")!;

  it("lives at the stable path Google has on file", () => {
    // If this fails, the Data Safety declaration is now pointing at a 404.
    expect(page.meta.alternates?.canonical).toContain("/legal/delete-my-data");
  });

  it("names where the controls actually are, in each app", () => {
    expect(page.html).toContain("Settings");
    expect(page.html).toContain("Delete your account");
    expect(page.html).toContain("Close this workspace");
  });

  it("states what outlives deletion instead of implying total erasure", () => {
    // The two things D48 keeps. A deletion page that implies everything goes
    // is making a promise the law does not let us keep.
    expect(page.html).toContain("STOP");
    expect(page.html).toContain("three years");
    expect(page.html).toMatch(/30 days/);
  });

  it("tells a texted customer to reply STOP rather than routing them to us", () => {
    // They are not our user; the business controls their data, and the fastest
    // remedy is in their own hands.
    expect(page.html).toContain("reply");
  });
});

describe("#357 — the deletion page is bound to the facts, not to prose", () => {
  const page = PAGES.find((entry) => entry.name === "delete-my-data")!;

  it("states the boundary from the shared constant", () => {
    // #357: "A published page must not imply either is handled." The gap text
    // lives in packages/shared so the page, the emails and #285's questionnaire
    // answers cannot drift into three different promises — D48's own
    // requirement, applied to the surface where a mismatch reads as dishonesty
    // rather than staleness.
    for (const gap of DELETION_GAPS) {
      // A distinctive fragment: the rendered HTML escapes apostrophes, so the
      // whole sentence would never match literally.
      const fragment = gap.split(",")[0];
      expect(page.html, `missing boundary: ${fragment}`).toContain(fragment);
    }
  });

  it("quotes the same reversible window everything else does", () => {
    expect(page.html).toContain(`${DELETION_GRACE_DAYS} days`);
  });

  it("still says what survives AND why", () => {
    // The reasoning is the selling point. "We keep your STOP list forever"
    // alarms when stripped of it and reassures when carrying it, so a tidy-up
    // that shortened this section would remove the thing that makes it work.
    expect(page.html).toMatch(/do-not-text/i);
    expect(page.html).toMatch(/belongs to the person who sent it/i);
    expect(page.html).toMatch(/three years/i);
  });
});
