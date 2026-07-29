/**
 * #375 — the alarms that protect the call system share one dependency, and
 * losing it is silent by construction.
 *
 * `docs/CALLS-V3.md` says so itself. §13, on the hard caps: *"Sentry inside the
 * DO REQUIRES the §2.1 instrumentation or every one of these alerts is a silent
 * no-op"*. §17 item 5 calls the queue-latency drift alarm *"NOT optional"*.
 *
 * The instrumentation is real and it is ONE LINE — `index.ts` re-exports the DO
 * through `Sentry.instrumentDurableObjectWithSentry`, because the Worker-level
 * `withSentry` wraps only `fetch`/`scheduled` and would leave a DO's `alarm()`
 * and RPC entry points uninstrumented. A refactor, a runtime upgrade, or a new
 * DO class can drop that line without failing a build or a test.
 *
 * AND THE FAILURE IS INVISIBLE IN BOTH DIRECTIONS. Sentry receiving nothing
 * from a DO looks exactly like a healthy system with nothing to report — which,
 * for warnings that fire at 50% of a cap, IS the expected steady state. The
 * absence of alerts is the normal condition, so the broken condition cannot be
 * told apart from it by looking.
 *
 * So this asserts the line mechanically. It is the cheap half of #375; what it
 * deliberately does NOT do is prove Sentry INGESTED anything, which needs
 * either a Sentry API read token or a synthetic call. See
 * `docs/CALLS-V3.md` §17a for the list of signals that die with this.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import * as worker from "../index";

const API_SRC = fileURLToPath(new URL("..", import.meta.url));
const API_ROOT = join(API_SRC, "..");

/** Every `class X extends DurableObject` declared in the Worker's source. */
function declaredDurableObjects(): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.endsWith(".ts") || entry.endsWith(".test.ts")) continue;
      for (const match of readFileSync(full, "utf8").matchAll(
        /class\s+(\w+)\s+extends\s+DurableObject/g,
      )) {
        found.push(match[1]);
      }
    }
  };
  walk(API_SRC);
  return found;
}

describe("#375 — every Durable Object carries §2.1 Sentry instrumentation", () => {
  const indexSource = readFileSync(join(API_SRC, "index.ts"), "utf8");
  const wrangler = readFileSync(join(API_ROOT, "wrangler.jsonc"), "utf8");

  it("binds no DO class that is not exported through the Sentry wrapper", () => {
    // wrangler resolves a DO class from `main`'s NAMED exports — it does not
    // read the Sentry-wrapped default. So a binding whose class is exported
    // raw would run completely uninstrumented while everything still builds,
    // deploys and serves calls correctly. Only the alarms would be gone.
    const bound = [
      ...wrangler.matchAll(/"class_name"\s*:\s*"(\w+)"/g),
    ].map((match) => match[1]);
    expect(bound.length, "wrangler.jsonc binds no Durable Object at all").toBeGreaterThan(0);

    const unwrapped = bound.filter((name) => {
      const exported = new RegExp(
        `export\\s+const\\s+${name}\\s*=\\s*Sentry\\.instrumentDurableObjectWithSentry`,
      );
      return !exported.test(indexSource);
    });
    expect(
      unwrapped,
      `Durable Object(s) bound by wrangler but not exported through ` +
        `Sentry.instrumentDurableObjectWithSentry: ${unwrapped.join(", ")}. ` +
        `Every §13 cost-cap warning and the §17 queue-latency drift alarm inside ` +
        `them would be a silent no-op — and silence is what a healthy system ` +
        `looks like too.`,
    ).toEqual([]);
  });

  it("leaves no DO class declared in source but unbound and unwrapped", () => {
    // The other direction: a NEW DO class added for a second feature. It would
    // not be caught above (wrangler would not bind it yet), and the moment
    // somebody binds it the instrumentation question is already answered wrong.
    const declared = declaredDurableObjects();
    expect(declared.length, "no DurableObject subclass found — has the scan broken?")
      .toBeGreaterThan(0);

    const unaccounted = declared.filter((name) => {
      // Either it is re-exported wrapped under its own name, or it is the
      // implementation aliased on import (the `X as XImpl` shape index.ts uses).
      const wrapped = new RegExp(`Sentry\\.instrumentDurableObjectWithSentry`);
      const mentioned = new RegExp(`\\b${name}\\b`);
      return !(wrapped.test(indexSource) && mentioned.test(indexSource));
    });
    expect(
      unaccounted,
      `Durable Object class(es) declared but never routed through the ` +
        `instrumented export in index.ts: ${unaccounted.join(", ")}`,
    ).toEqual([]);
  });

  it("exports the wrapped class as a real named export wrangler can resolve", () => {
    // The assertion the two above cannot make from source alone: that the
    // export actually exists at runtime under the bound name. A rename in
    // index.ts that the regex still matched would pass everything else.
    const bound = [
      ...wrangler.matchAll(/"class_name"\s*:\s*"(\w+)"/g),
    ].map((match) => match[1]);
    for (const name of bound) {
      expect(
        (worker as Record<string, unknown>)[name],
        `wrangler binds "${name}" but the Worker exports no such name — ` +
          `the DO would fail to resolve at deploy time`,
      ).toBeTypeOf("function");
    }
  });
});
