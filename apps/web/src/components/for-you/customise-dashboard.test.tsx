/**
 * @vitest-environment happy-dom
 */
/**
 * #540 — the Customise panel.
 *
 * The switches themselves are Radix; what is worth asserting is the product
 * decisions layered on top. Opened for real rather than rendered to a string,
 * because the two things most worth checking — that toggling sends the WHOLE set
 * and that no queue section is on offer — are only observable once it is open.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// This app's vitest does not set `globals`, so testing-library's automatic
// cleanup never registers and renders stack across tests.
afterEach(cleanup);

const state: { hidden: string[]; isError: boolean } = {
  hidden: [],
  isError: false,
};
const mutate = vi.fn();

vi.mock("@/lib/api/me-company", () => ({
  useHiddenPanels: () => state.hidden,
  useSetHiddenPanels: () => ({ mutate, isError: state.isError }),
}));

import {
  DASHBOARD_PANEL_IDS,
  DASHBOARD_PANEL_LABELS,
  DASHBOARD_TILE_LABELS,
} from "@loonext/shared";

import { makeTranslate, type MessageKey, sayEnglish } from "@/i18n/provider";

import { CustomiseDashboard } from "./customise-dashboard";

/*
 * #228 — the shared panel table names catalogue KEYS, so a test looking for the
 * words on the screen resolves them the way the panel itself does. Reading the
 * table as if it still held headings is how this file failed: every query went
 * looking for "domain.panelPipeline".
 */
const say = sayEnglish;


beforeEach(() => {
  state.hidden = [];
  state.isError = false;
  mutate.mockClear();
});

/** Render and open the panel, the way a member reaches it. */
function open() {
  render(<CustomiseDashboard />);
  fireEvent.click(screen.getByRole("button", { name: /Customise this screen/ }));
}

describe("CustomiseDashboard (#540)", () => {
  it("is one quiet control until it is opened", () => {
    // Applying: Zen of Clarity — a secondary action collapsed behind one
    // affordance. Five switches beside the work would compete with the work.
    render(<CustomiseDashboard />);
    expect(
      screen.getByRole("button", { name: /Customise this screen/ }),
    ).toBeTruthy();
    expect(screen.queryByText(say(DASHBOARD_PANEL_LABELS.pipeline))).toBeNull();
  });

  it("lists every panel, each with the reason it exists", () => {
    open();
    for (const id of DASHBOARD_PANEL_IDS) {
      expect(screen.getByText(say(DASHBOARD_PANEL_LABELS[id]))).toBeTruthy();
    }
    // A switch with only a name is a guess for anybody who has not already read
    // both cards it might refer to.
    expect(screen.getByText(/Which channels are actually bringing work in/)).toBeTruthy();
  });

  it("shows a panel as ON when it is not hidden, and OFF when it is", () => {
    // The switch reads "is this on my screen", not "is this hidden" — a control
    // whose sense is inverted from its label is the classic settings bug.
    state.hidden = ["pipeline"];
    open();
    const pipeline = screen.getByRole("switch", {
      name: say(DASHBOARD_PANEL_LABELS.pipeline),
    });
    const satisfaction = screen.getByRole("switch", {
      name: say(DASHBOARD_PANEL_LABELS.satisfaction),
    });
    expect(pipeline.getAttribute("aria-checked")).toBe("false");
    expect(satisfaction.getAttribute("aria-checked")).toBe("true");
  });

  it("sends the WHOLE set when something is switched off", () => {
    // PUT, not PATCH: the body describes the screen they want. A delta against a
    // state two clients disagree about merges into a layout neither asked for.
    state.hidden = ["pipeline"];
    open();
    fireEvent.click(
      screen.getByRole("switch", { name: say(DASHBOARD_PANEL_LABELS.recent_calls) }),
    );
    expect(mutate).toHaveBeenCalledWith(["pipeline", "recent_calls"]);
  });

  it("sends the set without the panel when something is switched back on", () => {
    state.hidden = ["pipeline", "recent_calls"];
    open();
    fireEvent.click(
      screen.getByRole("switch", { name: say(DASHBOARD_PANEL_LABELS.pipeline) }),
    );
    expect(mutate).toHaveBeenCalledWith(["recent_calls"]);
  });

  it("has no Save button — the screen behind it is the feedback", () => {
    open();
    expect(screen.queryByRole("button", { name: /save/i })).toBeNull();
  });

  it("says it went back when a save fails, rather than that it is pending", () => {
    // The toggle is optimistic, so by the time this appears the panel has
    // already moved. "Saving…" would be a lie and "Failed" would not say what
    // state the screen is now in.
    state.isError = true;
    open();
    expect(screen.getByText(/back the way it was/)).toBeTruthy();
  });

  it("marks the trigger when panels are put away", () => {
    render(<CustomiseDashboard />);
    expect(
      screen.queryByRole("button", { name: /put away/ }),
    ).toBeNull();
    cleanup();

    state.hidden = ["pipeline"];
    render(<CustomiseDashboard />);
    expect(screen.getByRole("button", { name: /1 panel put away/ })).toBeTruthy();
    cleanup();

    state.hidden = ["pipeline", "recent_calls"];
    render(<CustomiseDashboard />);
    expect(
      screen.getByRole("button", { name: /2 panels put away/ }),
    ).toBeTruthy();
  });
});

