import { describe, expect, it } from "vitest";

import { offeredBesideDefault } from "./default-choice";

describe("#717 a default is offered once", () => {
  it("drops the explicit choice equal to the default", () => {
    expect(["en", "fr-CA"].filter((v) => offeredBesideDefault(v, "en", null))).toEqual([
      "fr-CA",
    ]);
  });

  it("keeps it for a record already set to it", () => {
    expect(["en", "fr-CA"].filter((v) => offeredBesideDefault(v, "en", "en"))).toEqual([
      "en",
      "fr-CA",
    ]);
  });

  it("hides nothing while the default is unknown", () => {
    expect([15, 20, 30].filter((v) => offeredBesideDefault(v, undefined, null))).toEqual([
      15, 20, 30,
    ]);
    expect([15, 20, 30].filter((v) => offeredBesideDefault(v, null, null))).toEqual([
      15, 20, 30,
    ]);
  });
});
