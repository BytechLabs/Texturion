/**
 * #106 per-number access — the pure precedence rules, the resolver's
 * unrestricted fast paths, and the two guards (assert + conversation flavor).
 * Real supabase-js over stubbed fetch.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { getDb } from "../db";
import { ApiError } from "../http/errors";
import { endpoint, makeHarness } from "../test/billing-support";
import { completeEnv, stubFetch } from "../test/support";
import {
  assertNumberLevel,
  levelFromRules,
  NOTE_ONLY_MESSAGE,
  requireConversationAccess,
  resolveNumberAccess,
  type NumberAccessRule,
} from "./number-access";

const env = completeEnv();
const COMPANY = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const USER = "11111111-0000-4000-8000-000000000011";
const NUM_A = "aaaaaaaa-0000-4000-8000-00000000000a";
const NUM_B = "bbbbbbbb-0000-4000-8000-00000000000b";

afterEach(() => {
  vi.unstubAllGlobals();
});

function rule(
  numberId: string,
  kind: NumberAccessRule["principal_kind"],
  principal: string | null,
  level: "text" | "note" = "text",
): NumberAccessRule {
  return {
    phone_number_id: numberId,
    principal_kind: kind,
    principal,
    level,
  };
}

describe("levelFromRules (precedence: user > role > all > none)", () => {
  it("no rules → everyone, full use (the default)", () => {
    expect(levelFromRules([], USER, "member")).toBe("text");
  });

  it("a user rule beats a role rule beats an all rule", () => {
    const rules = [
      rule(NUM_A, "all", null, "note"),
      rule(NUM_A, "role", "member", "note"),
      rule(NUM_A, "user", USER, "text"),
    ];
    expect(levelFromRules(rules, USER, "member")).toBe("text");
    // A different user falls through to the role rule.
    expect(levelFromRules(rules, "someone-else", "member")).toBe("note");
    // A different role falls through to the all rule — still note.
    expect(levelFromRules(rules, "someone-else", "admin")).toBe("note");
  });

  it("rules exist but none match → hidden", () => {
    expect(
      levelFromRules([rule(NUM_A, "user", "someone-else")], USER, "member"),
    ).toBe("none");
    expect(
      levelFromRules([rule(NUM_A, "role", "admin")], USER, "member"),
    ).toBe("none");
  });
});

describe("resolveNumberAccess", () => {
  it("owners and admins are unrestricted with ZERO queries", async () => {
    stubFetch(makeHarness([]).route); // any request would fail loudly
    for (const role of ["owner", "admin"] as const) {
      const access = await resolveNumberAccess(getDb(env), {
        companyId: COMPANY,
        userId: USER,
        role,
      });
      expect(access.hiddenNumberIds).toBeNull();
      expect(access.levelFor(NUM_A)).toBe("text");
    }
  });

  it("no rules in the company → unrestricted (one query, no number fetch)", async () => {
    const harness = makeHarness([
      endpoint("GET", /\/rest\/v1\/number_access/, () => []),
    ]);
    stubFetch(harness.route);
    const access = await resolveNumberAccess(getDb(env), {
      companyId: COMPANY,
      userId: USER,
      role: "member",
    });
    expect(access.hiddenNumberIds).toBeNull();
  });

  it("restricted member: hidden ids are the ruled-and-unmatched numbers only", async () => {
    // One query, no phone_numbers fetch — the deny list is built from rules
    // alone, so un-ruled / released / NULL numbers stay visible by omission.
    const harness = makeHarness([
      endpoint("GET", /\/rest\/v1\/number_access/, () => [
        rule(NUM_A, "user", "someone-else", "text"), // USER not listed → hidden
      ]),
    ]);
    stubFetch(harness.route);

    const access = await resolveNumberAccess(getDb(env), {
      companyId: COMPANY,
      userId: USER,
      role: "member",
    });
    expect(access.hiddenNumberIds).toEqual([NUM_A]);
    expect(access.levelFor(NUM_A)).toBe("none");
    // NUM_B has no rule → visible; a NULL number → visible.
    expect(access.levelFor(NUM_B)).toBe("text");
    expect(access.levelFor(null)).toBe("text");
  });
});

describe("assertNumberLevel", () => {
  function memberEndpoints(rules: NumberAccessRule[]) {
    return [
      endpoint("GET", /\/rest\/v1\/number_access/, () => rules),
      endpoint("GET", /\/rest\/v1\/phone_numbers/, () => [{ id: NUM_A }]),
    ];
  }

  it("404s a hidden number's conversation (indistinguishable from missing)", async () => {
    stubFetch(makeHarness(memberEndpoints([rule(NUM_A, "role", "admin")])).route);
    await expect(
      assertNumberLevel(getDb(env), {
        companyId: COMPANY,
        userId: USER,
        role: "member",
        phoneNumberId: NUM_A,
        need: "read",
      }),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("403s a notes-only member on a 'text' need, with the honest copy", async () => {
    stubFetch(
      makeHarness(memberEndpoints([rule(NUM_A, "user", USER, "note")])).route,
    );
    const thrown = await assertNumberLevel(getDb(env), {
      companyId: COMPANY,
      userId: USER,
      role: "member",
      phoneNumberId: NUM_A,
      need: "text",
    }).then(
      () => null,
      (cause: unknown) => cause,
    );
    expect(thrown).toBeInstanceOf(ApiError);
    expect((thrown as ApiError).code).toBe("forbidden");
    expect((thrown as ApiError).message).toBe(NOTE_ONLY_MESSAGE);
  });

  it("lets a notes-only member read and note", async () => {
    const routes = memberEndpoints([rule(NUM_A, "user", USER, "note")]);
    stubFetch(makeHarness(routes).route);
    await expect(
      assertNumberLevel(getDb(env), {
        companyId: COMPANY,
        userId: USER,
        role: "member",
        phoneNumberId: NUM_A,
        need: "note",
      }),
    ).resolves.toBe("note");
  });
});

describe("requireConversationAccess", () => {
  it("passes owners/admins with zero queries", async () => {
    stubFetch(makeHarness([]).route);
    await expect(
      requireConversationAccess(getDb(env), {
        companyId: COMPANY,
        userId: USER,
        role: "admin",
        conversationId: "cccccccc-0000-4000-8000-00000000000c",
        need: "text",
      }),
    ).resolves.toBeUndefined();
  });

  it("blocks a member on a hidden number's conversation", async () => {
    const harness = makeHarness([
      endpoint("GET", /\/rest\/v1\/conversations/, () => [
        { phone_number_id: NUM_A },
      ]),
      endpoint("GET", /\/rest\/v1\/number_access/, () => [
        rule(NUM_A, "role", "admin"),
      ]),
      endpoint("GET", /\/rest\/v1\/phone_numbers/, () => [{ id: NUM_A }]),
    ]);
    stubFetch(harness.route);
    await expect(
      requireConversationAccess(getDb(env), {
        companyId: COMPANY,
        userId: USER,
        role: "member",
        conversationId: "cccccccc-0000-4000-8000-00000000000c",
        need: "read",
      }),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});
