import { describe, expect, it, vi } from "vitest";

import { discloseCalendarOwner } from "./worker";

vi.mock("../notifications/deliver", () => ({
  deliverPush: vi.fn(
    async (_env: unknown, _db: unknown, input: { failures: unknown[] }) => {
      input.failures.push(new Error("one device has a bad token"));
    },
  ),
}));

describe("calendar owner disclosure", () => {
  it("does not retry the whole notice because one device failed", async () => {
    // A throw here makes the drain re-queue the disclosure, which re-notifies
    // every healthy device each pass while the bad token keeps failing.
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      discloseCalendarOwner({ APP_ORIGIN: "https://app.test" } as never, {} as never, {
        company_id: "c",
        user_id: "u",
        connection_id: "k",
        generation: 1,
        reason: "reauth_required",
      } as never),
    ).resolves.toBeUndefined();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