describe("what CustomiseDashboard refuses to offer (#540)", () => {
  it("never lists a queue section", () => {
    // THE LINE. The queue is the work; hiding "Unassigned" is a way to stop
    // seeing leads nobody has claimed. Asserted against the tile labels rather
    // than a hand-written list, so a new queue section cannot end up on this
    // panel by accident later.
    open();
    // #228: the tile table holds catalogue KEYS now, so this says them
    // first. Left querying the key it would look for a switch named
    // "inbox.forYouSectionUnassigned", find nothing, and pass forever — a
    // guard about the ONE thing this panel must never offer, reporting clean
    // because it was asking the wrong question.
    for (const key of Object.values(DASHBOARD_TILE_LABELS)) {
      expect(screen.queryByRole("switch", { name: say(key) })).toBeNull();
    }
    expect(screen.getAllByRole("switch")).toHaveLength(
      DASHBOARD_PANEL_IDS.length,
    );
  });

  it("says so on the panel rather than leaving somebody hunting for a switch", () => {
    open();
    expect(screen.getByText(/The queue always stays/)).toBeTruthy();
  });
});

describe("the switch is named after the card it controls (#540)", () => {
  /**
   * THIS IS THE ONE THAT ALREADY CAUGHT SOMETHING.
   *
   * The panel first said "Where customers came from" while the card on the screen
   * behind it said "Where YOUR customers come from". Nothing failed: the ids
   * matched, all three clients agreed with each other, and both parity tests were
   * green — because they compared the ports to the shared module rather than
   * comparing the label to the thing it names. It took a screenshot with the panel
   * open over the card to see it.
   *
   * A switch whose label is not the heading is a switch you have to guess about,
   * so the label is checked against the CARD's own source rather than against
   * another copy of itself.
   */
  /**
   * The HEADING, not the source. Matching anywhere in the file is what makes a
   * guard like this decorative: "Pipeline" appears in `pipeline-card.tsx` as
   * `export function PipelineCard()`, so a substring check would have waved
   * through a switch labelled after a symbol nobody can see on the screen. Only
   * the text inside the card's heading element counts.
   */
  /**
   * The four measures share `MeasureCard` now, so the `<h2>` this used to read
   * lives in the shell and the card declares its heading as the `title` prop.
   * Anchoring on that prop keeps the property this guard has always been about
   * — the words come from the CARD's own source, not from a second copy of the
   * label maintained beside it — and is if anything tighter than matching an
   * element: `title=` is the thing that becomes the heading, whereas an `<h2>`
   * merely usually was.
   */
  const TITLE_PROP = /<MeasureCard[\s\S]*?title=\{t\("inbox\.[A-Za-z]+"\)\}/;
  const CARDS: Record<string, { file: string; heading: RegExp }> = {
    response_time: {
      file: "src/components/for-you/response-time-card.tsx",
      heading: TITLE_PROP,
    },
    pipeline: {
      file: "src/components/for-you/pipeline-card.tsx",
      heading: TITLE_PROP,
    },
    satisfaction: {
      file: "src/components/for-you/satisfaction-card.tsx",
      heading: TITLE_PROP,
    },
    lead_sources: {
      file: "src/components/for-you/lead-sources-card.tsx",
      heading: TITLE_PROP,
    },
    // Recent calls is a `Section`, whose heading comes from its label prop.
    // Anchored to the section's own component rather than to "the first
    // `<Section>` in the file": that file holds several, and which one comes
    // first is an accident of editing order, not a fact this guard should rest
    // on.
    recent_calls: {
      file: "src/components/for-you/for-you-view.tsx",
      heading: /function RecentCallsSection[\s\S]*?<Section label=\{t\("inbox\.[A-Za-z]+"\)\}/,
    },
  };

  /**
   * The words inside a heading, whatever is wrapped around them.
   *
   * Two of these cards put their 7/30/90 window picker INSIDE the `<h2>`, so the
   * heading's first child is an element rather than text. Stripping tags is what
   * makes this read the heading a person sees rather than the markup it is made
   * of — the first attempt matched only text directly after `<h2>` and reported
   * the heading as a single space.
   */
  function headingText(block: string): string {
    return block
      .replace(/<[^>]*>/g, " ")
      .replace(/\{[\s\S]*?\}/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  /**
   * #228: the heading is a catalogue lookup now, so the words are read the way
   * the card reads them — the KEY is taken from the card's own heading and
   * resolved through the catalogue.
   *
   * Deliberately not a list of expected keys here. The failure this whole block
   * exists for is a heading and a switch drifting apart, and a roster of keys
   * maintained beside them is a third copy that can drift from both. Taking the
   * key out of the card keeps the card as the source, exactly as reading its
   * literal did before.
   */
  function headingWords(block: string): string {
    const key = block.match(/\bt\("(inbox\.[A-Za-z]+)"\)/)?.[1];
    if (key) return makeTranslate("en")(key as MessageKey);
    return headingText(block);
  }

  for (const [id, { file, heading }] of Object.entries(CARDS)) {
    it(`${id} is called what its card is called`, async () => {
      const { readFileSync } = await import("node:fs");
      const block = readFileSync(file, "utf8").match(heading)?.[0];
      // A card whose heading this cannot find is a guard that has stopped
      // guarding, so that fails rather than passing vacuously.
      expect(block, `no heading found in ${file}`).toBeTruthy();
      const text = headingWords(block!);
      // And the lookup actually resolved: an unnamed key comes back AS the key,
      // which would then fail the prefix check below for the wrong reason.
      expect(text, `${id}'s heading did not resolve to words`).not.toMatch(
        /^inbox\./,
      );
      const label = say(
        DASHBOARD_PANEL_LABELS[id as keyof typeof DASHBOARD_PANEL_LABELS],
      );
      // A prefix, case-insensitively: the heading may carry a window the switch
      // does not need to repeat ("Quotes" for "Quotes, last 30 days").
      expect(
        text.toLowerCase().startsWith(label.toLowerCase()),
        `the Customise switch says "${label}" but the card's heading is "${text}"`,
      ).toBe(true);
    });
  }
});
