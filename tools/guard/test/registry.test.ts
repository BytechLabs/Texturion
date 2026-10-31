import { describe, expect, it } from "vitest";

import { TELNYX_ENDPOINTS } from "../../../apps/api/src/telnyx/endpoints";
import { RULES } from "../src/refusal";
import { READ_RULES } from "../src/telnyx/read";
import { PROVISIONING_HANDLERS } from "../src/telnyx/provisioning";
import { isCleanPath, matchEndpoint, POLICY_TABLE } from "../src/telnyx/registry";
import { accountWideRule, CLASS_HANDLERS, refusedRule } from "../src/telnyx/route";

/**
 * The two-way registry check, guard side. scripts/check-telnyx-endpoints.mjs
 * proves the registry equals the app's calls; this proves every entry is
 * decided here. A product PR that registers an endpoint the guard has no rule
 * for fails in `pnpm -r test`, the same PR, before it can merge.
 */
const DIAL_KEYS = new Set([
  "POST /v2/calls",
  "POST /v2/calls/:id/actions/transfer",
  "POST /v2/calls/:id/actions/bridge",
]);

/**
 * Read rules allowed before their registry entries exist: the production
 * watches branch registers these four, so the guard decides them first and
 * the merge needs no guard change.
 */
const READS_AHEAD_OF_REGISTRY = new Set([
  "GET /v2/call_control_applications/:id",
  "GET /v2/credential_connections/:id",
  "GET /v2/messaging_profiles",
  "GET /v2/webhook_deliveries",
]);

describe("the policy table is the app's registry", () => {
  it("has one entry per registered endpoint, in the registry's classes", () => {
    expect(POLICY_TABLE.map((entry) => entry.key)).toEqual(
      TELNYX_ENDPOINTS.map((endpoint) => `${endpoint.method} ${endpoint.path}`),
    );
    expect(new Set(POLICY_TABLE.map((entry) => entry.key)).size).toBe(POLICY_TABLE.length);
  });

  it("has a decision for every entry", () => {
    const undecided: string[] = [];
    for (const entry of POLICY_TABLE) {
      if (!CLASS_HANDLERS[entry.policy] && entry.policy !== "refused") undecided.push(entry.key);
      if (entry.policy === "read" && !READ_RULES[entry.key]) undecided.push(entry.key);
      if (entry.policy === "provisioning" && !PROVISIONING_HANDLERS[entry.key]) undecided.push(entry.key);
      if (entry.policy === "dial" && !DIAL_KEYS.has(entry.key)) undecided.push(entry.key);
      if (entry.policy === "message" && entry.key !== "POST /v2/messages") undecided.push(entry.key);
      if (entry.policy === "leg-command") {
        const isAction = /^POST \/v2\/calls\/:id\/actions\/[a-z_]+$/.test(entry.key);
        if (!isAction && entry.key !== "DELETE /v2/recordings/:id") undecided.push(entry.key);
      }
    }
    expect(undecided).toEqual([]);
  });

  it("keeps no rule for an endpoint the registry dropped", () => {
    const keys = new Set(POLICY_TABLE.map((entry) => entry.key));
    expect(Object.keys(READ_RULES).filter((key) => !keys.has(key) && !READS_AHEAD_OF_REGISTRY.has(key))).toEqual([]);
    expect(Object.keys(PROVISIONING_HANDLERS).filter((key) => !keys.has(key))).toEqual([]);
    expect([...DIAL_KEYS].filter((key) => !keys.has(key))).toEqual([]);
  });

  it("gives every refused entry a specific rule from the stable list", () => {
    for (const entry of POLICY_TABLE.filter((item) => item.policy === "refused")) {
      const rule = refusedRule(entry);
      expect(RULES).toContain(rule);
      expect(rule).not.toBe("refused.registry");
    }
  });
});

describe("matching", () => {
  it("matches a path to its entry and returns the decoded ids", () => {
    const matched = matchEndpoint("POST", "/v2/calls/v3%3Aabc/actions/hangup");
    expect(matched?.entry.key).toBe("POST /v2/calls/:id/actions/hangup");
    expect(matched?.ids).toEqual(["v3:abc"]);
  });

  it("does not let an id swallow a deeper path", () => {
    expect(matchEndpoint("GET", "/v2/phone_numbers/abc/voice")?.entry.key).toBe("GET /v2/phone_numbers/:id/voice");
    expect(matchEndpoint("GET", "/v2/phone_numbers/abc/messaging")).toBeNull();
  });

  it("matches by method as well as path", () => {
    expect(matchEndpoint("PUT", "/v2/messages")).toBeNull();
    expect(matchEndpoint("GET", "/v2/balance")).toBeNull();
  });

  it("refuses paths that could be read two ways", () => {
    expect(isCleanPath("/v2/calls/abc/actions/hangup")).toBe(true);
    for (const path of [
      "/v2/calls/abc%2F..%2Fx/actions/hangup",
      "/v2/calls/../phone_numbers",
      "/v2//calls",
      "/v2/calls/./x",
      "/v1/calls",
      "/v2/calls/a%5Cb",
      "/v2/calls/%2e%2e",
    ]) {
      expect(isCleanPath(path), path).toBe(false);
    }
  });
});

describe("the account-wide list", () => {
  it("names each area, reads and writes alike", () => {
    expect(accountWideRule("POST", "/v2/10dlc/brand")).toBe("refused.10dlc");
    expect(accountWideRule("GET", "/v2/10dlc/brand")).toBe("read.account_wide");
    expect(accountWideRule("POST", "/v2/porting_orders")).toBe("refused.porting");
    expect(accountWideRule("POST", "/v2/messaging_hosted_number_orders/x/verification_codes")).toBe(
      "refused.hosted_messaging",
    );
    expect(accountWideRule("GET", "/v2/api_keys")).toBe("read.account_wide");
    expect(accountWideRule("POST", "/v2/api_keys")).toBe("refused.api_keys");
    expect(accountWideRule("GET", "/v2/managed_accounts")).toBe("read.account_wide");
    expect(accountWideRule("PATCH", "/v2/payment/auto_recharge_prefs")).toBe("refused.auto_recharge");
    expect(accountWideRule("POST", "/v2/verifications/sms")).toBe("refused.verification");
  });

  it("keeps partition settings to the setup routine", () => {
    expect(accountWideRule("PATCH", "/v2/outbound_voice_profiles/x")).toBe("refused.setup_only");
    expect(accountWideRule("POST", "/v2/call_control_applications")).toBe("refused.setup_only");
    expect(accountWideRule("DELETE", "/v2/credential_connections/x")).toBe("refused.setup_only");
    expect(accountWideRule("POST", "/v2/notification_channels")).toBe("refused.setup_only");
    expect(accountWideRule("PATCH", "/v2/messaging_profiles/x")).toBe("refused.setup_only");
    expect(accountWideRule("POST", "/v2/billing_groups")).toBe("refused.setup_only");
    // Creating a messaging profile is provisioning, under its own constraints.
    expect(accountWideRule("POST", "/v2/messaging_profiles")).toBeNull();
    expect(accountWideRule("GET", "/v2/phone_numbers")).toBeNull();
  });
});
