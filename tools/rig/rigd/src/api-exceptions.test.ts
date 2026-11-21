import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiExceptionsNow } from "./api-exceptions.ts";

const dirs: string[] = [];
afterEach(() => {
  vi.unstubAllGlobals();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe(apiExceptionsNow, () => {
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

  it("explains exact probe events and leaves another event with the same fingerprint unexplained", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "rigd-api-exceptions-"));
    dirs.push(stateDir);
    const rigd = join(stateDir, "rigd");
    mkdirSync(rigd);
    const recorded = "0088623f-22d6-46aa-8f82-cc08132fe151";
    const unexpected = "febf744a-62c2-4703-957a-c986aeb56cbb";
    const connect = "1e777ad2-93ea-4fee-9dd7-b877c254acdb";
    const unexpectedConnect = "63dc1009-cbef-45f4-b6dc-1ddafe33df8c";
    const wrongSeverity = "6ee8e69e-ee82-40ec-88b1-ad52b7b4418c";
    const at = Date.UTC(2026, 10, 7);
    writeFileSync(join(rigd, "expected-probe-exceptions.json"), JSON.stringify([
      { event_id: recorded, probe: "voicemail-download-reset", evidence: "#785" },
      { event_id: connect, probe: "stripe-test-connect-invalid-account", evidence: "#772" },
      { event_id: wrongSeverity, probe: "voicemail-download-reset", evidence: "#785" },
    ]));
    const voicemail = [{ type: "Error", value: "calls-v3 voicemail attempt 1 failed, retrying: Network connection lost." }];
    const stripe = [{ type: "Error", value: "The provided key 'redacted-test-key' does not have access to account 'redacted-account' (or that account does not exist)." }];
    vi.stubGlobal("fetch", () => Promise.resolve(Response.json({ results: [
      [at / 1000, "warning", "same-voicemail-fingerprint", voicemail, "call-session-do", null, null, null, null, recorded],
      [at / 1000, "warning", "same-voicemail-fingerprint", voicemail, "call-session-do", null, null, null, null, unexpected],
      [at / 1000, "warning", "handled:stripe-connect-refresh", stripe, "api", null, null, null, null, connect],
      [at / 1000, "warning", "handled:stripe-connect-refresh", stripe, "api", null, null, null, null, unexpectedConnect],
      [at / 1000, "error", "same-message-error", voicemail, "call-session-do", null, null, null, null, wrongSeverity],
    ] })));

    const report = await apiExceptionsNow({ stateDir, store: { readOptional: () => "example" } }, at);

    expect(report.expected_probes_24h).toEqual([
      { key: "same-voicemail-fingerprint", probe: "voicemail-download-reset", evidence: "#785" },
      { key: "handled:stripe-connect-refresh", probe: "stripe-test-connect-invalid-account", evidence: "#772" },
    ]);
    expect(report.unexplained_24h).toEqual(["handled:stripe-connect-refresh", "same-message-error", "same-voicemail-fingerprint"]);
  });
});
