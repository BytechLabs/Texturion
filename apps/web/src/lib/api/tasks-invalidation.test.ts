import { describe, expect, it } from "vitest";

import { keys, taskMetadataInvalidationKeys } from "./keys";

/**
 * #89: creating (or assigning/deleting) a task must refresh the /for-you "Your
 * tasks" section, which is a SEPARATE query from the /tasks page lists. The bug
 * was that only keys.tasks.* were invalidated, so a task created while on
 * /for-you did not appear there without a manual reload.
 */
describe("taskMetadataInvalidationKeys (#89 For-you refresh)", () => {
  it("invalidates the checklist, the /tasks lists, AND the /for-you queue", () => {
    const set = taskMetadataInvalidationKeys("company-1", "conv-1");
    expect(set).toContainEqual(keys.tasks.checklist("company-1", "conv-1"));
    expect(set).toContainEqual(keys.tasks.lists("company-1"));
    // The fix: For-you is invalidated directly, so a new task shows at once.
    expect(set).toContainEqual(keys.forYou("company-1"));
  });

  it("scopes every key to the acting company", () => {
    for (const key of taskMetadataInvalidationKeys("company-1", "conv-1")) {
      expect(key[0]).toBe("company-1");
    }
  });
});
