import type { Ctx } from "../context";
import { json, Refusal } from "../refusal";
import { isCleanPath } from "../telnyx/registry";
import { redact } from "./redact";

/**
 * The diag class (docs/RIG.md): GET-only reads
 * of production's Telnyx evidence for workstation agents, through the guard's
 * key, so no second full-power key exists for reading. Only the listed reads,
 * each answer redacted.
 */
interface DiagRead {
  pattern: RegExp;
  /** At least one of these filters must be present: these lists are account-wide. */
  requireOne?: readonly string[];
}

const SETTINGS = ["call_control_applications", "credential_connections", "messaging_profiles", "outbound_voice_profiles"];

export const DIAG_READS: readonly DiagRead[] = [
  { pattern: /^\/v2\/call_events$/, requireOne: ["filter[leg_id]", "filter[application_session_id]"] },
  { pattern: /^\/v2\/detail_records$/, requireOne: ["filter[record_type]"] },
  { pattern: /^\/v2\/webhook_deliveries$/ },
  { pattern: /^\/v2\/webhook_deliveries\/[^/]+$/ },
  { pattern: /^\/v2\/session_analysis\/[^/]+\/[^/]+$/ },
  ...SETTINGS.flatMap((resource) => [
    { pattern: new RegExp(`^/v2/${resource}$`) },
    { pattern: new RegExp(`^/v2/${resource}/[^/]+$`) },
  ]),
];

export async function handleDiag(ctx: Ctx, request: Request, url: URL, path: string): Promise<Response> {
  if (request.method !== "GET") throw new Refusal("diag.method");
  if (!isCleanPath(path)) throw new Refusal("request.malformed_path");
  const read = DIAG_READS.find((item) => item.pattern.test(path));
  if (!read) throw new Refusal("diag.path_refused");
  if (read.requireOne && !read.requireOne.some((name) => url.searchParams.get(name))) {
    throw new Refusal("diag.filter_required");
  }
  if (!ctx.telnyx) throw new Refusal("telnyx.key_missing");
  const reply = await ctx.telnyx.send("GET", `${path}${url.search}`);
  return json(redact(reply.body ?? null), reply.status);
}
