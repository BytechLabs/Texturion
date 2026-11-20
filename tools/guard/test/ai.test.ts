import { describe, expect, it } from "vitest";

import { AI_MODELS } from "../src/limits";
import { estimateNeurons, reportedNeurons } from "../src/vendors/ai";
import { harness, ruleOf } from './support';
import type { Harness } from './support';

const MODEL = "@cf/meta/llama-3.1-8b-instruct-fast";

function run(h: Harness, inputs: unknown, model = MODEL) {
  return h.call(`/ai/run/${encodeURIComponent(model)}`, { body: inputs });
}

describe("AI", () => {
  it("runs an allowed model through the binding and returns its answer", async () => {
    const h = harness();
    const response = await run(h, { messages: [{ role: "user", content: "hi" }], max_tokens: 64 });
    await expect(response.json()).resolves.toMatchObject({ response: "ok" });
    expect(h.aiCalls).toEqual([{ model: MODEL, inputs: { messages: [{ role: "user", content: "hi" }], max_tokens: 64 } }]);
  });

  it("accepts the model id unencoded too", async () => {
    const h = harness();
    expect((await h.call(`/ai/run/${MODEL}`, { body: { prompt: "x" } })).status).toBe(200);
  });

  it("refuses a model off the allowlist, and streaming", async () => {
    const h = harness();
    await expect(ruleOf(await run(h, { prompt: "x" }, "@cf/meta/llama-3.3-70b-instruct-fp8-fast"))).resolves.toBe(
      "ai.model_refused",
    );
    await expect(ruleOf(await run(h, { prompt: "x", stream: true }))).resolves.toBe("ai.stream_refused");
    expect(h.aiCalls).toEqual([]);
  });

  it("settles each request to the usage the model reports", async () => {
    const h = harness({ aiResult: { response: "ok", usage: { prompt_tokens: 1000, completion_tokens: 1000 } } });
    await run(h, { prompt: "x", max_tokens: 2000 });
    const rate = AI_MODELS[MODEL];
    await expect(h.store.get("count:ai-neurons:2026-11-02")).resolves.toBe(reportedNeurons(rate, { usage: { prompt_tokens: 1000, completion_tokens: 1000 } }));
  });

  it("does not count usage when the model fails", async () => {
    const h = harness({
      ai: {
        run: async () => {
          throw new Error("model overloaded");
        },
      },
    });
    expect((await run(h, { prompt: "x" })).status).toBe(502);
    await expect(h.store.get("count:ai-neurons:2026-11-02")).resolves.toBeUndefined();
  });

  it("fails closed without the binding", async () => {
    const h = harness({ ai: null });
    await expect(ruleOf(await run(h, { prompt: "x" }))).resolves.toBe("ai.binding_missing");
  });

  it("estimates high: the full max_tokens, and audio at a low bitrate", () => {
    const text = AI_MODELS[MODEL];
    expect(estimateNeurons(text, { prompt: "x", max_tokens: 1_000_000 })).toBeGreaterThanOrEqual(34_910);
    const whisper = AI_MODELS["@cf/openai/whisper-large-v3-turbo"];
    // 1.2 MB of base64 is 900 kB of audio: 7.5 minutes at 16 kbit/s.
    expect(estimateNeurons(whisper, { audio: "A".repeat(1_200_000) })).toBe(Math.ceil(7.5 * 46));
    expect(estimateNeurons(whisper, { audio: Array.from({length: 120_000}).fill(0) })).toBe(46);
  });
});
