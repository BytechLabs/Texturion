import type { Ctx } from "../context";
import {
  AI_AUDIO_BYTES_PER_SECOND,
  AI_CHARS_PER_TOKEN,
  AI_DEFAULT_MAX_TOKENS,
  AI_MODELS,
  AI_NEURONS_PER_DAY,
  type AiModelRate,
} from "../limits";
import { json, Refusal } from "../refusal";
import { add, counted, dayOf, giveBack, tryTake } from "../state/counters";

/**
 * The rig's AI shim (docs/RIG.md): `wrangler dev` on the
 * rig bills Workers AI to the production account, so its calls come here and
 * share a 2,000-neuron day. Each request reserves its worst case before it
 * runs, then settles to the usage the model reports when it reports one.
 */
type Inputs = Record<string, unknown>;

function audioBytes(audio: unknown): number {
  if (typeof audio === "string") return Math.ceil((audio.length * 3) / 4);
  if (Array.isArray(audio)) return audio.length;
  return 0;
}

/** The most a request can cost, in neurons. */
export function estimateNeurons(rate: AiModelRate, inputs: Inputs): number {
  if (rate.kind === "audio") {
    const minutes = audioBytes(inputs.audio) / AI_AUDIO_BYTES_PER_SECOND / 60;
    return Math.ceil(Math.max(minutes, 1 / 60) * rate.perMinute);
  }
  const prompt = JSON.stringify(inputs.messages ?? inputs.prompt ?? "");
  const inputTokens = Math.ceil(prompt.length / AI_CHARS_PER_TOKEN);
  const maxTokens =
    typeof inputs.max_tokens === "number" && inputs.max_tokens > 0 ? inputs.max_tokens : AI_DEFAULT_MAX_TOKENS;
  return Math.ceil((inputTokens * rate.inPerMillion + maxTokens * rate.outPerMillion) / 1_000_000);
}

/** Neurons from a text model's reported usage, or null when it reported none. */
export function reportedNeurons(rate: AiModelRate, result: unknown): number | null {
  if (rate.kind !== "text" || !result || typeof result !== "object") return null;
  const usage = (result as { usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } }).usage;
  if (typeof usage?.prompt_tokens !== "number" || typeof usage?.completion_tokens !== "number") return null;
  return Math.ceil((usage.prompt_tokens * rate.inPerMillion + usage.completion_tokens * rate.outPerMillion) / 1_000_000);
}

export async function handleAi(ctx: Ctx, request: Request, path: string): Promise<Response> {
  const prefix = "/run/";
  if (request.method !== "POST" || !path.startsWith(prefix)) throw new Refusal("ai.model_refused");
  const model = decodeURIComponent(path.slice(prefix.length));
  const rate = AI_MODELS[model];
  if (!rate) throw new Refusal("ai.model_refused");
  if (!ctx.ai) throw new Refusal("ai.binding_missing");

  let inputs: Inputs;
  try {
    inputs = (await request.json()) as Inputs;
  } catch {
    throw new Refusal("request.body_invalid");
  }
  if (!inputs || typeof inputs !== "object" || Array.isArray(inputs)) throw new Refusal("request.body_invalid");
  if (inputs.stream === true) throw new Refusal("ai.stream_refused");

  const day = dayOf(ctx.now());
  const reserved = estimateNeurons(rate, inputs);
  if (!(await tryTake(ctx, "ai-neurons", day, reserved, AI_NEURONS_PER_DAY))) {
    throw new Refusal("budget.ai_neurons_day");
  }

  let result: unknown;
  try {
    result = await ctx.ai.run(model, inputs);
  } catch (cause) {
    await giveBack(ctx, "ai-neurons", day, reserved);
    const message = cause instanceof Error ? cause.message : String(cause);
    return json({ error: "ai_run_failed", message: message.slice(0, 300) }, 502);
  }
  const actual = reportedNeurons(rate, result);
  if (actual !== null && actual < reserved) await giveBack(ctx, "ai-neurons", day, reserved - actual);
  if (actual !== null && actual > reserved) await add(ctx, "ai-neurons", day, actual - reserved);
  return json(result);
}

export async function aiNeuronsToday(ctx: Ctx): Promise<number> {
  return counted(ctx, "ai-neurons", dayOf(ctx.now()));
}
