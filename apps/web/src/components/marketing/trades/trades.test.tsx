import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MERGE_FIELD_TOKENS } from "@loonext/shared";

import CleanersPage from "@/app/(marketing)/for/cleaners/page";
import ContractorsPage from "@/app/(marketing)/for/contractors/page";
import HvacPage from "@/app/(marketing)/for/hvac/page";
import LandscapersPage from "@/app/(marketing)/for/landscapers/page";
import PlumbersPage from "@/app/(marketing)/for/plumbers/page";
import SalonsPage from "@/app/(marketing)/for/salons/page";
import { DEMO_CHIP_LABELS } from "@/components/marketing/fr";
import {
  PRIMARY_CTA_LABEL,
  SECONDARY_CTA_LABEL,
  SIGNUP_HREF,
} from "@/components/marketing/nav-links";

import {
  CLEANERS_SCRIPT,
  CONTRACTORS_SCRIPT,
  HVAC_SCRIPT,
  LANDSCAPERS_SCRIPT,
  PLUMBERS_SCRIPT,
  SALONS_SCRIPT,
  type TradeScript,
} from "./scripts";
import { SavedRepliesPicker } from "./saved-replies-picker";
import { THREAD_CAPTION } from "./trade-page";
import { TradeThread } from "./trade-thread";

/**
 * v4 "FIRST RESPONSE" trade-page guards (DESIGN-DIRECTION v4 §6 TRADE,
 * COPY-DECK v2 §/for/*, V4 coverage map): the six pages share a skeleton and
 * zero sentences; every page stages its own worst minute; the demos obey
 * Laws 1, 2, 6, and 11; and the billing facts render on every page.
 */

/** React's static-markup escaping, so deck strings compare verbatim. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

interface PageUnderTest {
  name: string;
  html: string;
  /** Coverage-map dateline, verbatim. */
  dateline: string;
  /** COPY-DECK v2 H1, verbatim. */
  h1: string;
  script: TradeScript;
}

const PAGES: PageUnderTest[] = [
  {
    name: "plumbers",
    html: renderToStaticMarkup(<PlumbersPage />),
    dateline: "9:04 PM · BASEMENT DRAIN",
    h1: "The text inbox for plumbing crews.",
    script: PLUMBERS_SCRIPT,
  },
  {
    name: "hvac",
    html: renderToStaticMarkup(<HvacPage />),
    dateline: "6:48 AM · NO HEAT",
    h1: "The text inbox for HVAC crews.",
    script: HVAC_SCRIPT,
  },
  {
    name: "landscapers",
    html: renderToStaticMarkup(<LandscapersPage />),
    dateline: "7:15 AM · GATE LOCKED",
    h1: "The text inbox for landscaping crews.",
    script: LANDSCAPERS_SCRIPT,
  },
  {
    name: "cleaners",
    html: renderToStaticMarkup(<CleanersPage />),
    dateline: "5:56 PM · KEY UNDER MAT?",
    h1: "The text inbox for cleaning crews.",
    script: CLEANERS_SCRIPT,
  },
  {
    name: "salons",
    html: renderToStaticMarkup(<SalonsPage />),
    dateline: "11:20 AM · RUNNING LATE",
    h1: "The text inbox for your front desk, even if you don't have one.",
    script: SALONS_SCRIPT,
  },
  {
    name: "contractors",
    html: renderToStaticMarkup(<ContractorsPage />),
    dateline: "8:02 AM · CHANGE ORDER",
    h1: "The text inbox for contracting crews.",
    script: CONTRACTORS_SCRIPT,
  },
];

describe("coverage map + deck copy (each trade's own worst minute)", () => {
  it.each(PAGES)("$name opens with its dateline and deck H1", (page) => {
    expect(page.html).toContain(esc(page.dateline));
    expect(page.html).toContain(esc(page.h1));
  });

  it("datelines and H1s are unique across the six pages (not templated)", () => {
    expect(new Set(PAGES.map((p) => p.dateline)).size).toBe(6);
    expect(new Set(PAGES.map((p) => p.h1)).size).toBe(6);
  });

  it("each page's scripted thread stages the dateline's exact minute", () => {
    for (const page of PAGES) {
      const minute = page.dateline.split(" · ")[0]; // e.g. "9:04 PM"
      const times = page.script.beats.flatMap((b) =>
        "time" in b ? [b.time] : [],
      );
      expect(times, `${page.name}: script misses ${minute}`).toContain(minute);
    }
  });

  it("script contacts and crews differ per trade (no find-and-replace pages)", () => {
    const contacts = PAGES.map((p) => p.script.contact.name);
    const numbers = PAGES.map((p) => p.script.contact.number);
    const assignees = PAGES.map((p) => p.script.assignee);
    expect(new Set(contacts).size).toBe(6);
    expect(new Set(numbers).size).toBe(6);
    expect(new Set(assignees).size).toBe(6);
  });
});

