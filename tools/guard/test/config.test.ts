import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { withoutEdgeBinding } from "../scripts/without-edge-binding";
import { parseConcurrentLimit, parseEdgeOrigin } from "../src/env";
import { CRONS } from "../src/guard";
import { GuardState } from "../src/index";
import { AI_MODELS, PARTITION_CAPABILITY } from "../src/limits";

const GUARD_DIR = fileURLToPath(new URL("..", import.meta.url));
const API_SRC = join(GUARD_DIR, "..", "..", "apps", "api", "src");

/** JSONC to JSON, string-aware so a `//` inside a URL survives. */
function stripJsonc(source: string): string {
  let out = "";
  let inString = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (inString) {
      out += ch;
      if (ch === "\\") out += source[++i] ?? "";
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
    } else if (ch === "/" && source[i + 1] === "/") {
      while (i < source.length && source[i] !== "\n") i++;
      out += "\n";
    } else if (ch === "/" && source[i + 1] === "*") {
      i = source.indexOf("*/", i + 2) + 1;
    } else {
      out += ch;
    }
  }
  return out.replace(/,(\s*[}\]])/g, "$1");
}

const wrangler = JSON.parse(stripJsonc(readFileSync(join(GUARD_DIR, "wrangler.jsonc"), "utf8"))) as Record<string, unknown>;

describe("wrangler.jsonc", () => {
  it("gives the guard no public URL of any kind", () => {
    expect(wrangler.workers_dev).toBe(false);
    expect(wrangler.preview_urls).toBe(false);
    for (const key of ["route", "routes", "custom_domains"]) expect(wrangler[key], key).toBeUndefined();
  });

  it("binds the Durable Object the entry point exports, and the AI binding", () => {
    const bindings = (wrangler.durable_objects as { bindings: { name: string; class_name: string }[] }).bindings;
    expect(bindings).toEqual([{ name: "GUARD", class_name: "GuardState" }]);
    expect(typeof GuardState).toBe("function");
    expect(wrangler.ai).toEqual({ binding: "AI" });
    expect(wrangler.version_metadata).toEqual({ binding: "CF_VERSION_METADATA" });
  });

  it("binds the edge's EdgeForGuard entrypoint, the mailbox status the Resend rules read", () => {
    expect(wrangler.services).toEqual([{ binding: "EDGE", service: "loonext-rig-edge", entrypoint: "EdgeForGuard" }]);
  });

  it("can be deployed without that binding when Cloudflare cannot resolve it, and otherwise unchanged", () => {
    const source = readFileSync(join(GUARD_DIR, "wrangler.jsonc"), "utf8");
    const bare = JSON.parse(stripJsonc(withoutEdgeBinding(source))) as Record<string, unknown>;
    const { services: _services, ...rest } = wrangler;
    expect(bare).toEqual(rest);
    expect(() => withoutEdgeBinding(source.replace('"services"', '"services_moved"'))).toThrow();
    expect(() => withoutEdgeBinding(`${source}\n  "services": [{ "binding": "EDGE" }],`)).toThrow();
  });

  it("keeps its own log lines only, never a request URL", () => {
    const logs = (wrangler.observability as { logs: Record<string, unknown> }).logs;
    expect(logs.invocation_logs).toBe(false);
  });

  it("schedules exactly the crons the guard has jobs for", () => {
    expect((wrangler.triggers as { crons: string[] }).crons).toEqual(Object.values(CRONS));
  });

  it("uses only the rig's rate-limit namespace ids, 3001-3009, if it binds any", () => {
    const unsafe = (wrangler.unsafe as { bindings?: { type: string; namespace_id: string }[] } | undefined)?.bindings ?? [];
    const declared = [
      ...unsafe.filter((binding) => binding.type === "ratelimit").map((binding) => binding.namespace_id),
      ...((wrangler.ratelimits as { namespace_id: string }[] | undefined) ?? []).map((binding) => binding.namespace_id),
    ];
    for (const id of declared) expect(Number(id), id).toBeGreaterThanOrEqual(3001);
    for (const id of declared) expect(Number(id), id).toBeLessThanOrEqual(3009);
  });

  it("ships with paid dials off: the concurrent limit is unknown until FA0", () => {
    const vars = wrangler.vars as Record<string, string>;
    expect(parseConcurrentLimit(vars.TELNYX_CONCURRENT_LIMIT)).toBeNull();
    expect(vars.SIGNAL_LATCH_RESET).toBeTruthy();
  });

  it("commits no secret, edge origin or mailbox", () => {
    const vars = wrangler.vars as Record<string, string>;
    for (const name of ["TELNYX_API_KEY", "RESEND_API_KEY", "FCM_SERVICE_ACCOUNT_JSON", "SENTRY_PROD_DSN", "EDGE_ORIGIN", "ROBOT_MAILBOX"]) {
      expect(vars[name], name).toBeUndefined();
    }
  });
});

describe("config parsing", () => {
  it("reads the concurrent limit as a positive integer or nothing", () => {
    expect(parseConcurrentLimit("5")).toBe(5);
    for (const value of [undefined, "", "unknown", "0", "-1", "2.5", "five", "10000"]) {
      expect(parseConcurrentLimit(value), String(value)).toBeNull();
    }
  });

  it("reads the edge origin only as a bare https origin", () => {
    expect(parseEdgeOrigin("https://loonext-rig-edge.example.workers.dev")).toBe("https://loonext-rig-edge.example.workers.dev");
    expect(parseEdgeOrigin("https://loonext-rig-edge.example.workers.dev/")).toBe("https://loonext-rig-edge.example.workers.dev");
    for (const value of ["http://edge.example", "https://edge.example/g", "https://u@edge.example", "edge.example", ""]) {
      expect(parseEdgeOrigin(value), value).toBeNull();
    }
  });
});

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "test" ? [] : sources(path);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [path] : [];
  });
}

describe("in step with the app", () => {
  it("waits for the same capability production's /health reports", () => {
    const ownership = readFileSync(join(API_SRC, "telnyx", "ownership.ts"), "utf8");
    expect(ownership).toContain(`TELNYX_PARTITION_CAPABILITY = "${PARTITION_CAPABILITY}"`);
  });

  it("allows every Workers AI model the app calls", () => {
    const models = new Set<string>();
    for (const file of sources(API_SRC)) {
      for (const match of readFileSync(file, "utf8").matchAll(/export const [A-Z_]*MODEL\s*=\s*"(@cf\/[^"]+)"/g)) {
        models.add(match[1]);
      }
    }
    expect(models.size).toBeGreaterThanOrEqual(4);
    for (const model of models) expect(AI_MODELS[model], model).toBeDefined();
  });
});
