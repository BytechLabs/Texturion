/**
 * @vitest-environment happy-dom
 *
 * #304 — asking for one customer's history from their record.
 *
 * EH-1 is the one to read twice. Taking a permanent copy of somebody's
 * correspondence out of the product is the act #231 calls the
 * departing-employee signature, and the control has to be absent — not
 * disabled — for anybody who cannot do it. A disabled button tells a member
 * the feature exists and that somebody decided they may not have it, which is
 * a conversation nobody asked this screen to start.
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
  useExportContactHistory: () => ({
    isPending: false,
    mutateAsync: requestExport,
  }),
}));
vi.mock("@/lib/company/provider", () => ({
  useActiveCompany: () => ({ role: role.current }),
  useCompanyId: () => "company-1",
}));
vi.mock("sonner", () => ({
  toast: { success: toastSuccess, error: toastError },
}));

import { ExportHistory } from "./export-history";
// #228: these sentences moved out of the component and into the catalogue.
// Read through it rather than re-typed here, so a reworded export note still
// has exactly one source and this test cannot drift from what ships.
import { contactsEn } from "@/i18n/sections/contacts";

const EXPORT_HISTORY_ACTION = contactsEn.exportHistoryAction;
const EXPORT_HISTORY_NOTE = contactsEn.exportHistoryNote;
import { ApiError } from "@/lib/api/error";

afterEach(cleanup);

beforeEach(() => {
  role.current = "owner";
  requestExport.mockReset();
  requestExport.mockResolvedValue({ export_id: "e1", already_building: false });
  toastSuccess.mockReset();
  toastError.mockReset();
});

describe("#304 exporting one customer's history", () => {
  it("EH-1: is absent for somebody who cannot take data out", () => {
    // Absent, not disabled. `read_only` and `member` do not hold
    // `contacts.bulk`, and a greyed control would advertise a capability
    // somebody has decided they should not have.
    for (const who of ["member", "read_only"]) {
      role.current = who;
      const { container } = render(<ExportHistory contactId="c1" />);
      expect(container.innerHTML, who).toBe("");
      cleanup();
    }
  });

  it("EH-2: asks the capability, not the rank", () => {
    // #315: a rank is not a permission model. `bookkeeper` is not on the
    // owner ⊃ admin ⊃ member line and does not do bulk customer data, so the
    // control is absent for them — which a rank comparison would get wrong in
    // whichever direction it was written.
    role.current = "bookkeeper";
    const { container } = render(<ExportHistory contactId="c1" />);
    expect(container.innerHTML).toBe("");
  });

  it("EH-3: says the dates are optional, and what happens after", () => {
    // Both are surprises otherwise, and being told afterwards that the owner
    // was emailed is the kind that makes somebody feel watched rather than
    // protected.
    render(<ExportHistory contactId="c1" />);
    fireEvent.click(screen.getByText(EXPORT_HISTORY_ACTION));
    const note = screen.getByText(EXPORT_HISTORY_NOTE);
    expect(note.textContent).toContain("whole history");
    expect(note.textContent).toContain("owner is told");
  });

  it("EH-4: sends no range when the dates are empty", () => {
    // The API's contract: absent means everything. Sending an empty string
    // would be a date the server has to reject.
    render(<ExportHistory contactId="c1" />);
    fireEvent.click(screen.getByText(EXPORT_HISTORY_ACTION));
    fireEvent.click(screen.getByText("Start it"));
    expect(requestExport).toHaveBeenCalledWith({ from: undefined, to: undefined });
  });

  it("EH-5: the last day of a range is INCLUDED", async () => {
    // Somebody who types "the 1st to the 31st" means the 31st. Sending the
    // start of the 31st would drop that whole day, and the export would come
    // back a day short with nothing to say it had.
    render(<ExportHistory contactId="c1" />);
    fireEvent.click(screen.getByText(EXPORT_HISTORY_ACTION));
    fireEvent.change(screen.getByLabelText("To"), {
      target: { value: "2026-07-31" },
    });
    fireEvent.click(screen.getByText("Start it"));

    await waitFor(() => expect(requestExport).toHaveBeenCalledTimes(1));
    const sent = requestExport.mock.calls[0][0] as { to: string };
    expect(new Date(sent.to).getHours()).toBe(23);
  });

  it("EH-6: says where to collect it, not merely that it worked", async () => {
    // It is asynchronous. "Done" with no destination is a person refreshing
    // this page waiting for something that will never appear on it.
    render(<ExportHistory contactId="c1" />);
    fireEvent.click(screen.getByText(EXPORT_HISTORY_ACTION));
    fireEvent.click(screen.getByText("Start it"));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledTimes(1));
    expect(toastSuccess.mock.calls[0][0]).toContain("Data export");
  });

  it("EH-7: shows the server's reason when it refuses", async () => {
    requestExport.mockRejectedValue(
      new ApiError("validation_failed", "The end of the period is before its start.", 422),
    );
    render(<ExportHistory contactId="c1" />);
    fireEvent.click(screen.getByText(EXPORT_HISTORY_ACTION));
    fireEvent.click(screen.getByText("Start it"));

    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    expect(toastError.mock.calls[0][0]).toContain("before its start");
  });
});
