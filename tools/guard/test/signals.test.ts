import { describe, expect, it } from "vitest";

import { FRAUD_SIGNALS, isFraudSignal, recordSignal, requirePaidLanesOpen, signalSummary } from "../src/state/signals";
import { ready } from "./support";

const DAY = 24 * 60 * 60 * 1000;

describe("fraud-type notices", () => {
  it("latch the paid lanes off on the first one, for each fraud type", async () => {
    for (const signal of FRAUD_SIGNALS) {
      const h = await ready();
      await recordSignal(h.ctx, { signal, notice_id: "n-1", corroborated_by: "signature" });
      await expect(requirePaidLanesOpen(h.ctx), signal).rejects.toMatchObject({ rule: "signal.latched" });
      h.advance(40 * DAY);
      await expect(requirePaidLanesOpen(h.ctx), signal).rejects.toMatchObject({ rule: "signal.latched" });
      const event = h.outbound.find((item) => item.body.includes("telnyx-account-signal"));
      expect(event?.body).toContain("A fraud-type notice");
    }
  });

  it("match whatever case or spelling the notice uses", () => {
    for (const signal of [
      "suspicious outbound voice traffic",
      "SUSPICIOUS_OUTBOUND_VOICE_TRAFFIC",
      "account.disabled",
      "Messaging suspicious traffic notification",
    ]) {
      expect(isFraudSignal(signal), signal).toBe(true);
    }
    for (const signal of ["Low Balance", "Abandoned calls", "telnyx-concurrency-refusal", "Suspicious"]) {
      expect(isFraudSignal(signal), signal).toBe(false);
    }
  });

  it("clear only with the design change the latch waits for", async () => {
    const h = await ready();
    await recordSignal(h.ctx, { signal: "Account Disabled", notice_id: null, corroborated_by: "account_refused" });
    expect(await signalSummary(h.ctx)).toMatchObject({ latched: true });
    h.ctx.config.signalLatchReset = "after-review";
    h.advance(8 * DAY);
    await expect(requirePaidLanesOpen(h.ctx)).resolves.toBeUndefined();
  });
});

describe("other signals", () => {
  it("halt for 7 days on the first, and latch on a second inside 30", async () => {
    const h = await ready();
    await recordSignal(h.ctx, { signal: "telnyx-concurrency-refusal", notice_id: null, corroborated_by: "guard" });
    await expect(requirePaidLanesOpen(h.ctx)).rejects.toMatchObject({ rule: "signal.halted" });
    h.advance(7 * DAY);
    await expect(requirePaidLanesOpen(h.ctx)).resolves.toBeUndefined();
    await recordSignal(h.ctx, { signal: "Low Balance", notice_id: null, corroborated_by: "balance" });
    h.advance(8 * DAY);
    await expect(requirePaidLanesOpen(h.ctx)).rejects.toMatchObject({ rule: "signal.latched" });
  });

  it("take a late notice like any other, once per notice id", async () => {
    const h = await ready();
    const halt = (late: boolean) =>
      h.call("/halt", {
        caller: "edge",
        body: { signal: "Low Balance", notice_id: "late-1", corroborated_by: "signature", received_at: new Date(h.clock.now).toISOString(), late },
      });
    expect((await halt(true)).status).toBe(200);
    expect((await halt(true)).status).toBe(200);
    expect((await halt(false)).status).toBe(200);
    await expect(requirePaidLanesOpen(h.ctx)).rejects.toMatchObject({ rule: "signal.halted" });
    const state = await h.store.get<{ events: { late?: boolean }[] }>("signals");
    expect(state?.events).toEqual([expect.objectContaining({ notice_id: "late-1", late: true })]);
  });

  it("refuse the guard's own corroboration from the edge", async () => {
    const h = await ready();
    const response = await h.call("/halt", {
      caller: "edge",
      body: { signal: "telnyx-concurrency-refusal", notice_id: null, corroborated_by: "guard", received_at: new Date(h.clock.now).toISOString() },
    });
    expect(response.status).toBe(403);
    await expect(requirePaidLanesOpen(h.ctx)).resolves.toBeUndefined();
  });
});
