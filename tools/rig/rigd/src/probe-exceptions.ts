import { readFileSync } from "node:fs";

import type { Explanation, SeenEvent } from './cron-events.ts';

const EVENT_ID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const ISSUE_REFERENCE = /^#[1-9]\d*$/;
const VOICEMAIL_RESET = /^calls-v3 voicemail attempt [1-3] failed, retrying: Network connection lost\.$/;
const STRIPE_ACCOUNT_REFUSED = /^The provided key '[^']+' does not have access to account '[^']+' \(or that account does not exist\)\./;

type Probe = "voicemail-download-reset" | "stripe-test-connect-invalid-account";
type ProbeEvidence = { probe: Probe; evidence: string };

export function readProbes(path: string): ReadonlyMap<string, ProbeEvidence> {
  let rows: unknown;
  try {
    rows = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Map();
    throw error;
  }
  if (!Array.isArray(rows)) throw new TypeError("Expected an array of rig probe exceptions");
  const probes = new Map<string, ProbeEvidence>();
  for (const row of rows as unknown[]) {
    if (!row || typeof row !== "object") throw new TypeError("Invalid rig probe exception record");
    const { event_id, probe, evidence } = row as Record<string, unknown>;
    if (typeof event_id !== "string" || !EVENT_ID.test(event_id) ||
      (probe !== "voicemail-download-reset" && probe !== "stripe-test-connect-invalid-account") ||
      typeof evidence !== "string" || !ISSUE_REFERENCE.test(evidence) || probes.has(event_id)) {
      throw new TypeError("Invalid or duplicate rig probe exception record");
    }
    probes.set(event_id, { probe, evidence });
  }
  return probes;
}

export function expectedProbe(event: SeenEvent, probes: ReadonlyMap<string, ProbeEvidence>): Explanation | undefined {
  const proof = event.id ? probes.get(event.id) : undefined;
  if (!proof || event.level !== "warning" || event.exceptions?.length !== 1) return undefined;
  const exception = event.exceptions[0]!;
  if (exception.type !== "Error") return undefined;
  const matches = proof.probe === "voicemail-download-reset"
    ? event.tags?.source === "call-session-do" && VOICEMAIL_RESET.test(exception.value)
    : event.tags?.source === "api" && event.fingerprint?.join(":") === "handled:stripe-connect-refresh" &&
      STRIPE_ACCOUNT_REFUSED.test(exception.value);
  return matches ? { kind: "expected-probe", ...proof } : undefined;
}
