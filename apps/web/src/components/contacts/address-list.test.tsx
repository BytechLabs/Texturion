import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api/contacts", () => ({
  useAddContactAddress: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useUpdateContactAddress: () => ({ isPending: false, mutate: vi.fn() }),
  useRemoveContactAddress: () => ({ isPending: false, mutate: vi.fn() }),
}));

import { AddressList } from "./address-list";
import type { ContactDetail } from "@/lib/api/types";

function contact(addresses: ContactDetail["addresses"]): ContactDetail {
  return { id: "c1", addresses } as ContactDetail;
}

describe("#291 the address list", () => {
  it("AL-1: stays out of the way when there is nothing to say", () => {
    // Most contacts have one address, which the field above already holds.
    // An empty "Other addresses" list on every record would be a permanent
    // question mark to serve the property manager with forty.
    const html = renderToStaticMarkup(<AddressList contact={contact([])} />);

    expect(html).toContain("Add another address");
    // No list chrome at all — not merely no primary badge. That is the
    // property: an empty record shows one link, not an empty list.
    expect(html).not.toContain("<ul");
    expect(html).not.toContain("Where the van goes");
  });

  it("AL-2: names the primary rather than relying on its position", () => {
    // "Which address" is the question this list exists to answer, and ordering
    // answers it only for somebody who knows the ordering means something.
    const html = renderToStaticMarkup(
      <AddressList
        contact={contact([
          {
            id: "a1",
            label: "Site",
            address: "12 Elm St",
            is_primary: true,
            created_at: "2026-08-01T00:00:00Z",
          },
        ])}
      />,
    );

    expect(html).toContain("Where the van goes");
    expect(html).toContain("12 Elm St");
    expect(html).toContain("Site");
  });

  it("AL-3: offers to promote the others, and only the others", () => {
    const html = renderToStaticMarkup(
      <AddressList
        contact={contact([
          {
            id: "a1",
            label: null,
            address: "12 Elm St",
            is_primary: true,
            created_at: "2026-08-01T00:00:00Z",
          },
          {
            id: "a2",
            label: null,
            address: "99 Oak Ave",
            is_primary: false,
            created_at: "2026-08-02T00:00:00Z",
          },
        ])}
      />,
    );

    // One promote affordance, for the one that is not already primary.
    expect(html.split("Make it the main one")).toHaveLength(2);
  });
});
