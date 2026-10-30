/**
 * D142: the rig's greeting-capture trigger fires on an audit action literal in
 * the migration, and the route writes that action from a TypeScript constant.
 * If the two drift, the gate silently switches off and
 * rig_destination_gate.test.sql still passes, because its fixture inserts the
 * old literal by hand.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { GREETING_CAPTURE_AUDIT_ACTION } from "../calls/greeting-capture";

const MIGRATIONS = join(import.meta.dirname, "..", "..", "..", "..", "supabase", "migrations");

/** The migration that creates the capture trigger, found by what it does rather than its name. */
function gateMigration(): string {
  const hits = readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith(".sql"))
    .map((name) => readFileSync(join(MIGRATIONS, name), "utf8"))
    .filter((source) => source.includes("create trigger rig_gate_greeting_capture"));
  expect(hits, "exactly one migration creates the capture gate").toHaveLength(1);
  return hits[0];
}

describe("the rig's greeting-capture gate", () => {
  it("fires on the action the capture route writes", () => {
    const source = gateMigration();
    const trigger = source.slice(source.indexOf("create trigger rig_gate_greeting_capture"));
    const when = /when\s*\(\s*new\.action\s*=\s*'([^']+)'\s*\)/.exec(trigger);
    expect(when, "the trigger is still gated on one audit action").not.toBeNull();
    expect(when![1]).toBe(GREETING_CAPTURE_AUDIT_ACTION);
  });
});
