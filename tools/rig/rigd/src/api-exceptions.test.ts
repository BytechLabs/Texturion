import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { apiExceptionsNow } from "./api-exceptions.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("apiExceptionsNow", () => {
  it("reports a read it cannot make as an error, so R00 fails rather than passing on an empty list", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "rigd-api-exceptions-"));
    dirs.push(stateDir);
    const report = await apiExceptionsNow({ stateDir, store: { readOptional: () => undefined } }, Date.UTC(2026, 10, 7));
    expect(report).toEqual({
      at: "2026-11-07T00:00:00.000Z",
      error: "posthog-personal-api-key and posthog-project-id are not both in the rig's store",
      unexplained_24h: [],
      defects_24h: [],
    });
  });
});
