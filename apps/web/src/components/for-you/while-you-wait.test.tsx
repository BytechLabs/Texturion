import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * #310 — the waiting-room card.
 *
 * Two properties matter more than the layout. It must appear ONLY while the
 * carriers genuinely have it — showing it to a workspace we are waiting on
 * would point away from the thing actually blocking them, and showing it after
 * approval turns a temporary aid into permanent furniture. And it must never
 * read as a spinner, which is the failure the whole issue is about.
 */

let registration: unknown = null;

vi.mock("@/lib/api/me-company", () => ({
  useMeCompany: () => ({ data: { company: { registration } } }),
}));

const { WhileYouWait } = await import("./while-you-wait");

const markup = () => renderToStaticMarkup(<WhileYouWait />);
const snap = (brand: string | null, campaign: string | null) => ({
  brand: brand ? { status: brand } : null,
  campaign: campaign ? { status: campaign } : null,
});

describe("WhileYouWait", () => {
  it("renders nothing once texting is live", () => {
    // The card is a temporary aid. Left up, it becomes furniture nobody reads.
    registration = snap("approved", "approved");
    expect(markup()).toBe("");
  });

  it("renders nothing when WE are waiting on THEM", () => {
    // A workspace that has not submitted details is not in the waiting room —
    // it is the thing being waited on, and a list of optional setup work would
    // point away from what is blocking it.
    registration = snap(null, null);
    expect(markup()).toBe("");
    registration = snap("rejected", null);
    expect(markup()).toBe("");
  });

  it("renders nothing before the company view has loaded", () => {
    registration = null;
    expect(markup()).toBe("");
  });

  it("shows the stage, an honest range, and what happens next", () => {
    registration = snap("approved", "pending");
    const html = markup();

    expect(html).toContain("Under review by the carriers");
    expect(html).toContain("3–7");
    // Says "sometimes longer" because it sometimes is. An estimate that
    // quietly expires teaches somebody not to believe the next one.
    expect(html).toContain("sometimes longer");
    expect(html).toContain("the moment it clears");
  });

  it("never starts the bar at zero", () => {
    // A bar sitting at 0% for four days IS the spinner this replaces.
    registration = snap("submitted", null);
    const html = markup();
    expect(html).toContain('role="progressbar"');
    expect(html).not.toContain('aria-valuenow="0"');
  });

  it("leads with what already works, not as a footnote", () => {
    // Calling, voicemail and inbound are live from day one. A workspace that
    // spends the wait taking calls has already adopted the product.
    registration = snap("approved", "pending");
    const html = markup();

    expect(html).toContain("Calls already work");
    expect(html).toContain("None of that waits on the carriers");
    // It appears before the setup list, which is what "leads with" means.
    expect(html.indexOf("Calls already work")).toBeLessThan(
      html.indexOf("Bring your customers in"),
    );
  });

  it("offers three next steps, not the whole settings surface", () => {
    registration = snap("approved", "pending");
    const html = markup();
    for (const label of [
      "Bring your customers in",
      "Invite your crew",
      "Set your hours and greeting",
    ]) {
      expect(html).toContain(label);
    }
    // Chunking: the brain holds 3–4 items, and a settings tour is not a sense
    // of arriving somewhere.
    expect((html.match(/<li>/g) ?? []).length).toBe(3);
  });

  it("never shows the state machine's vocabulary", () => {
    // "brand approved / campaign pending" is true and means nothing to a
    // plumber.
    registration = snap("approved", "pending");
    const html = markup().toLowerCase();
    expect(html).not.toContain("10dlc");
    expect(html).not.toContain("campaign");
  });
});
