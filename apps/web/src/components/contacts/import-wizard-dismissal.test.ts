import { describe, expect, it } from "vitest";

import { decideWizardDismissal } from "./import-wizard-dismissal";

describe("decideWizardDismissal", () => {
  it("lets the dialog open without touching wizard state", () => {
    expect(decideWizardDismissal(true, false)).toEqual({
      propagate: true,
      reset: false,
    });
  });

  it("keeps mid-flight state when an open request races the import", () => {
    expect(decideWizardDismissal(true, true)).toEqual({
      propagate: true,
      reset: false,
    });
  });

  it("swallows dismissal while the import request is in flight (issue #57)", () => {
    expect(decideWizardDismissal(false, true)).toEqual({
      propagate: false,
      reset: false,
    });
  });

  it("closes and resets once no import is in flight", () => {
    expect(decideWizardDismissal(false, false)).toEqual({
      propagate: true,
      reset: true,
    });
  });
});
