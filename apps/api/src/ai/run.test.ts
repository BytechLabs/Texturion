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
  call_wrapup: true,
  summarize_threads: true,
};

/**
 * A Supabase double: the reservation RPC, the settings read, and the #581
 * subscription read.
 *
 * `from` switches on the TABLE now, because the three reads answer different
 * questions and a double that hands the same row to all of them would let the
 * billing gate pass on a settings row.
 */
function fakeDb(options: {
  reserve?: { count: number; over_cap: boolean; should_alert: boolean };
  reserveError?: boolean;
  /** `companies.subscription_status`. Undefined means the row is absent. */
  subscription?: string;
  companyError?: boolean;
} = {}) {
  const row = (table: string): { data: unknown[] | null; error: unknown } => {
    if (table === "companies") {
      if (options.companyError) {
        return { data: null, error: { message: "FetchError: companies" } };
      }
      return {
        data:
          options.subscription === undefined
            ? []
            : [{ subscription_status: options.subscription }],
        error: null,
      };
    }
    return { data: [SETTINGS], error: null };
  };
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
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          // A promise that ALSO carries `.retry`, because that is what
          // postgrest hands back and the two reads use it differently: the
          // settings read awaits the builder as-is, and the #581 subscription
          // read turns the default three retries off first (they would spend
          // seconds re-asking a question whose failure is already decided).
          limit: () =>
            Object.assign(Promise.resolve(row(table)), {
              retry: async () => row(table),
            }),
        }),
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

  // ------------------------------------------------------------------------
  // #581 — the billing standing.
  // ------------------------------------------------------------------------

  it.each(["canceled", "incomplete", "incomplete_expired"])(
    "stops spending on a %s workspace, before the ledger",
    async (subscription) => {
      const run = vi.fn();
      const db = fakeDb({ subscription });
      const result = await runAiFeature(envWith(run), db, {
        companyId: "c1",
        spec: SPEC,
        model: "@cf/test",
        input: {},
        settings: SETTINGS,
      });

      expect(result).toEqual({ ok: false, reason: "subscription_inactive" });
      expect(run).not.toHaveBeenCalled();
      // Not reserved either: a workspace nothing more will be collected on should
      // not have its month walked down by requests it never got.
      //
      // Asserted against the LEDGER rpc by name, not against `rpc` being
      // untouched. The kill-switch check (`api_evaluate_flags`) legitimately runs
      // ahead of the billing gate and shares this mock, so "never called" was
      // asserting an ordering that is not true and does not need to be.
      const calls = (db as unknown as { rpc: { mock: { calls: unknown[][] } } }).rpc
        .mock.calls;
      expect(calls.map((call) => call[0])).not.toContain("ai_usage_reserve");
    },
  );

  it.each(["active", "past_due", "unpaid"])(
    "keeps answering while a %s subscription is still collectible",
    async (subscription) => {
      // The product judgement, asserted rather than commented: a card that
      // failed on Friday is not a cancellation, and Lou going silent mid
      // conversation is worse for a customer who is about to pay us than the
      // tenth of a cent it saves.
      const run = vi.fn(async () => ({ text: "hello" }));
      const result = await runAiFeature(envWith(run), fakeDb({ subscription }), {
        companyId: "c1",
        spec: SPEC,
        model: "@cf/test",
        input: {},
        settings: SETTINGS,
      });

      expect(result).toEqual({ ok: true, raw: { text: "hello" } });
    },
  );

  it("spends anyway when the standing cannot be read", async () => {
    // Fails OPEN, and only here: silencing a paying workspace's AI over a
    // lookup blip is the expensive mistake in the other direction, and the
    // reservation right behind this one still fails CLOSED — so the outage that
    // hides a subscription refuses the spend anyway.
    const run = vi.fn(async () => ({ text: "hello" }));
    const result = await runAiFeature(envWith(run), fakeDb({ companyError: true }), {
      companyId: "c1",
      spec: SPEC,
      model: "@cf/test",
      input: {},
      settings: SETTINGS,
    });

    expect(result).toEqual({ ok: true, raw: { text: "hello" } });
  });

  // ------------------------------------------------------------------------
  // #581 — when the input is BUILT.
  // ------------------------------------------------------------------------

  it("does not build a deferred input for a request it refuses", async () => {
    // The input can be the expensive object in the request (a recording
    // base64-encoded, then spread into an array of millions of numbers), so a
    // gate that decides the ORDER has to decide when it is built. Over cap is
    // the cheapest refusal to prove it with, being the last one.
    const build = vi.fn(() => ({ audio: "x" }));
    const result = await runAiFeature(
      envWith(vi.fn()),
      fakeDb({ reserve: { count: 101, over_cap: true, should_alert: false } }),
      { companyId: "c1", spec: SPEC, model: "@cf/test", input: build, settings: SETTINGS },
    );

    expect(result).toEqual({ ok: false, reason: "over_cap" });
    expect(build).not.toHaveBeenCalled();
  });

  it("builds the fallback shape only once the first shape has failed", async () => {
    // The whole point of deferring the SECOND input: the common case (the first
    // model answers) must not pay for the rare one, and the fallback shape is
    // the more expensive of the two to build.
    const buildFallback = vi.fn(() => ({ audio: [1, 2, 3] }));
    const build = vi.fn(() => ({ audio: "x" }));
    const run = vi.fn(async (model: string) =>
      model === "primary" ? { text: "" } : { text: "Leaking tap upstairs." },
    );
    const args = {
      companyId: "c1",
      spec: SPEC,
      settings: SETTINGS,
      accept: (raw: unknown) => ((raw as { text?: string }).text ?? "") !== "",
    };

    const usable = await runAiFeature(envWith(async () => ({ text: "fine" })), fakeDb(), {
      ...args,
      model: "primary",
      input: build,
      fallback: { model: "fallback", input: buildFallback },
    });
    expect(usable.ok).toBe(true);
    expect(build).toHaveBeenCalledTimes(1);
    expect(buildFallback).not.toHaveBeenCalled();

    const fellBack = await runAiFeature(envWith(run), fakeDb(), {
      ...args,
      model: "primary",
      input: build,
      fallback: { model: "fallback", input: buildFallback },
    });
    expect(fellBack).toEqual({ ok: true, raw: { text: "Leaking tap upstairs." } });
    expect(buildFallback).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith("fallback", { audio: [1, 2, 3] });
  });
});
