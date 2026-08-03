/**
 * @vitest-environment happy-dom
 *
 * #304 — taking the work away as a file.
 *
 * ET-3 is the one to read twice. The Mine tab filters by assignee and the
 * export cannot, so a control promising "what you see" would hand over the
 * whole workspace's jobs to somebody who asked for their own. The label names
 * the actual contents in every tab, which leaves no claim to break.
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
  useExportTasks: () => ({ isPending: false, mutateAsync: requestExport }),
}));
vi.mock("@/lib/company/provider", () => ({
  useActiveCompany: () => ({ role: role.current }),
  useCompanyId: () => "company-1",
}));
vi.mock("sonner", () => ({
  toast: { success: toastSuccess, error: toastError },
}));

import {
  EXPORT_TASKS_NOTE,
  ExportTasks,
  exportTasksLabel,
  stateForTab,
} from "./export-tasks";
import { ApiError } from "@/lib/api/error";

afterEach(cleanup);

beforeEach(() => {
  role.current = "owner";
  requestExport.mockReset();
  requestExport.mockResolvedValue({ export_id: "e1", already_building: false });
  toastSuccess.mockReset();
  toastError.mockReset();
});

describe("#304 exporting the work", () => {
  it("ET-1: is absent for somebody who cannot take customer data out", () => {
    // A task list looks like internal admin and is not: every task names a
    // customer and quotes what they asked for.
    for (const who of ["member", "read_only"]) {
      role.current = who;
      const { container } = render(<ExportTasks tab="open" />);
      expect(container.innerHTML, who).toBe("");
      cleanup();
    }
  });

  it("ET-2: the tab it was opened from is what gets exported", () => {
    // No second filter UI. The page already says which state somebody wants,
    // and asking again beside a control that answers it is the duplicate-state
    // bug users experience as "which one wins?".
    expect(stateForTab("open")).toBe("open");
    expect(stateForTab("done")).toBe("done");
  });

  it("ET-3: Mine does NOT claim to export only mine", () => {
    // THE ONE THAT MATTERS. There is no assignee filter on the export, so both
    // Mine and All send no state and receive everybody's work. The label has
    // to say so before the click, not the file after it.
    expect(stateForTab("mine")).toBeUndefined();
    expect(stateForTab("all")).toBeUndefined();
    expect(exportTasksLabel("mine")).toBe("Export all work");
    expect(exportTasksLabel("mine")).not.toMatch(/mine|my|your/i);

    role.current = "owner";
    render(<ExportTasks tab="mine" />);
    expect(screen.getByTitle(EXPORT_TASKS_NOTE).textContent).toContain("all work");
  });

  it("ET-4: says it covers the whole workspace", () => {
    render(<ExportTasks tab="mine" />);
    expect(screen.getByTitle(EXPORT_TASKS_NOTE)).toBeTruthy();
    expect(EXPORT_TASKS_NOTE).toMatch(/whole workspace, not/);
  });

  it("ET-5: the label matches what the file will hold", () => {
    expect(exportTasksLabel("open")).toBe("Export outstanding work");
    expect(exportTasksLabel("done")).toBe("Export finished work");
    expect(exportTasksLabel("all")).toBe("Export all work");
  });

  it("ET-6: sends the state the tab means", async () => {
    render(<ExportTasks tab="done" />);
    fireEvent.click(screen.getByText("Export finished work"));

    await waitFor(() => expect(requestExport).toHaveBeenCalledTimes(1));
    expect(requestExport).toHaveBeenCalledWith({ state: "done" });
  });

  it("ET-7: sends no state from All, rather than a made-up one", async () => {
    render(<ExportTasks tab="all" />);
    fireEvent.click(screen.getByText("Export all work"));

    await waitFor(() => expect(requestExport).toHaveBeenCalledTimes(1));
    expect(requestExport).toHaveBeenCalledWith({ state: undefined });
  });

  it("ET-8: says where to collect it", async () => {
    // It is asynchronous, and it lands somewhere other than this page.
    render(<ExportTasks tab="open" />);
    fireEvent.click(screen.getByText("Export outstanding work"));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledTimes(1));
    expect(toastSuccess.mock.calls[0][0]).toContain("Data export");
  });

  it("ET-9: shows the server's reason when it refuses", async () => {
    requestExport.mockRejectedValue(
      new ApiError("rate_limited", "One is already being built.", 429),
    );
    render(<ExportTasks tab="open" />);
    fireEvent.click(screen.getByText("Export outstanding work"));

    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    expect(toastError.mock.calls[0][0]).toContain("already being built");
  });
});
