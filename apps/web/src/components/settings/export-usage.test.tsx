/**
 * @vitest-environment happy-dom
 *
 * #304 — pulling a period's usage from the screen that shows it.
 *
 * EU-2 is the one to read twice. This control is gated on `billing.manage`
 * rather than `contacts.bulk`, and the difference is not pedantry: the
 * bookkeeper preset (#315) holds the former and not the latter, and gating it
 * the other way would hide the feature from the only person it was built for
 * while leaving it visible to people who will never use it.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { requestExport, toastSuccess, toastError, role } = vi.hoisted(() => ({
  requestExport: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  role: { current: "owner" as string },
}));

vi.mock("@/lib/api/exports", () => ({
  useExportUsage: () => ({ isPending: false, mutateAsync: requestExport }),
}));
vi.mock("@/lib/company/provider", () => ({
  useActiveCompany: () => ({ role: role.current }),
  useCompanyId: () => "company-1",
}));
vi.mock("sonner", () => ({
  toast: { success: toastSuccess, error: toastError },
}));

import {
  EXPORT_USAGE_ACTION,
  EXPORT_USAGE_NOTE,
  lastCompleteMonth,
} from "@loonext/shared";

import { sayEnglish } from "@/i18n/provider";

/**
 * #228 — the shared module names catalogue KEYS now, so a test looking for the
 * words on the screen resolves them the way the card does.
 */
const say = sayEnglish;

import { ExportUsage } from "./export-usage";
import { ApiError } from "@/lib/api/error";

afterEach(cleanup);

beforeEach(() => {
  role.current = "owner";
  requestExport.mockReset();
  requestExport.mockResolvedValue({ export_id: "e1", already_building: false });
  toastSuccess.mockReset();
  toastError.mockReset();
});

describe("#304 exporting a period's usage", () => {
  it("EU-1: is absent for somebody who does not handle billing", () => {
    // Absent, not disabled. A greyed control advertises a capability somebody
    // has decided this person should not have.
    for (const who of ["member", "read_only"]) {
      role.current = who;
      const { container } = render(<ExportUsage />);
      expect(container.innerHTML, who).toBe("");
      cleanup();
    }
  });

  it("EU-2: the BOOKKEEPER can reach it", () => {
    // The person this exists for. `bookkeeper` is not on the owner ⊃ admin ⊃
    // member line at all, so any rank comparison — and `contacts.bulk`, which
    // they do not hold — would hide it from them.
    role.current = "bookkeeper";
    render(<ExportUsage />);
    expect(screen.getByText(say(EXPORT_USAGE_ACTION))).toBeTruthy();
  });

  it("EU-3: opens with last month filled in, not empty", () => {
    // The API requires a start. An empty pair would be a form that cannot be
    // submitted until somebody works out what to type.
    render(<ExportUsage />);
    fireEvent.click(screen.getByText(say(EXPORT_USAGE_ACTION)));

    const from = screen.getByLabelText("From") as HTMLInputElement;
    const to = screen.getByLabelText("To") as HTMLInputElement;
    expect(from.value).not.toBe("");
    expect(to.value).not.toBe("");
    const today = new Date();
    expect(from.value).toBe(
      lastCompleteMonth(today.getFullYear(), today.getMonth() + 1).from,
    );
  });

  it("EU-4: last month means the last COMPLETE one, including its last day", () => {
    // A period still accruing produces a file out of date before it finishes
    // building. And a month that ends on the 30th must end on the 30th.
    //
    // The rule moved to `@loonext/shared` for #595, because two phones now need
    // the same default and a period that differs by client is worse than none.
    // Its own suite and `packages/shared/vectors/last-complete-month.json` carry
    // the boundaries; what is left here is that THIS CARD asks for the month it
    // is actually in, which is the part a shared test cannot see.
    expect(lastCompleteMonth(2026, 7)).toEqual({
      from: "2026-06-01",
      to: "2026-06-30",
    });
    // January reaches back across the year boundary.
    expect(lastCompleteMonth(2026, 1)).toEqual({
      from: "2025-12-01",
      to: "2025-12-31",
    });
  });

  it("EU-5: says it is not the invoice, before the click", () => {
    // The caveat belongs where the decision is made. Discovering it inside the
    // file, after waiting for an email, is where disappointment lives.
    render(<ExportUsage />);
    fireEvent.click(screen.getByText(say(EXPORT_USAGE_ACTION)));
    const note = screen.getByText(say(EXPORT_USAGE_NOTE));
    expect(note.textContent).toMatch(/not a copy of your Stripe invoice/);
    expect(note.textContent).toMatch(/nothing on it is priced/);
  });

  it("EU-6: the last day of the period is INCLUDED", async () => {
    // A month typed as ending on the 30th means the 30th. Sending the start of
    // that day drops it, and the file comes back a day short with nothing to
    // say it had.
    render(<ExportUsage />);
    fireEvent.click(screen.getByText(say(EXPORT_USAGE_ACTION)));
    fireEvent.change(screen.getByLabelText("To"), {
      target: { value: "2026-06-30" },
    });
    fireEvent.click(screen.getByText("Start it"));

    await waitFor(() => expect(requestExport).toHaveBeenCalledTimes(1));
    const sent = requestExport.mock.calls[0][0] as { from: string; to: string };
    expect(new Date(sent.to).getHours()).toBe(23);
    expect(new Date(sent.from).getHours()).toBe(0);
  });

  it("EU-7: says where to collect it", async () => {
    // It is asynchronous. "Done" with no destination is somebody refreshing a
    // page the file will never appear on.
    render(<ExportUsage />);
    fireEvent.click(screen.getByText(say(EXPORT_USAGE_ACTION)));
    fireEvent.click(screen.getByText("Start it"));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledTimes(1));
    expect(toastSuccess.mock.calls[0][0]).toContain("Data export");
  });

  it("EU-8: shows the server's reason when it refuses", async () => {
    requestExport.mockRejectedValue(
      new ApiError("validation_failed", "The end of the period is before its start.", 422),
    );
    render(<ExportUsage />);
    fireEvent.click(screen.getByText(say(EXPORT_USAGE_ACTION)));
    fireEvent.click(screen.getByText("Start it"));

    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    expect(toastError.mock.calls[0][0]).toContain("before its start");
  });
});
