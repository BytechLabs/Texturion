/**
 * @vitest-environment happy-dom
 *
 * #301 — "how did you hear about us?", as one tap.
 *
 * LP-2 is the one that decides whether this earns its place on the panel.
 * When the LINE already attributed the conversation there is nothing to ask,
 * and asking anyway is how a crew learns to ignore this control — which costs
 * more than the answers it would have collected. The whole value of
 * per-number attribution is that nobody has to do anything.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { updateMutate, sourceRows } = vi.hoisted(() => ({
  updateMutate: vi.fn(),
  sourceRows: { current: [] as Record<string, unknown>[] },
}));

vi.mock("@/lib/api/conversations", () => ({
  useUpdateConversation: () => ({ isPending: false, mutate: updateMutate }),
}));
vi.mock("@/lib/api/lead-sources", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/api/lead-sources")>(
      "@/lib/api/lead-sources",
    );
  return {
    ...actual,
    useLeadSources: () => ({ data: { data: sourceRows.current } }),
  };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { LeadSourcePicker } from "./lead-source-picker";

const TRUCK = "s-truck";
const NEIGHBOUR = "s-neighbour";

afterEach(cleanup);
beforeEach(() => {
  updateMutate.mockReset();
  sourceRows.current = [
    { id: TRUCK, name: "Truck", archived_at: null },
    { id: NEIGHBOUR, name: "Neighbour", archived_at: null },
  ];
});

function conversation(over: Record<string, unknown> = {}) {
  return {
    id: "c1",
    lead_source_id: null,
    lead_source_origin: null,
    ...over,
  } as never;
}

describe("#301 how did you hear about us", () => {
  it("LP-1: an unattributed thread asks, in chips", () => {
    // Chips and not a dropdown: if it is not one tap it will not happen, and
    // a source field empty 80% of the time is a misleading report.
    render(<LeadSourcePicker conversation={conversation()} />);
    expect(screen.getByText(/how did you hear about us/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Truck" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Neighbour" })).toBeTruthy();
  });

  it("LP-2: a thread the LINE attributed is told, not asked", () => {
    // THE ONE THAT MATTERS. Asking a question we already know the answer to
    // is how a crew learns to dismiss this control.
    render(
      <LeadSourcePicker
        conversation={conversation({
          lead_source_id: TRUCK,
          lead_source_origin: "number",
        })}
      />,
    );
    expect(screen.queryByText(/how did you hear about us/i)).toBeNull();
    expect(screen.getByText(/the line they called/i)).toBeTruthy();
  });

  it("LP-3: a person's answer reads as a person's answer", () => {
    // "The truck rang" and "a tech says a neighbour sent them" are different
    // kinds of claim, and the panel has to be able to say which this is.
    render(
      <LeadSourcePicker
        conversation={conversation({
          lead_source_id: NEIGHBOUR,
          lead_source_origin: "manual",
        })}
      />,
    );
    expect(screen.getByText(/somebody said so/i)).toBeTruthy();
    expect(screen.queryByText(/the line they called/i)).toBeNull();
  });

  it("LP-4: one tap sends the source, and never anything else", () => {
    render(<LeadSourcePicker conversation={conversation()} />);
    fireEvent.click(screen.getByRole("button", { name: "Neighbour" }));
    expect(updateMutate).toHaveBeenCalledWith(
      { lead_source_id: NEIGHBOUR },
      expect.anything(),
    );
  });

  it("LP-5: there is always a way back to not knowing", () => {
    // A tech who picked the wrong chip must be able to say "actually I don't
    // know" — and clearing means UNKNOWN, never a silent fall back to the
    // line's own source, which would dress a guess up as a fact again.
    render(
      <LeadSourcePicker
        conversation={conversation({
          lead_source_id: NEIGHBOUR,
          lead_source_origin: "manual",
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /don't know/i }));
    expect(updateMutate).toHaveBeenCalledWith(
      { lead_source_id: null },
      expect.anything(),
    );
  });

  it("LP-5b: re-tapping the chosen chip clears it too", () => {
    // The fastest way back from a mistap is the control you just used.
    render(
      <LeadSourcePicker
        conversation={conversation({
          lead_source_id: TRUCK,
          lead_source_origin: "manual",
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Truck" }));
    expect(updateMutate).toHaveBeenCalledWith(
      { lead_source_id: null },
      expect.anything(),
    );
  });

  it("LP-6: no vocabulary means no prompt at all", () => {
    // A question with no answers on offer is worse than silence.
    sourceRows.current = [];
    const { container } = render(
      <LeadSourcePicker conversation={conversation()} />,
    );
    expect(container.textContent).toBe("");
  });

  it("LP-7: an archived source still names the thread it attributed", () => {
    // The whole reason archiving exists instead of deleting: this
    // conversation genuinely came from the yard sign, even after it came down.
    sourceRows.current = [
      { id: TRUCK, name: "Truck", archived_at: null },
      { id: "s-old", name: "Yard sign", archived_at: "2026-08-01T00:00:00Z" },
    ];
    render(
      <LeadSourcePicker
        conversation={conversation({
          lead_source_id: "s-old",
          lead_source_origin: "manual",
        })}
      />,
    );
    expect(screen.getByText(/Yard sign/)).toBeTruthy();
    // But it is not offered as a chip — the list has to be able to shrink.
    expect(screen.queryByRole("button", { name: "Yard sign" })).toBeNull();
  });
});
