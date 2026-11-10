import { describe, expect, it } from "vitest";

import { inSettingsGroupOrder, SETTINGS_GROUPS, settingsGroupOf } from "./settings-groups";
import { settingsSectionCapability, type SettingsSectionId } from "./settings-visibility";

/** Every id the visibility rule knows; the capability table is keyed on all of them. */
const ALL_SECTIONS: SettingsSectionId[] = [
  "workspace", "team", "numbers", "hours", "calling", "templates", "ai", "usage",
  "billing", "payments", "history", "notifications", "profile", "account",
  "devices", "help", "whatsNew", "webhooks", "apiKeys", "blockedNumbers",
];

describe("#727 settings groups", () => {
  it("SG-1: every section is in exactly one group", () => {
    const grouped = SETTINGS_GROUPS.flatMap((g) => g.sections);
    expect([...grouped].sort()).toEqual([...ALL_SECTIONS].sort());
    for (const id of ALL_SECTIONS) {
      expect(settingsSectionCapability(id), id).toBeTruthy();
      expect(settingsGroupOf(id), id).toBeTruthy();
    }
  });

  it("SG-2: no group is so big it is a flat list again", () => {
    for (const group of SETTINGS_GROUPS) expect(group.sections.length).toBeLessThanOrEqual(5);
  });

  it("SG-3: sorting keeps sections that share an id in their given order", () => {
    const rows = [
      { id: "profile" as const, slug: "profile" },
      { id: "hours" as const, slug: "away-reply" },
      { id: "workspace" as const, slug: "workspace" },
      { id: "hours" as const, slug: "automatic-texts" },
    ];
    expect(inSettingsGroupOrder(rows, (row) => row.id).map((row) => row.slug)).toEqual([
      "workspace",
      "away-reply",
      "automatic-texts",
      "profile",
    ]);
  });
});
