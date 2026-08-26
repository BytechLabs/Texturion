import { describe, expect, it } from "vitest";

import { leadChaseNotification } from "./lead-chase";

describe("lead chase notification locale", () => {
  it("composes English copy for an English reader", () => {
    expect(leadChaseNotification(2, "Dana", "en")).toEqual({
      title: "5 min, still no reply",
      body: "Dana hasn't heard back. Anyone can take this one.",
    });
  });

  it("composes French copy for a French Canadian reader", () => {
    expect(leadChaseNotification(2, "Dana", "fr-CA")).toEqual({
      title: "5 min, toujours sans réponse",
      body: "Dana n'a pas eu de réponse. N'importe qui peut s'en occuper.",
    });
  });
});
