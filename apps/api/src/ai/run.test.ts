import { describe, expect, it, vi } from "vitest";

import { runAiFeature, type AiFeatureSpec } from "./run";

// #380: `key` is typed to the PRICED features, so this fixture names a real
// one. That is the guard working — a cost centre that does not exist in the
// profitability model cannot be declared, not even in a test.
const SPEC: AiFeatureSpec = {
  key: "suggest_reply",
  label: "test feature",
  cap: 100,
  alertThreshold: 80,
  stops: "the thing stops.",
  timeoutMs: 50,
  unitCostCents: 0.04,
  enabled: (s) => s.suggest_replies,
  // #431: a metered feature must also say what its outcomes MEAN, so the ledger
  // can record whether anyone used the output. Required rather than optional for
  // the same reason `unitCostCents` is — a cost centre that cannot be measured
  // should not be declarable.
  outcomes: { used: "used it", edited: "changed it", discarded: "ignored it" },
};

const SETTINGS = {
  enrich_task_address: true,
  enrich_task_due: true,
  suggest_replies: true,
  business_description: null,
  transcribe_voicemail: true,
  voicemail_intake: true,
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

  it("spends one unit when a fallback shape is needed, not two", async () => {
    // The cap counts what a person asked for, not how many encodings it took
    // to answer once. Reserving per attempt halves every cap with a fallback.
    const run = vi.fn(async (model: string) =>
      model === "primary" ? { text: "" } : { text: "Leaking tap upstairs." },
    );
    const db = fakeDb();

    const result = await runAiFeature(envWith(run), db, {
      companyId: "c1",
      spec: SPEC,
      model: "primary",
      input: {},
      settings: SETTINGS,
      fallback: { model: "fallback", input: {} },
      accept: (raw) => ((raw as { text?: string }).text ?? "") !== "",
    });

    expect(result).toEqual({ ok: true, raw: { text: "Leaking tap upstairs." } });
    expect(run).toHaveBeenCalledTimes(2);
    expect((db as unknown as { rpc: { mock: { calls: unknown[] } } }).rpc.mock.calls)
      .toHaveLength(1);
  });

  it("reaches the fallback when the first model REJECTS", async () => {
    // A wrong input contract rejects, it does not answer with something
    // unusable, so a rejection is the main reason a second shape exists. A
    // shared catch around both attempts skipped the fallback in exactly that
    // case and every answer was lost.
    const run = vi.fn(async (model: string) => {
      if (model === "primary") throw new Error("InferenceUpstreamError");
      return { text: "Leaking tap upstairs." };
    });

    const result = await runAiFeature(envWith(run), fakeDb(), {
      companyId: "c1",
      spec: SPEC,
      model: "primary",
      input: {},
      settings: SETTINGS,
      fallback: { model: "fallback", input: {} },
      accept: (raw) => ((raw as { text?: string }).text ?? "") !== "",
    });

    expect(result).toEqual({ ok: true, raw: { text: "Leaking tap upstairs." } });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("reports a model error when every shape fails", async () => {
    const run = vi.fn(async () => {
      throw new Error("InferenceUpstreamError");
    });

    const result = await runAiFeature(envWith(run), fakeDb(), {
      companyId: "c1",
      spec: SPEC,
      model: "primary",
      input: {},
      settings: SETTINGS,
      fallback: { model: "fallback", input: {} },
    });

    expect(result).toEqual({ ok: false, reason: "model_error" });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("does not reach for the fallback when the first answer is usable", async () => {
    const run = vi.fn(async () => ({ text: "Leaking tap upstairs." }));

    await runAiFeature(envWith(run), fakeDb(), {
      companyId: "c1",
      spec: SPEC,
      model: "primary",
      input: {},
      settings: SETTINGS,
      fallback: { model: "fallback", input: {} },
      accept: (raw) => ((raw as { text?: string }).text ?? "") !== "",
    });

    expect(run).toHaveBeenCalledTimes(1);
  });
});
