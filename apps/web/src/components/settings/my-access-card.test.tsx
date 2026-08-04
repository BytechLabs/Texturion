/**
 * @vitest-environment happy-dom
 *
 * #286 — what a member cannot reach, and why.
 *
 * MA-1 is the one this card exists for. A member used to be told a COUNT and
 * "ask an owner if you need them" — and that last sentence is the cost #286 is
 * about: a new tech who cannot tell a deliberate restriction from a broken app
 * resolves it by interrupting somebody, one number at a time, and the owner
 * has to work out which of three rules they configured months ago produced it.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { rowsRef } = vi.hoisted(() => ({ rowsRef: { current: [] as unknown[] } }));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: { numbers: rowsRef.current } }),
}));
vi.mock("@/lib/api/client", () => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/company/provider", () => ({ useCompanyId: () => "c-1" }));

import { MyAccessCard } from "./my-access-card";

afterEach(cleanup);
beforeEach(() => {
  rowsRef.current = [];
});

function row(
  level: "text" | "note" | "none",
  decidedBy: string,
  e164: string,
  principal: string | null = null,
) {
  return {
    phone_number_id: `${e164}-id`,
    number_e164: e164,
    level,
    decided_by: decidedBy,
    principal,
  };
}

describe("#286 what you can reach", () => {
  it("MA-1: it names the number and the rule, not a count", () => {
    // THE ONE THAT MATTERS. "2 more numbers are not shared with you" leaves a
    // tech no way to tell deliberate from broken; "A rule for members" closes
    // the question without anybody being interrupted.
    rowsRef.current = [
      row("text", "unruled", "+12125559200"),
      row("none", "role", "+12125559201", "member"),
    ];
    render(<MyAccessCard />);
    expect(screen.getByText(/9201/)).toBeTruthy();
    expect(screen.getByText("A rule for members")).toBeTruthy();
    expect(screen.getByText("Hidden")).toBeTruthy();
  });

  it("MA-2: the note says it is deliberate, because that is the whole doubt", () => {
    rowsRef.current = [row("none", "no-match", "+12125559201")];
    render(<MyAccessCard />);
    expect(screen.getByRole("status").textContent).toMatch(/deliberate/i);
    expect(screen.getByRole("status").textContent).toMatch(/not the app failing/i);
  });

  it("MA-3: a member who reaches everything sees nothing at all", () => {
    // The pair. Every owner and admin, and most members, land here — and a
    // panel reassuring somebody about a problem they do not have is furniture.
    rowsRef.current = [
      row("text", "unruled", "+12125559200"),
      row("text", "role-override", "+12125559201", "owner"),
    ];
    const { container } = render(<MyAccessCard />);
    expect(container.textContent).toBe("");
  });

  it("MA-4: only the restricted rows are listed", () => {
    // The numbers they CAN use are the cards above this one; repeating them
    // would make this a second copy of that list rather than an answer.
    rowsRef.current = [
      row("text", "unruled", "+12125559200"),
      row("note", "all", "+12125559201"),
    ];
    render(<MyAccessCard />);
    expect(screen.getByText("Read and notes only")).toBeTruthy();
    expect(screen.queryByText(/9200/)).toBeNull();
  });

  it("MA-5: the reason is written for the person reading it", () => {
    // The same seven clauses #348 wrote for the owner's screen, read by the
    // person they are about — never a second wording of one security rule.
    rowsRef.current = [row("none", "no-match", "+12125559201")];
    render(<MyAccessCard />);
    expect(
      screen.getByText("This number has rules, and none of them include you"),
    ).toBeTruthy();
  });
});
