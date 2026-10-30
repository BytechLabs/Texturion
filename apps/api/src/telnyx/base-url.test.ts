/**
 * D142: Telnyx's host lives in `telnyx/client.ts` and nowhere else.
 *
 * The rig sends every Telnyx request to its guard by setting TELNYX_API_BASE.
 * A module holding its own copy of the host keeps talking to Telnyx directly
 * when that happens, and the guard's policy never sees the request.
 */
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { productionSources, sourceText, stripComments } from "../test/source-tree";
import * as client from "./client";

const API_SRC = join(import.meta.dirname, "..");
const CLIENT = "telnyx/client.ts";
const HOST = /api\.telnyx\.com/;

/**
 * Besides the client, only the environments module reads the variable, and
 * only to refuse a deployment that sets it wrongly.
 */
const BASE_READERS = [CLIENT, "environments/policy.ts"];

function relativeName(path: string): string {
  return path.slice(API_SRC.length + 1).replaceAll("\\", "/");
}

function productionCode(): Array<[string, string]> {
  return productionSources(API_SRC)
    // Test machinery is not shipped: src/test/ and the telnyx track's doubles.
    .filter((path) => !/^test\/|test-support\.ts$/.test(relativeName(path)))
    .map((path) => [relativeName(path), stripComments(sourceText(path))]);
}

describe("the Telnyx base URL", () => {
  it("is not exported from the client in any form", () => {
    const leaked = Object.entries(client).filter(
      ([, value]) => typeof value === "string" && HOST.test(value),
    );
    expect(leaked).toEqual([]);
    expect(Object.keys(client)).not.toContain("TELNYX_API_BASE");
    expect(Object.keys(client)).not.toContain("telnyxApiBase");
  });

  it("is imported by no module, under any name", () => {
    const files = productionCode();
    expect(files.length).toBeGreaterThan(100);
    const importers = files
      .filter(([, code]) =>
        /import\s*\{[^}]*\b(?:DEFAULT_)?TELNYX_API_BASE\b[^}]*\}\s*from\s*["'][^"']*telnyx\/client["']/.test(
          code,
        ),
      )
      .map(([name]) => name);
    expect(importers).toEqual([]);
  });

  it("is spelled only in the client", () => {
    const files = productionCode();
    const spelling = files.filter(([, code]) => HOST.test(code)).map(([name]) => name);
    expect(spelling).toEqual([CLIENT]);
  });

  it("is overridden only through the client", () => {
    // A module reading TELNYX_API_BASE itself builds its own URL and bypasses
    // the client's joining, which keeps the guard's path.
    const readers = productionCode()
      .filter(([, code]) => /\bTELNYX_API_BASE\b/.test(code))
      .map(([name]) => name)
      .filter((name) => name !== "env.ts");
    expect(readers.sort()).toEqual([...BASE_READERS].sort());
  });

  it("is never resolved against a path, which would drop the guard's prefix", () => {
    const resolving = productionCode()
      .filter(([, code]) => /new URL\([^)]*,\s*[^)]*TELNYX_API_BASE/.test(code))
      .map(([name]) => name);
    expect(resolving).toEqual([]);
  });
});
