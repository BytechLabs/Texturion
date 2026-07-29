import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * #314 — the owner's workspace-wide switch.
 *
 * The grace window is the entire safety of this control, so these pin that a
 * crew inside it is told they are fine, that the deadline is promised not to
 * move, and that "immediately" is labelled as the lockout it is.
 */

vi.mock("@/lib/api/mfa", () => ({
  useSetWorkspaceMfa: () => ({ isPending: false, mutate: vi.fn() }),
}));

vi.mock("@/lib/company/provider", () => ({
  useCompanyId: () => "c-1",
  useActiveCompany: () => ({ companyId: "c-1", role: "owner" }),
}));

import { RequireTwoFactorCard } from "./require-two-factor-card";

const future = new Date(Date.now() + 7 * 86_400_000).toISOString();
const past = new Date(Date.now() - 86_400_000).toISOString();

describe("RequireTwoFactorCard", () => {
  it("says why it matters when nothing is required yet", () => {
    const html = renderToStaticMarkup(
      <RequireTwoFactorCard required={false} graceUntil={null} />,
    );
    expect(html).toContain("Not required");
    expect(html).toContain("stolen password");
  });

  it("tells a crew inside the grace window that they keep working", () => {
    const html = renderToStaticMarkup(
      <RequireTwoFactorCard required graceUntil={future} />,
    );
    expect(html).toContain("grace period running");
    // The reassurance is the point: enforcement that starts the instant
    // somebody toggles a setting is how this becomes an outage mid-shift.
    expect(html).toContain("everyone keeps working as normal");
  });

  it("promises the deadline will not move, because an owner repeats it to their crew", () => {
    const html = renderToStaticMarkup(
      <RequireTwoFactorCard required graceUntil={future} />,
    );
    expect(html).toContain("won&#x27;t move it");
  });

  it("says plainly when it is actually in force", () => {
    const html = renderToStaticMarkup(
      <RequireTwoFactorCard required graceUntil={past} />,
    );
    expect(html).toContain("in force now");
    // And no stale promise about a deadline that has already passed.
    expect(html).not.toContain("grace period running");
  });
});