describe("Law 1: the only content label is the EXAMPLE CONVERSATION chip", () => {
  it.each(PAGES)("$name carries the chip and zero artifact talk", (page) => {
    expect(page.html).toContain(DEMO_CHIP_LABELS["example-conversation"]);
    // Trade pages use EXAMPLE CONVERSATION, never SCRIPTED DEMO.
    expect(page.html).not.toContain(DEMO_CHIP_LABELS["scripted-demo"]);
    // Purge sweep (V4-REDO-PLAN): the site never describes itself.
    expect(page.html).not.toMatch(
      /real interface|not a screenshot|stock photo|fake review|set in |built with next/i,
    );
    // The deck's thread caption, verbatim (purge item 5's replacement).
    expect(page.html).toContain(esc(THREAD_CAPTION));
  });

  it.each(PAGES)("$name aria-labels describe content, never the artifact", (page) => {
    const labels = [...page.html.matchAll(/aria-label="([^"]*)"/g)].map(
      (m) => m[1],
    );
    for (const label of labels) {
      expect(label).not.toMatch(/demo|interface|screenshot|scripted/i);
    }
  });
});

describe("Law 6: no em- or en-dashes anywhere in the rendered pages", () => {
  it.each(PAGES)("$name is dash-free", (page) => {
    expect(page.html).not.toContain("—"); // em
    expect(page.html).not.toContain("–"); // en
  });
});

describe("Law 2 + QA gate 4: app tokens inside the frames, cobalt outside", () => {
  it.each(PAGES)("$name wraps both product embeds in .app-scope", (page) => {
    expect(page.html.match(/app-scope/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("the thread depiction references no marketing --fr-* token", () => {
    for (const page of PAGES) {
      const html = renderToStaticMarkup(<TradeThread script={page.script} />);
      expect(html, `${page.name} thread leaks marketing tokens`).not.toContain(
        "--fr-",
      );
      expect(html).not.toContain("2740DE"); // cobalt never inside the frame
    }
  });

  it("the saved-replies picker depiction references no marketing --fr-* token", () => {
    const html = renderToStaticMarkup(
      <SavedRepliesPicker
        replies={[{ name: "On my way", text: "On my way." }]}
      />,
    );
    expect(html).not.toContain("--fr-");
    expect(html).not.toContain("2740DE");
  });
});

describe("Law 11: no fake liveness, no rasters, no added tab stops", () => {
  it.each(PAGES)("$name has no pulsing/live ornaments and no <img>", (page) => {
    expect(page.html).not.toMatch(/animate-(pulse|ping|spin|bounce)/);
    expect(page.html).not.toMatch(/\bonline\b|\btyping\b/i);
    expect(page.html).not.toContain("<img");
  });

  it("the demos add zero tab stops (no buttons/inputs inside the embeds)", () => {
    for (const page of PAGES) {
      const thread = renderToStaticMarkup(<TradeThread script={page.script} />);
      expect(thread).not.toMatch(/<(button|input|textarea|select|a) /);
    }
  });
});

describe("factual claims (Law 7): the billing truths render on every page", () => {
  it.each(PAGES)("$name carries the standard Truth Strip facts", (page) => {
    // Receiving is free on every plan; the US registration arithmetic.
    expect(page.html).toContain(
      "Receiving texts and photos: free, unlimited, on every plan.",
    );
    expect(page.html).toContain(
      "US shops: a one-time $29 to register with the phone companies. $58 the first month, then $29 after.",
    );
    // The pricing snippet figure and the deck's pricing link line.
    expect(page.html).toContain("$29");
    expect(page.html).toContain("$79");
    expect(page.html).toContain("500");
    expect(page.html).toContain(
      "See full pricing. Every cost is on that page.",
    );
  });

  it.each(PAGES)("$name uses the deck CTA labels and real hrefs", (page) => {
    expect(page.html).toContain(PRIMARY_CTA_LABEL);
    expect(page.html).toContain(SECONDARY_CTA_LABEL);
    expect(page.html).toContain(`href="${SIGNUP_HREF}"`);
    expect(page.html).toContain('href="/pricing"');
  });
});

describe("saved replies: real product semantics only", () => {
  it("every {token} in a depicted template is a REAL merge field", () => {
    // The product's merge-field substitution DROPS unknown {tokens} at send
    // time (packages/shared/src/merge-fields.ts), so depicting made-up
    // variables like {day} would show templates that break in the product.
    const supported = new Set<string>(MERGE_FIELD_TOKENS);
    for (const page of PAGES) {
      const bodies = [...page.html.matchAll(/\{([a-z_][a-z0-9_]*)\}/gi)];
      for (const m of bodies) {
        expect(
          supported.has(m[1]),
          `${page.name}: template variable {${m[1]}} is not a product merge field`,
        ).toBe(true);
      }
    }
  });

  it("each page depicts exactly six saved replies in the picker", () => {
    for (const page of PAGES) {
      // The picker's <ul> rows are the only list items on a trade page.
      const rows = (page.html.match(/<li/g) ?? []).length;
      expect(rows, `${page.name} depicts ${rows} replies, not 6`).toBe(6);
      expect(page.html).toContain("Saved replies");
    }
  });
});

describe("contractors: the D14 done state is depicted faithfully", () => {
  it("marks the change request done with strike + Done badge", () => {
    const html = renderToStaticMarkup(
      <TradeThread script={CONTRACTORS_SCRIPT} />,
    );
    expect(html).toContain("line-through");
    expect(html).toContain("Done");
    expect(CONTRACTORS_SCRIPT.doneIds).toContain("co-in-1");
  });
});
