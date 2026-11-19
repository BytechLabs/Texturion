import { capture } from "../analytics/posthog";
import type { Env } from "../env";
import type { AiFeatureSpec } from "./run";

const TEXT_KEYS = ["output_text", "text", "content", "generated_text"] as const;
const ENVELOPE_KEYS = ["response", "result", "choices", "usage", "id", "model", "object", "created", ...TEXT_KEYS];

function objectOf(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function modelPayload(raw: unknown): unknown {
  const envelope = objectOf(raw);
  if (!envelope) return raw;
  if (typeof envelope.response === "string" || objectOf(envelope.response) || Array.isArray(envelope.response)) {
    return envelope.response;
  }
  if (Array.isArray(envelope.choices)) {
    const choice = objectOf(envelope.choices[0]);
    const content = objectOf(choice?.message)?.content ?? choice?.text;
    if (typeof content === "string" || objectOf(content) || Array.isArray(content)) return content;
  }
  if (envelope.result !== undefined) return modelPayload(envelope.result);
  for (const key of TEXT_KEYS) {
    const value = envelope[key];
    if (typeof value === "string") return value;
  }
  return raw;
}

export function modelText(raw: unknown): string | null {
  const payload = modelPayload(raw);
  return typeof payload === "string" ? payload : null;
}

/** Accept structured responses and JSON surrounded by prose or a code fence. */
export function modelJson(raw: unknown): unknown {
  const payload = modelPayload(raw);
  if (typeof payload !== "string") return payload;

  const candidates = [payload];
  for (const [open, close] of [["{", "}"], ["[", "]"]]) {
    const start = payload.indexOf(open);
    const end = payload.lastIndexOf(close);
    if (start >= 0 && end > start) candidates.push(payload.slice(start, end + 1));
  }
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as unknown;
    } catch {
      continue;
    }
  }
  return undefined;
}

export function modelField(value: unknown, max: number): string | null {
  const text = typeof value === "number" && Number.isFinite(value) ? String(value) : value;
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  return trimmed && trimmed.length <= max ? trimmed : null;
}

export function envelopeShape(raw: unknown): string {
  if (!raw || typeof raw !== "object") return typeof raw;
  return Object.keys(raw).toSorted().join(",") || "{}";
}

export function captureUnusableModelOutput(
  env: Env,
  companyId: string,
  feature: AiFeatureSpec["key"],
  raw: unknown,
  dropped: Record<string, number>,
): Promise<void> {
  const envelope = objectOf(raw);
  const result = objectOf(envelope?.result);
  const json = modelJson(raw);
  const usage = objectOf(envelope?.usage) ?? objectOf(result?.usage);
  const completionTokens = usage?.completion_tokens ?? usage?.output_tokens;
  const response = envelope?.response === undefined ? result?.response : envelope.response;
  return capture(env, "ai_unusable_output", companyId, {
    feature,
    // A model can put customer text in arbitrary JSON keys.
    envelope_keys: ENVELOPE_KEYS.filter((key) => envelope && Object.hasOwn(envelope, key)),
    envelope_key_count: envelope ? Object.keys(envelope).length : 0,
    response_type: typeof response,
    json_parsed: json !== undefined && (modelText(raw) !== null || objectOf(json) !== null || Array.isArray(json)),
    completion_tokens: typeof completionTokens === "number" ? completionTokens : null,
    ...dropped,
  });
}
