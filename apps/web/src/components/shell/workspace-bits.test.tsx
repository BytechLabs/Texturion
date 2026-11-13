import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PhoneNumberSummary } from "@/lib/api/types";

/**
 * The sidebar and the account sheet show the workspace's number from the
 * company view the shell already holds. While that is still loading the strip
 * is a skeleton line: "Setting up your number…" flashed on every hard load
 * for workspaces whose number has been live for months.
 */
const state: {
  pending: boolean;
  numbers: Partial<PhoneNumberSummary>[];
} = { pending: false, numbers: [] };

vi.mock("@/lib/api/me-company", () => ({
  useMeCompany: () =>
    state.pending
      ? { isPending: true, data: undefined }
      : { isPending: false, data: { company: { numbers: state.numbers } } },
}));

import { WorkspaceNumbers } from "./workspace-bits";

beforeEach(() => {
  state.pending = false;
  state.numbers = [];
});

describe("WorkspaceNumbers", () => {
  it("is a skeleton line while the company view loads, never the setting-up note", () => {
    state.pending = true;
    const html = renderToStaticMarkup(<WorkspaceNumbers />);
    expect(html).toContain('data-slot="skeleton"');
    expect(html).not.toContain("Setting up your number");
  });

  it("shows the live number from the company view", () => {
    state.numbers = [
      { id: "n1", status: "active", number_e164: "+14165550100" },
    ];
    const html = renderToStaticMarkup(<WorkspaceNumbers />);
    expect(html).toContain("Copy (416) 555-0100");
    expect(html).not.toContain('data-slot="skeleton"');
  });

  it("says a number is being set up only once the view says so", () => {
    state.numbers = [{ id: "n1", status: "provisioning", number_e164: null }];
    expect(renderToStaticMarkup(<WorkspaceNumbers />)).toContain(
      "Setting up your number",
    );
  });

  it("sends a stuck provision to choose another number", () => {
    state.numbers = [
      {
        id: "n1",
        status: "provision_failed",
        number_e164: null,
        failure_reason: "no_inventory",
      },
    ];
    expect(renderToStaticMarkup(<WorkspaceNumbers />)).toContain(
      'href="/settings/numbers"',
    );
  });
});
