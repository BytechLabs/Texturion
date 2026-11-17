import { expect, it, vi } from "vitest";

import { sendLedgered } from "./send-ledgered";

it("allows the next attempt to send after a delivery failure", async () => {
  let claimed = false;
  const send = vi.fn<() => Promise<boolean>>()
    .mockRejectedValueOnce(new Error("email service unavailable"))
    .mockResolvedValue(true);
  const notice = {
    claim: async () => {
      if (claimed) return false;
      claimed = true;
      return true;
    },
    release: async () => {
      claimed = false;
    },
    send,
  };

  await expect(sendLedgered(notice)).rejects.toThrow("email service unavailable");
  await expect(sendLedgered(notice)).resolves.toBe(true);
  await expect(sendLedgered(notice)).resolves.toBe(false);
  expect(send).toHaveBeenCalledTimes(2);
});
