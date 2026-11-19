import { expect, it, vi } from "vitest";

import { capture } from "../analytics/posthog";
import type { Env } from "../env";
import { captureUnusableModelOutput } from "./output";

vi.mock("../analytics/posthog", () => ({ capture: vi.fn() }));

it("reports the model response shape without sending the answer or custom keys", async () => {
  const env = {} as Env;
  await captureUnusableModelOutput(env, "company", "thread_summary", {
    result: { response: "{\"customer's private address\":123}", usage: { completion_tokens: 128 } },
    "another private address": true,
  }, { candidates: 1, uncited: 1 });

  expect(capture).toHaveBeenCalledWith(env, "ai_unusable_output", "company", {
    feature: "thread_summary",
    envelope_keys: ["result"],
    envelope_key_count: 2,
    response_type: "string",
    json_parsed: true,
    completion_tokens: 128,
    candidates: 1,
    uncited: 1,
  });
});
