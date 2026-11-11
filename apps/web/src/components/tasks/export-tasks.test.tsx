/**
 * @vitest-environment happy-dom
 *
 * #745 — the Export button downloads the current view at once.
 *
 * It used to queue a regulatory data export. What matters now: one click, the
 * view's own filters go to the download, nothing is queued, and a toast appears
 * only when it fails.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { download, toastSuccess, toastError, role } = vi.hoisted(() => ({
  download: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  role: { current: "owner" as string },
}));

vi.mock("@/lib/api/tasks-export-hook", () => ({
  useExportTasks: () => ({ isPending: false, mutateAsync: download }),
}));
vi.mock("@/lib/company/provider", () => ({
  useActiveCompany: () => ({ role: role.current }),
  useCompanyId: () => "company-1",
}));
vi.mock("sonner", () => ({
  toast: { success: toastSuccess, error: toastError },
}));

import { ApiError } from "@/lib/api/error";

import { ExportTasks } from "./export-tasks";

afterEach(cleanup);

beforeEach(() => {
  role.current = "owner";
  download.mockReset();
  download.mockResolvedValue({ filename: "tasks.csv" });
  toastSuccess.mockReset();
  toastError.mockReset();
});

describe("#745 exporting the tasks in view", () => {
  it("ET-1: is absent for somebody who cannot take customer data out", () => {
    for (const who of ["member", "read_only"]) {
      role.current = who;
      const { container } = render(<ExportTasks filters={{}} />);
      expect(container.innerHTML, who).toBe("");
      cleanup();
    }
  });

  it("ET-2: one click downloads with the filters of the current view", async () => {
    const filters = { status: "open" as const, assigned_user_id: "me", priority: ["high" as const] };
    render(<ExportTasks filters={filters} />);
    fireEvent.click(screen.getByText("Export this list"));

    await waitFor(() => expect(download).toHaveBeenCalledTimes(1));
    expect(download).toHaveBeenCalledWith(filters);
  });

  it("ET-3: a download that works says nothing", async () => {
    render(<ExportTasks filters={{}} />);
    fireEvent.click(screen.getByText("Export this list"));

    await waitFor(() => expect(download).toHaveBeenCalledTimes(1));
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });

  it("ET-4: shows the server's reason when it refuses", async () => {
    download.mockRejectedValue(new ApiError("forbidden", "Not allowed.", 403));
    render(<ExportTasks filters={{}} />);
    fireEvent.click(screen.getByText("Export this list"));

    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    expect(toastError.mock.calls[0][0]).toContain("Not allowed");
  });

  it("ET-5: a failure with no reason still tells them it failed", async () => {
    download.mockRejectedValue(new Error("network"));
    render(<ExportTasks filters={{}} />);
    fireEvent.click(screen.getByText("Export this list"));

    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    expect(toastError.mock.calls[0][0]).toContain("could not be downloaded");
  });

  it("ET-6: says it covers this view, not the workspace's data export", () => {
    render(<ExportTasks filters={{}} />);
    const note = screen.getByTitle(/tasks in this view/);
    expect(note.getAttribute("title")).not.toMatch(/background|Settings/);
  });
});
