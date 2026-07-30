import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  EMERGENCY_KEYWORDS,
  EMERGENCY_SAFETY_LINE,
  emergencyReplyBody,
} from "@loonext/shared";
import type { CompanyView } from "@/lib/api/types";

/**
 * #460 — the founder's complaint was that the product assumes a trade. The
 * fixes that had to reach a screen are the two an owner can see: which words
 * count, and what goes back.
 *
 * Everything asserted here is a property that would be silently wrong rather
 * than visibly broken, which is why they are worth pinning:
 *
 *   - an owner who never opened this screen sees the words REALLY being matched,
 *     not an empty box (Smart Defaults; an empty box reads as "nothing is
 *     watched for", the opposite of the truth)
 *   - the safety line is in the preview whatever the owner wrote, because that
 *     is the one sentence they cannot remove and the only way they learn it is
 *     by seeing it
 *   - the card survives a response from an API that predates #460
 */

const mutate = vi.fn();
vi.mock("@/lib/api/companies", () => ({
  useUpdateCompany: () => ({ isPending: false, mutate }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { EmergencyCard } from "./emergency-card";

function companyWith(overrides: Partial<CompanyView>): CompanyView {
  return {
    name: "Ace Locksmith",
    emergency_keyword_enabled: true,
    emergency_keywords: null,
    emergency_message: null,
    emergency_effective_keywords: [...EMERGENCY_KEYWORDS],
    emergency_effective_message: emergencyReplyBody(null),
    emergency_message_is_custom: false,
    emergency_keywords_are_custom: false,
    ...overrides,
  } as unknown as CompanyView;
}

const render = (company: CompanyView, canEdit = true) =>
  renderToStaticMarkup(<EmergencyCard company={company} canEdit={canEdit} />);

describe("EmergencyCard — #460", () => {
  it("shows the words really being matched, not an empty box", () => {
    // The default state for every workspace that has never opened this screen.
    const html = render(companyWith({}));
    for (const word of EMERGENCY_KEYWORDS) {
      expect(html).toContain(word);
    }
    expect(html).toContain("These are the defaults");
  });

  it("shows the owner's own words once they have set them", () => {
    const html = render(
      companyWith({
        emergency_keywords: ["LOCKEDOUT"],
        emergency_effective_keywords: ["LOCKEDOUT"],
        emergency_keywords_are_custom: true,
      }),
    );
    expect(html).toContain("LOCKEDOUT");
    // The "these are the defaults" aside is gone — it would be false now, and a
    // screen that keeps saying "default" after you changed it reads as a failed
    // save.
    expect(html).not.toContain("These are the defaults");
  });

  it("puts the safety line in the preview, whatever the owner wrote", () => {
    // The whole reason the preview exists. An owner editing the body has to see
    // that one sentence follows it, or they will believe they removed it and
    // find out from a customer.
    const html = render(
      companyWith({
        emergency_message: "On our way when we can.",
        emergency_effective_message: emergencyReplyBody("On our way when we can."),
        emergency_message_is_custom: true,
      }),
    );
    expect(html).toContain(EMERGENCY_SAFETY_LINE);
    expect(html).toContain("can&#x27;t be edited");
  });

  it("names no trade in the default reply", () => {
    // The founder's actual complaint, asserted on the surface that shows it.
    const html = render(companyWith({}));
    for (const trade of ["smell gas", "utility", "no-heat", "burst-pipe"]) {
      expect(html).not.toContain(trade);
    }
  });

  it("survives a response from an API that predates this feature", () => {
    // An older server sends none of the derived fields. Reading `.length` off
    // `undefined` took the whole settings page down before this was guarded,
    // which is a worse bug than the copy this feature replaces.
    const stale = {
      name: "Ace Locksmith",
      emergency_keyword_enabled: true,
    } as unknown as CompanyView;
    const html = render(stale);
    expect(html).toContain(EMERGENCY_SAFETY_LINE);
    // Falls back to the product list rather than rendering nothing.
    expect(html).toContain("URGENT");
    expect(html).not.toContain("undefined");
  });

  it("hides the editing affordances from a member", () => {
    const html = render(companyWith({}), false);
    expect(html).not.toContain("Save emergency settings");
    expect(html).not.toContain("Remove URGENT");
    // But they can still READ what the workspace does, which is the point of
    // showing the card at all.
    expect(html).toContain("URGENT");
  });
});
