/**
 * @vitest-environment happy-dom
 *
 * #291 — the workspace's own fields on a contact.
 *
 * CW-4 is the one worth reading twice. The API stores what it is sent, so a
 * PATCH carrying only the field that changed would empty every other one. That
 * failure is invisible at the moment it happens: the field you edited saves
 * correctly and the others go blank on the next load.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ContactCustomFields } from "./custom-fields";
import type { ContactDetail } from "@/lib/api/types";

const patched = vi.fn();
const fieldDefs = vi.fn();

vi.mock("@/lib/company/provider", () => ({
  useCompanyId: () => "company-1",
  useActiveCompany: () => ({ role: "owner" }),
}));

vi.mock("@/lib/api/client", () => ({
  apiFetch: (path: string, init?: { method?: string; body?: unknown }) => {
    if (path === "/v1/contact-fields") return Promise.resolve(fieldDefs());
    if (init?.method === "PATCH") {
      patched(init.body);
      return Promise.resolve({ id: "c1" });
    }
    return Promise.resolve({});
  },
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

function contact(custom: Record<string, string> = {}): ContactDetail {
  return {
    id: "c1",
    phone_e164: "+14165550199",
    name: "Jo Smith",
    address: null,
    notes: null,
    custom_fields: custom,
    consent_source: null,
    consent_at: null,
    consent_attested_by: null,
    first_identification_sent_at: null,
    deleted_at: null,
    created_at: "2026-08-01T09:00:00Z",
    updated_at: "2026-08-01T09:00:00Z",
    opted_out: false,
    opt_out_source: null,
  } as unknown as ContactDetail;
}

function renderFields(custom: Record<string, string> = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ContactCustomFields contact={contact(custom)} />
    </QueryClientProvider>,
  );
}

// This repo has no global setup file, so nothing unmounts between tests.
// Without it the second render finds two "Boiler model" labels — the leftover
// one from the first — and every query by label throws.
afterEach(cleanup);

beforeEach(() => {
  patched.mockClear();
  fieldDefs.mockReturnValue({
    cap: 10,
    data: [
      { key: "boiler_model", label: "Boiler model", kind: "text", options: null },
      { key: "warranty", label: "Warranty expiry", kind: "date", options: null },
    ],
  });
});

describe("ContactCustomFields", () => {
  it("CW-1: renders nothing at all until the workspace defines a field", async () => {
    // Not an empty "Custom fields" heading on every contact forever, for a
    // feature most workspaces will never turn on.
    fieldDefs.mockReturnValue({ cap: 10, data: [] });
    const { container } = renderFields();
    await waitFor(() => expect(container.innerHTML).toBe(""));
  });

  it("CW-2: shows every defined field, answered or not", async () => {
    // The unanswered ones are the point — an empty "Warranty expiry" is the
    // prompt to go and find out.
    renderFields({ boiler_model: "Worcester 8000" });
    const model = (await screen.findByLabelText("Boiler model")) as HTMLInputElement;
    expect(model.value).toBe("Worcester 8000");
    const warranty = (await screen.findByLabelText(
      "Warranty expiry",
    )) as HTMLInputElement;
    expect(warranty.value).toBe("");
  });

  it("CW-3: refuses a bad value, names the field, and keeps what was typed", async () => {
    // Length, not "next Tuesday in a date field" — the input types already
    // stop that one, and an `<input type="date">` simply refuses to hold the
    // phrase, so a test written that way asserts the browser rather than us.
    // The cap is the rule only this check enforces, and only the server
    // otherwise catches.
    renderFields();
    const input = await screen.findByLabelText("Boiler model");
    fireEvent.change(input, { target: { value: "x".repeat(201) } });
    fireEvent.blur(input);

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Boiler model",
    );
    // Still there. Reverting to the last good value would throw away the
    // correction somebody just made.
    expect((input as HTMLInputElement).value).toBe("x".repeat(201));
    expect(patched).not.toHaveBeenCalled();
  });

  it("CW-4: sends the WHOLE set, not just the field that changed", async () => {
    // THE SILENT ONE. The API stores what it is given. A partial PATCH saves
    // the edited field correctly and blanks the rest on the next load.
    renderFields({ boiler_model: "Worcester 8000" });
    const input = await screen.findByLabelText("Warranty expiry");
    fireEvent.change(input, { target: { value: "2027-03-01" } });
    fireEvent.blur(input);

    await waitFor(() => expect(patched).toHaveBeenCalledTimes(1));
    expect(patched.mock.calls[0][0]).toEqual({
      custom_fields: {
        boiler_model: "Worcester 8000",
        warranty: "2027-03-01",
      },
    });
  });

  it("CW-5: an unchanged field does not write", async () => {
    // Blur fires on every tab-through. A PATCH per focus change would be a
    // write storm against a row the whole crew has open.
    renderFields({ boiler_model: "Worcester 8000" });
    const input = await screen.findByLabelText("Boiler model");
    fireEvent.blur(input);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(patched).not.toHaveBeenCalled();
  });

  it("CW-6: a dropdown can be set back to nothing", async () => {
    // "We asked and there is no answer" has to stay reachable — a select whose
    // only options are real values traps the first mis-click forever.
    fieldDefs.mockReturnValue({
      cap: 10,
      data: [
        {
          key: "system_type",
          label: "System type",
          kind: "select",
          options: ["Combi", "System"],
        },
      ],
    });
    renderFields({ system_type: "Combi" });
    const select = (await screen.findByLabelText(
      "System type",
    )) as HTMLSelectElement;
    // The OPTION has to exist, not just the write path. Setting a select's
    // value to "" succeeds even when no such option is rendered, so asserting
    // only the resulting PATCH passes on a dropdown nobody can actually clear.
    expect([...select.options].map((option) => option.value)).toContain("");
    fireEvent.change(select, { target: { value: "" } });
    await waitFor(() => expect(patched).toHaveBeenCalledTimes(1));
    expect(patched.mock.calls[0][0]).toEqual({ custom_fields: { system_type: "" } });
  });

  it("CW-7: a yes/no field distinguishes 'no' from 'never asked'", async () => {
    fieldDefs.mockReturnValue({
      cap: 10,
      data: [{ key: "has_dog", label: "Dog on site", kind: "checkbox", options: null }],
    });
    renderFields();
    expect((await screen.findByText("Not asked")).textContent).toBe("Not asked");

    fireEvent.click(screen.getByLabelText("Dog on site"));
    await waitFor(() => expect(patched).toHaveBeenCalledTimes(1));
    expect(patched.mock.calls[0][0]).toEqual({ custom_fields: { has_dog: "yes" } });
  });
});
