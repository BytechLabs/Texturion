/**
 * #106 per-number access — the resolver's unrestricted fast paths and the two
 * guards (assert + conversation flavor). Real supabase-js over stubbed fetch.
 *
 * #480: THE PRECEDENCE RULE IS NO LONGER TESTED HERE, because it is no longer
 * implemented here. It moved to `public.member_number_levels` so the realtime
 * topic policy could apply the same rule, and its assertions moved with it to
 * `supabase/tests/member_number_level.test.sql` (NL-1: user beats role beats
 * all, and ruled-and-unmatched is hidden). Both suites run in the same CI gate.
 *
 * What stays here is everything the Worker still decides: the owner/admin fast
 * path that costs zero queries, the DENY-LIST shape (an absent id is visible, so
 * an un-ruled, released or NULL number is never hidden by omission), and the two
 * guards' status codes.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { getDb } from "../db";
import { ApiError } from "../http/errors";
import { endpoint, makeHarness } from "../test/billing-support";
import { completeEnv, stubFetch } from "../test/support";
import {
  assertNumberLevel,
  NOTE_ONLY_MESSAGE,
  requireConversationAccess,
  resolveNumberAccess,
  type NumberAccessLevel,
} from "./number-access";

const env = completeEnv();
const COMPANY = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const USER = "11111111-0000-4000-8000-000000000011";
const NUM_A = "aaaaaaaa-0000-4000-8000-00000000000a";
const NUM_B = "bbbbbbbb-0000-4000-8000-00000000000b";

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * One row of what `member_number_levels` returns: a RESTRICTED number and the
 * caller's effective level on it.
 *
 * The resolver returns rows only for restricted numbers, so building a fixture
 * now means naming the outcome rather than the rules that produce it — the rules
 * are the SQL suite's subject.
 */
function restricted(
  numberId: string,
  level: NumberAccessLevel,
): { phone_number_id: string; level: NumberAccessLevel } {
  return { phone_number_id: numberId, level };
}

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
      endpoint("POST", /\/rest\/v1\/rpc\/member_number_levels/, () => []),
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
    // One query, no phone_numbers fetch — the deny list is built from the
    // resolver's rows alone, so un-ruled / released / NULL numbers stay visible
    // by omission. That omission is the whole shape: an id the resolver did not
    // mention is an id nobody restricted.
    const harness = makeHarness([
      endpoint("POST", /\/rest\/v1\/rpc\/member_number_levels/, () => [
        restricted(NUM_A, "none"),
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
  function memberEndpoints(
    rows: { phone_number_id: string; level: NumberAccessLevel }[],
  ) {
    return [
      endpoint("POST", /\/rest\/v1\/rpc\/member_number_levels/, () => rows),
      endpoint("GET", /\/rest\/v1\/phone_numbers/, () => [{ id: NUM_A }]),
    ];
  }

  it("404s a hidden number's conversation (indistinguishable from missing)", async () => {
    stubFetch(makeHarness(memberEndpoints([restricted(NUM_A, "none")])).route);
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
      makeHarness(memberEndpoints([restricted(NUM_A, "note")])).route,
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
    const routes = memberEndpoints([restricted(NUM_A, "note")]);
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
      endpoint("POST", /\/rest\/v1\/rpc\/member_number_levels/, () => [
        restricted(NUM_A, "none"),
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
