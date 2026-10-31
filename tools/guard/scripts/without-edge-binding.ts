/**
 * Writes wrangler.no-edge.jsonc beside wrangler.jsonc: the same config less
 * the EDGE service binding. guard.yml deploys it only when Cloudflare cannot
 * resolve that binding; the edge binds the guard too, so a missing edge would
 * otherwise block every guard deploy. Without EDGE the robot mailbox reads as
 * dead, and sends to it are refused.
 *
 *   node --experimental-strip-types tools/guard/scripts/without-edge-binding.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const EDGE_BINDING_LINE = /^\s*"services":\s*\[\{[^\n]*"binding":\s*"EDGE"[^\n]*\}\],?\s*$/;

/** The config text without its one `"services"` line; throws unless there is exactly one. */
export function withoutEdgeBinding(source: string): string {
  const lines = source.split("\n");
  const found = lines.filter((line) => EDGE_BINDING_LINE.test(line)).length;
  if (found !== 1 || lines.filter((line) => line.includes('"services"')).length !== 1) {
    throw new Error(`without-edge-binding: expected one single-line EDGE "services" entry, found ${found}`);
  }
  return lines.filter((line) => !EDGE_BINDING_LINE.test(line)).join("\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const source = new URL("../wrangler.jsonc", import.meta.url);
  const target = new URL("../wrangler.no-edge.jsonc", import.meta.url);
  writeFileSync(target, withoutEdgeBinding(readFileSync(source, "utf8")));
  console.log("wrote tools/guard/wrangler.no-edge.jsonc without the EDGE binding");
}
