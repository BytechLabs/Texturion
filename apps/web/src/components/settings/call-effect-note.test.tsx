/**
 * @vitest-environment happy-dom
 *
 * #725: a setting that ends or redirects calls says how many it touched.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { counts, role, enabledSeen } = vi.hoisted(() => ({
  counts: { current: {} as Record<string, number> },
  role: { current: "owner" },
  enabledSeen: { current: [] as boolean[] },
}));

vi.mock("@/lib/api/calls", () => ({
  useCallEffects: (enabled: boolean) => {
    enabledSeen.current.push(enabled);
    return { data: enabled ? { days: 30, counts: counts.current } : undefined };
  },
}));
vi.mock("@/lib/company/provider", () => ({
  useActiveCompany: () => ({ role: role.current }),
}));

import { CallEffectNote } from "./call-effect-note";

afterEach(cleanup);
beforeEach(() => {
  counts.current = {};
  role.current = "owner";
  enabledSeen.current = [];
});

describe("#725 CallEffectNote", () => {
  it("says how many calls a reason touched and links to them", () => {
    counts.current = { after_hours: 12 };
    render(<CallEffectNote reason="after_hours" />);
    expect(screen.getByText(/touched 12 calls in the last 30 days/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "See them" }).getAttribute("href")).toBe(
      "/calls?reason=after_hours",
    );
  });

  it("is silent when the setting touched nothing", () => {
    const { container } = render(<CallEffectNote reason="blocked" />);
    expect(container.innerHTML).toBe("");
  });

  it("never asks for counts on behalf of a role that cannot see every number", () => {
    role.current = "member";
    counts.current = { after_hours: 3 };
    const { container } = render(<CallEffectNote reason="after_hours" />);
    expect(enabledSeen.current.every((enabled) => !enabled)).toBe(true);
    expect(container.innerHTML).toBe("");
  });
});
