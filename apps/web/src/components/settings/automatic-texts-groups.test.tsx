import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { CompanyView } from "@/lib/api/types";

vi.mock("@/lib/api/companies", () => ({
  useUpdateCompany: () => ({ isPending: false, mutate: vi.fn() }),
}));

import { AutomaticTextsGroups } from "./automatic-texts-groups";

function render(company: Partial<CompanyView>, canEdit = true): string {
  return renderToStaticMarkup(
    <AutomaticTextsGroups company={company as CompanyView} canEdit={canEdit} />,
  );
}

describe("AutomaticTextsGroups", () => {
  it("shows three groups with every default stated", () => {
    const html = render({});
    expect(html).toContain("If the customer replies first");
    expect(html).toContain("Rating question after a job");
    expect(html).toContain("How long things wait");
    expect(html).toContain("Default: 4 hours");
    expect(html).toContain("Default: 1 day");
    expect(html).toContain("Default: on");
    expect(html).toContain("On: it waits for you.");
    expect(html).toContain("STOP");
  });

  it("shows an older server's missing keys as the defaults, not as off", () => {
    const html = render({});
    expect(html).not.toContain("Off: it goes out anyway.");
    expect(html).toContain('aria-checked="true"');
    expect(html).not.toContain('aria-checked="false"');
  });

  it("shows a switched-off setting as off", () => {
    const html = render({ hold_rating_ask_on_reply: false });
    expect(html).toContain("Off: it goes out anyway.");
  });

  it("includes a current value that is not in the fixed list", () => {
    const html = render({ reminder_expiry_hours: 3 });
    expect(html).toContain(">3 hours<");
  });

  it("disables every control for someone who cannot edit", () => {
    const html = render({}, false);
    expect(html).toContain("Only owners and admins can change these settings.");
    expect(html).not.toMatch(/<select(?![^>]*disabled)/);
    expect(html).not.toMatch(/<button(?![^>]*disabled)/);
  });
});
