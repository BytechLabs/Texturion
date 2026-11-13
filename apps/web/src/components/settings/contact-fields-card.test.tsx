/**
 * @vitest-environment happy-dom
 */
import { cleanup, render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ContactFieldDef } from "@/lib/api/contact-fields";

const query: { data: { data: ContactFieldDef[]; cap: number } | undefined } = {
  data: undefined,
};

vi.mock("@/lib/api/contact-fields", () => ({
  useContactFields: () => ({ data: query.data, isPending: query.data === undefined }),
  useSaveContactFields: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { ContactFieldsCard } from "./contact-fields-card";

function fields(label: string, key: string) {
  return { data: [{ key, label, kind: "text" as const }], cap: 10 };
}

afterEach(() => {
  cleanup();
  query.data = undefined;
});

describe("ContactFieldsCard first paint", () => {
  it("draws the saved fields on the first render when the cache already has them", () => {
    query.data = fields("Gate code", "gate_code");
    const html = renderToStaticMarkup(<ContactFieldsCard canEdit />);
    expect(html).toContain('value="Gate code"');
    expect(html).not.toContain('data-slot="skeleton"');
  });

  it("still shows the skeleton while the first read is in flight", () => {
    const html = renderToStaticMarkup(<ContactFieldsCard canEdit />);
    expect(html).toContain('data-slot="skeleton"');
  });

  it("re-seeds the draft when the server answers again", () => {
    query.data = fields("Gate code", "gate_code");
    const view = render(<ContactFieldsCard canEdit />);
    query.data = fields("Dog name", "dog_name");
    view.rerender(<ContactFieldsCard canEdit />);
    expect(view.container.querySelector<HTMLInputElement>("#field-label-0")?.value).toBe(
      "Dog name",
    );
  });
});
