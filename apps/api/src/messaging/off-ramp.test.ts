/**
 * #481 — the off-ramp, and the exemption it needs.
 *
 * The acceptance criterion that matters most is that the exemption "cannot be
 * reached by any other send path", so most of this is about what does NOT get
 * sent. A courtesy that turns into a way for a cancelled workspace to keep
 * texting is not a courtesy, it is the thing D86 exists to prevent.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { productionSources } from "../test/source-tree";
import { MAX_OFFRAMP_REPLIES } from "./off-ramp";

const SRC = join(fileURLToPath(new URL(".", import.meta.url)), "..");

describe("#481 the off-ramp exemption is unreachable from anywhere else", () => {
  /**
   * The exemption is the fourth argument to `runPreSendGates`. Only the
   * off-ramp may pass it, and this is the assertion that keeps that true — a
   * new send path that discovers the flag and passes it hopefully would
   * otherwise gain the right to text on a cancelled workspace's behalf.
   */
  it("is requested by exactly one file", () => {
    const askers = productionSources(SRC)
      .filter((file) => {
        const source = readFileSync(file, "utf8");
        // A call with a fourth argument. The gate's own file declares the
        // parameter rather than passing it, so it is excluded by the pattern.
        return /runPreSendGates\([^)]*,\s*(true|offRamp)\s*\)/s.test(source);
      })
      .map((file) => file.replace(/\\/g, "/").split("/src/")[1])
      .sort();

    expect(askers).toEqual(["messaging/off-ramp.ts"]);
  });

  it("is granted by the gate, never by the caller", () => {
    // The flag is a QUESTION. `offRampAllowed` re-reads the opt-in and the
    // grace deadline from the database inside the gate, so a caller that
    // passes `true` for a workspace with neither gets refused exactly like any
    // other cancelled workspace.
    const gate = readFileSync(join(SRC, "messaging", "send.ts"), "utf8");
    expect(gate).toContain("offRampAllowed");
    expect(gate).toMatch(/offRamp && \(await offRampAllowed\(/);
  });

  it("relaxes the subscription gate and nothing else", () => {
    // The opt-out check in particular. A contact who sent STOP hears nothing,
    // ever, and a business leaving is not an exception to that (#331).
    const gate = readFileSync(join(SRC, "messaging", "send.ts"), "utf8");
    const afterExemption = gate.slice(gate.indexOf("offRampAllowed(env, companyId)"));
    // Every remaining gate still sits below the one that was relaxed.
    expect(afterExemption).toContain("opt_outs");
    expect(afterExemption).toContain("registration_pending");
    expect(afterExemption).toContain("Destination must be a US or Canada number");
  });

  it("ends when our control of the number does", () => {
    // After release the number is not ours and nothing can answer from it, so
    // the window is derived from the same deadline the release job uses rather
    // than a second copy that could disagree with it.
    const gate = readFileSync(join(SRC, "messaging", "send.ts"), "utf8");
    expect(gate).toContain("GRACE_PERIOD_DAYS");
    expect(gate).toContain("canceled_at");
  });

  it("caps what one departure can cost", () => {
    // Free, but not unbounded: a number being hammered during the grace window
    // must not turn a courtesy into an open bill. Past the ceiling nothing is
    // sent, which is the behaviour that existed before this feature.
    expect(MAX_OFFRAMP_REPLIES).toBeGreaterThan(0);
    const source = readFileSync(join(SRC, "messaging", "off-ramp.ts"), "utf8");
    expect(source).toContain("MAX_OFFRAMP_REPLIES");
    expect(source).toMatch(/>=\s*MAX_OFFRAMP_REPLIES/);
  });

  it("sends the owner's words, never ours", () => {
    // A sentence we composed and sent to people who never agreed to hear from
    // us would be us speaking for a company that has left. The body comes from
    // the stored message and from nowhere else.
    const source = readFileSync(join(SRC, "messaging", "off-ramp.ts"), "utf8");
    expect(source).toMatch(/body:\s*settings\.offramp_message\.trim\(\)/);
  });

  it("records the send BEFORE dispatching it", () => {
    // A crash between dispatching and recording would let the next inbound
    // send a second copy. For this message a duplicate is worse than a miss:
    // being told twice reads as spam, and never being told is the world as it
    // was before the feature.
    const source = readFileSync(join(SRC, "messaging", "off-ramp.ts"), "utf8");
    const stamp = source.indexOf("offramp_sent_at: new Date()");
    const send = source.indexOf("guardedAutoSend(");
    expect(stamp).toBeGreaterThan(-1);
    expect(send).toBeGreaterThan(stamp);
  });

  it("never fires for a workspace that is still paying", () => {
    // An active business needs no off-ramp, and sending one would tell a
    // paying customer's contacts that it had moved.
    const source = readFileSync(join(SRC, "messaging", "off-ramp.ts"), "utf8");
    expect(source).toMatch(/subscription_status === "active"\) return/);
  });
});
