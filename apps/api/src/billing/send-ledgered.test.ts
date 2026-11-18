import { readFileSync } from "node:fs";
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

it.each([
  ["./grace.ts", 2],
  ["./usage-alerts.ts", 1],
  ["./carrier-ceiling.ts", 1],
  ["../reports/monthly-recap.ts", 1],
  ["../webhooks/stripe.ts", 3],
] as const)("keeps all ledgered notice paths in %s on the retry helper", (file, expected) => {
  const source = readFileSync(new URL(file, import.meta.url), "utf8");
  expect([...source.matchAll(/\b(?:await|return) sendLedgered\(\{/g)]).toHaveLength(expected);
});
