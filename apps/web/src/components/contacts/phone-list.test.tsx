/**
 * @vitest-environment happy-dom
 *
 * #291 — the other numbers a customer answers.
 *
 * PL-4 is the one worth reading twice. The server refuses a number another
 * customer already has, and its refusal NAMES them, because taking it would
 * silently redirect that customer's texts and calls onto this record. A client
 * that swallowed the reason and said "couldn't add that" would send somebody
 * looking for a fault that is really a collision.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `vi.mock` is hoisted above every `const` in this file, so the spies have to
// be created inside `vi.hoisted` — a plain `const` above the mock is still a
// temporal-dead-zone reference by the time the factory runs.
const { addPhone, removePhone, toastError } = vi.hoisted(() => ({
  addPhone: vi.fn(),
  removePhone: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/lib/api/contacts", () => ({
  useAddContactPhone: () => ({ isPending: false, mutateAsync: addPhone }),
  useRemoveContactPhone: () => ({ isPending: false, mutate: removePhone }),
}));

vi.mock("sonner", () => ({
  toast: { error: toastError, success: vi.fn() },
}));

import { PhoneList, PHONE_ADD_LABEL, PHONE_MATCH_NOTE } from "./phone-list";
import { ApiError } from "@/lib/api/error";
import type { ContactDetail } from "@/lib/api/types";

function contact(phones: ContactDetail["phones"]): ContactDetail {
  return { id: "c1", phones } as ContactDetail;
}

afterEach(cleanup);

beforeEach(() => {
  addPhone.mockReset();
  addPhone.mockResolvedValue({ data: { id: "p1" } });
  removePhone.mockReset();
  toastError.mockReset();
});

describe("#291 the other numbers", () => {
  it("PL-1: stays out of the way when there is nothing to say", () => {
    // Nearly every customer has one line, which the header already shows. An
    // empty "other numbers" list on every record would be a permanent question
    // mark to serve the household with two people in it.
    const html = renderToStaticMarkup(<PhoneList contact={contact([])} />);

    expect(html).toContain(PHONE_ADD_LABEL);
    // No list chrome at all — not merely no rows. An empty record shows one
    // link, not an empty list.
    expect(html).not.toContain("<ul");
  });

  it("PL-2: shows each number with its label", () => {
    const html = renderToStaticMarkup(
      <PhoneList
        contact={contact([
          {
            id: "p1",
            phone_e164: "+14165550177",
            label: "Landline",
            created_at: "2026-08-01T09:00:00Z",
          },
        ])}
      />,
    );
    expect(html).toContain("+14165550177");
    expect(html).toContain("Landline");
  });

  it("PL-3: says what adding one DOES, before it is added", () => {
    // This is not a notes field. A number recorded here is matched against
    // every inbound text and call, so the crew is told that where they are
    // deciding — otherwise the first time anyone learns it is when a message
    // arrives under a name they did not expect.
    render(<PhoneList contact={contact([])} />);
    expect(screen.queryByText(PHONE_MATCH_NOTE)).toBeNull();

    fireEvent.click(screen.getByText(PHONE_ADD_LABEL));
    expect(screen.getByText(PHONE_MATCH_NOTE).textContent).toContain(
      "under this customer",
    );
  });

  it("PL-4: shows the server's reason, which names who has the number", async () => {
    // THE ONE THAT MATTERS. Only the server knows whose number it already is.
    // "Couldn't add that number" would send somebody looking for a fault.
    addPhone.mockRejectedValue(
      new ApiError(
        "validation_failed",
        "Sam Rivera already has that number. Merge the two records instead.",
        422,
      ),
    );
    render(<PhoneList contact={contact([])} />);
    fireEvent.click(screen.getByText(PHONE_ADD_LABEL));
    fireEvent.change(screen.getByLabelText("Number"), {
      target: { value: "+14165550188" },
    });
    fireEvent.click(screen.getByText("Add"));

    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    expect(toastError.mock.calls[0][0]).toContain("Sam Rivera");
  });

  it("PL-5: sends the label as null rather than an empty string", async () => {
    // An unlabelled number is unlabelled. An empty string would render as a
    // stray separator before the number on every client.
    render(<PhoneList contact={contact([])} />);
    fireEvent.click(screen.getByText(PHONE_ADD_LABEL));
    fireEvent.change(screen.getByLabelText("Number"), {
      target: { value: "+14165550199" },
    });
    fireEvent.click(screen.getByText("Add"));

    await waitFor(() => expect(addPhone).toHaveBeenCalledTimes(1));
    expect(addPhone.mock.calls[0][0]).toEqual({
      phone_e164: "+14165550199",
      label: null,
    });
  });

  it("PL-6: Add stays disabled until there is a number to add", async () => {
    // Asserted on the DISABLED STATE, not on the early return inside submit.
    // Written the other way first, this test passed with that return deleted —
    // the button is disabled, so the click never reaches it and the guard is
    // unreachable through the UI. What protects the crew here is the disabled
    // button, so that is what is pinned; the return is the second line of
    // defence, kept for the same reason the address list keeps its own.
    render(<PhoneList contact={contact([])} />);
    fireEvent.click(screen.getByText(PHONE_ADD_LABEL));

    const add = screen.getByText("Add").closest("button");
    expect(add?.disabled).toBe(true);

    // A label alone does not make it addable — the number is the field that
    // matters, and a labelled blank would be a row that reaches nobody.
    fireEvent.change(screen.getByLabelText("Label"), {
      target: { value: "Landline" },
    });
    expect(screen.getByText("Add").closest("button")?.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Number"), {
      target: { value: "+14165550199" },
    });
    expect(screen.getByText("Add").closest("button")?.disabled).toBe(false);
  });

  it("PL-7: removing one names it, so the wrong row cannot be clicked blind", () => {
    render(
      <PhoneList
        contact={contact([
          {
            id: "p1",
            phone_e164: "+14165550177",
            label: "Landline",
            created_at: "2026-08-01T09:00:00Z",
          },
          {
            id: "p2",
            phone_e164: "+14165550166",
            label: null,
            created_at: "2026-08-02T09:00:00Z",
          },
        ])}
      />,
    );
    fireEvent.click(screen.getByLabelText("Remove +14165550166"));
    expect(removePhone).toHaveBeenCalledWith("p2");
  });
});
