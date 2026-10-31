import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * These pin `scripts/check-worker-front-doors.mjs`: every Worker declares both
 * doors in the repo, only the rig's edge answers on workers.dev, and no Worker
 * has a preview URL.
 */

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

type Worker = { file: string; serves: string; workersDev?: boolean };
const guard = (await import(join(REPO, "scripts", "check-worker-front-doors.mjs"))) as {
  WORKERS: Worker[];
  frontDoorProblems: (workers: Worker[], read: (file: string) => string) => string[];
};

const repoFile = (file: string) => readFileSync(join(REPO, file), "utf8");
const only = (file: string) => guard.WORKERS.filter((worker) => worker.file === file);

describe("the Workers it checks", () => {
  it("covers production's two Workers and the rig's edge and guard", () => {
    expect(guard.WORKERS.map((worker) => worker.file)).toEqual([
      "apps/api/wrangler.jsonc",
      "apps/web/wrangler.jsonc",
      "tools/edge/wrangler.jsonc",
      "tools/guard/wrangler.jsonc",
    ]);
  });

  it("passes the real configs", () => {
    expect(guard.frontDoorProblems(guard.WORKERS, repoFile)).toEqual([]);
  });
});

describe("what fails", () => {
  const withText = (text: string) => () => text;

  it("the guard on workers.dev", () => {
    const text = repoFile("tools/guard/wrangler.jsonc").replace('"workers_dev": false', '"workers_dev": true');
    expect(guard.frontDoorProblems(only("tools/guard/wrangler.jsonc"), withText(text))).toEqual([
      expect.stringMatching(/^tools\/guard\/wrangler\.jsonc sets "workers_dev" to true/),
    ]);
  });

  it("a door left to its default, which is on", () => {
    const text = repoFile("tools/guard/wrangler.jsonc").replace('"preview_urls": false,', "");
    expect(guard.frontDoorProblems(only("tools/guard/wrangler.jsonc"), withText(text))).toEqual([
      expect.stringMatching(/^tools\/guard\/wrangler\.jsonc does not set "preview_urls"\. ABSENT MEANS ON/),
    ]);
  });

  it("the edge leaving workers.dev to the default, or opening a preview URL", () => {
    const edge = repoFile("tools/edge/wrangler.jsonc");
    expect(
      guard.frontDoorProblems(only("tools/edge/wrangler.jsonc"), withText(edge.replace('"workers_dev": true,', ""))),
    ).toEqual([expect.stringMatching(/^tools\/edge\/wrangler\.jsonc must set "workers_dev" to true/)]);
    expect(
      guard.frontDoorProblems(
        only("tools/edge/wrangler.jsonc"),
        withText(edge.replace('"preview_urls": false', '"preview_urls": true')),
      ),
    ).toEqual([expect.stringMatching(/^tools\/edge\/wrangler\.jsonc sets "preview_urls" to true/)]);
  });

  it("a production Worker on workers.dev", () => {
    const text = repoFile("apps/api/wrangler.jsonc").replace(/"workers_dev":\s*false/, '"workers_dev": true');
    expect(guard.frontDoorProblems(only("apps/api/wrangler.jsonc"), withText(text))).toHaveLength(1);
  });
});

it("runs in the CI guard job", () => {
  const workflow = readFileSync(join(REPO, ".github", "workflows", "checks.yml"), "utf8");
  expect(workflow).toMatch(/^\s*run: node scripts\/check-worker-front-doors\.mjs\s*$/m);
});
