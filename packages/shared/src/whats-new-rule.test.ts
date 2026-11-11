import { describe, expect, it } from "vitest";

import { judgeWhatsNew, RELEASE_SUBJECT } from "./whats-new-rule";

const FEATURES = [
  "feat(web): the month calendar names each weekday once",
  "fix(api): a retry no longer sends twice",
  "feat: settings that can lose a customer say who chose them and when",
];

describe("#756 a release that ships a feature says so in What's new", () => {
  it("fails the release push when features shipped and nothing was added", () => {
    const verdict = judgeWhatsNew({ subjects: FEATURES, added: 0, releasing: true });
    expect(verdict.kind).toBe("fail");
    expect(verdict.features).toEqual([FEATURES[0], FEATURES[2]]);
  });

  it("only warns on an ordinary push, so work between releases is not blocked", () => {
    expect(judgeWhatsNew({ subjects: FEATURES, added: 0, releasing: false }).kind).toBe("warn");
  });

  it("passes once an entry or a quiet-release record was added in the window", () => {
    expect(judgeWhatsNew({ subjects: FEATURES, added: 1, releasing: true }).kind).toBe("ok");
  });

  it("asks nothing of a release with no feature in it", () => {
    const fixes = ["fix(web): a toast says Message", "chore(deps): bump vitest", "docs: the release notes"];
    expect(judgeWhatsNew({ subjects: fixes, added: 0, releasing: true }).kind).toBe("ok");
  });

  it("counts a scoped, an unscoped and a breaking feature, and nothing that only mentions one", () => {
    const subjects = [
      "feat!: drop the old inbox",
      "feat(clients): one picker",
      "fix: the feat flag no longer sticks",
      "featured(web): not a type",
    ];
    expect(judgeWhatsNew({ subjects, added: 0, releasing: true }).features).toEqual([
      "feat!: drop the old inbox",
      "feat(clients): one picker",
    ]);
  });

  it("recognises the commit that merges a release", () => {
    expect(RELEASE_SUBJECT.test("chore: release main (#738)")).toBe(true);
    expect(RELEASE_SUBJECT.test("chore: release maintenance window")).toBe(false);
    expect(RELEASE_SUBJECT.test("feat: chore: release main")).toBe(false);
  });
});
