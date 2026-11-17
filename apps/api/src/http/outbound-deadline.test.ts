import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Node } from "typescript";
import { expect, it } from "vitest";

const ts = createRequire(import.meta.url)("typescript") as typeof import("typescript");
const sourceRoot = fileURLToPath(new URL("../", import.meta.url));
const rawFetchAllowlist: Record<string, number> = {
  "billing/stripe.ts": 1, // Stripe controls the timeout through its client.
  "calls/greeting-capture-leg.ts": 1, // Recording download.
  "geocode/nominatim.ts": 1,
  "http/turnstile.ts": 1,
  "messaging/inbound.ts": 1, // Attachment size checks use the original headers.
  "routes/calendar-oauth.ts": 1,
  "routes/webhooks.ts": 1,
  "routes/webrtc.ts": 1,
  "telnyx/text-enablement.ts": 2,
  "webhooks/outbound-deliver.ts": 1,
};

function rawFetchLines(file: string): number[] {
  const text = readFileSync(join(sourceRoot, file), "utf8");
  if (!/\bfetch\s*(?:\?\.\s*)?\(/.test(text)) return [];
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const lines: number[] = [];
  function visit(node: Node) {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const globalFetch = ts.isIdentifier(callee) && callee.text === "fetch";
      const globalThisFetch = ts.isPropertyAccessExpression(callee) &&
        callee.name.text === "fetch" &&
        ts.isIdentifier(callee.expression) && callee.expression.text === "globalThis";
      if (globalFetch || globalThisFetch) {
        lines.push(source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return lines;
}

it("routes new outbound fetch calls through a deadline", () => {
  const files = readdirSync(sourceRoot, { encoding: "utf8", recursive: true }).map((path) =>
    path.replaceAll("\\", "/"),
  ).filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts") &&
    !file.startsWith("test/") && file !== "http/deadline.ts");
  const violations = files.flatMap((file) =>
    rawFetchLines(file).slice(rawFetchAllowlist[file] ?? 0).map((line) => `${file}:${line}`),
  );
  expect(violations).toEqual([]);
});
