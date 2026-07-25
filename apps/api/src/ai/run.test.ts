import { describe, expect, it, vi } from "vitest";

import { runAiFeature, type AiFeatureSpec } from "./run";

const SPEC: AiFeatureSpec = {
  key: "test_feature",
  label: "test feature",
  cap: 100,
  alertThreshold: 80,
  stops: "the thing stops.",
  timeoutMs: 50,
  enabled: (s) => s.suggest_replies,
};

const SETTINGS = {
  enrich_task_address: true,
  enrich_task_due: true,
  suggest_replies: true,
  business_description: null,
  transcribe_voicemail: true,
};

/** A Supabase double: only the reservation RPC and the settings read matter. */
function fakeDb(options: {
  reserve?: { count: number; over_cap: boolean; should_alert: boolean };
  reserveError?: boolean;
} = {}) {
  return {
    rpc: vi.fn(async () =>
      options.reserveError
        ? { data: null, error: { message: "ledger down" } }
        : {
            data: options.reserve ?? {
              count: 1,
              over_cap: false,
              should_alert: false,
            },
            error: null,
          },
    ),
    from: () => ({
      select: () => ({
        eq: () => ({ limit: async () => ({ data: [SETTINGS], error: null }) }),
      }),
    }),
  } as never;
}

const envWith = (run: unknown) => ({ AI: { run } }) as never;

describe("runAiFeature", () => {
  it("runs the model and hands back the raw answer", async () => {
    const run = vi.fn(async () => ({ text: "hello" }));
    const result = await runAiFeature(envWith(run), fakeDb(), {
      companyId: "c1",
      spec: SPEC,
      model: "@cf/test",
      input: { audio: "x" },
      settings: SETTINGS,
    });

    expect(result).toEqual({ ok: true, raw: { text: "hello" } });
    expect(run).toHaveBeenCalledWith("@cf/test", { audio: "x" });
  });

  it("never calls the model without a binding", async () => {
    const result = await runAiFeature({} as never, fakeDb(), {
      companyId: "c1",
      spec: SPEC,
      model: "@cf/test",
      input: {},
      settings: SETTINGS,
    });
    expect(result).toEqual({ ok: false, reason: "unavailable" });
  });

  it("never spends a unit for a company that opted out", async () => {
    const run = vi.fn();
    const db = fakeDb();
    const result = await runAiFeature(envWith(run), db, {
      companyId: "c1",
      spec: SPEC,
      model: "@cf/test",
      input: {},
      settings: { ...SETTINGS, suggest_replies: false },
    });

    expect(result).toEqual({ ok: false, reason: "disabled" });
    expect(run).not.toHaveBeenCalled();
    // The opt-in is checked BEFORE the ledger, so an off switch costs nothing.
    expect((db as unknown as { rpc: ReturnType<typeof vi.fn> }).rpc).not.toHaveBeenCalled();
  });

  it("does not call the model once the cap is reached", async () => {
    const run = vi.fn();
    const result = await runAiFeature(
      envWith(run),
      fakeDb({ reserve: { count: 101, over_cap: true, should_alert: false } }),
      { companyId: "c1", spec: SPEC, model: "@cf/test", input: {}, settings: SETTINGS },
    );

    expect(result).toEqual({ ok: false, reason: "over_cap" });
    expect(run).not.toHaveBeenCalled();
  });

  it("treats a broken ledger as over cap, never as permission", async () => {
    // A ledger we cannot write to must cost a feature, not an unbounded bill.
    const run = vi.fn();
    const result = await runAiFeature(envWith(run), fakeDb({ reserveError: true }), {
      companyId: "c1",
      spec: SPEC,
      model: "@cf/test",
      input: {},
      settings: SETTINGS,
    });

    expect(result).toEqual({ ok: false, reason: "over_cap" });
    expect(run).not.toHaveBeenCalled();
  });

  it("gives up on a model that never answers", async () => {
    const result = await runAiFeature(
      envWith(() => new Promise(() => {})),
      fakeDb(),
      { companyId: "c1", spec: SPEC, model: "@cf/test", input: {}, settings: SETTINGS },
    );
    expect(result).toEqual({ ok: false, reason: "model_error" });
  });

  it("turns a throwing model into a reason, never an exception", async () => {
    // Nothing decorated by an AI feature may be taken down by one.
    const result = await runAiFeature(
      envWith(() => {
        throw new Error("model exploded");
      }),
      fakeDb(),
      { companyId: "c1", spec: SPEC, model: "@cf/test", input: {}, settings: SETTINGS },
    );
    expect(result).toEqual({ ok: false, reason: "model_error" });
  });
});
