/**
 * @vitest-environment happy-dom
 *
 * LandingGate records the role it resolved, for CompanyProvider to read on the
 * next launch, and overwrites a hint that has gone stale.
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MemberRole } from "@/lib/api/types";

const { active, replace } = vi.hoisted(() => ({
  active: { role: "member" as MemberRole },
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/for-you",
  useRouter: () => ({ replace }),
}));
vi.mock("@/lib/company/provider", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/company/provider")>()),
  useActiveCompany: () => ({
    role: active.role,
    userId: "user-1",
    companyId: "company-1",
  }),
}));

import { LandingGate } from "./landing-gate";

const HINT = "loonext:landing-role:user-1:company-1";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  replace.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("LandingGate landing hint", () => {
  it("remembers the resolved role for this user and workspace", () => {
    active.role = "member";
    render(<LandingGate />);
    expect(localStorage.getItem(HINT)).toBe("member");
  });

  it("rewrites a stale hint with the real role", () => {
    localStorage.setItem(HINT, "member");
    active.role = "owner";
    render(<LandingGate />);
    expect(localStorage.getItem(HINT)).toBe("owner");
    expect(replace).not.toHaveBeenCalled();
  });
});
