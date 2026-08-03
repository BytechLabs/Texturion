/**
 * #303 — the enforcement ladder, as a switch rather than as prose.
 *
 * `/legal/aup` §8 publicly commits to a graduated response — ask, rate-limit,
 * suspend, terminate — and `docs/AUP-ENFORCEMENT.md` recorded that the middle
 * two existed nowhere but in that sentence. A policy promising a proportionate
 * step, with no way to take it, leaves one real option when a carrier
 * complaint arrives: terminate. That is the outcome the ladder exists to
 * avoid.
 *
 * AE-5 is the one to read twice, and it is the runbook's own warning made
 * mechanical: `phone_numbers.status = 'suspended'` is the NON-PAYMENT path,
 * and the Stripe webhook clears it when an invoice is paid. If abuse
 * enforcement ever routes through that column, a suspended spammer lifts their
 * own suspension by paying a bill — silently, with no human involved, through
 * a code path whose author never knew abuse existed.
 */
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../http/errors";
import { RATE_LIMITED_SENDS_PER_HOUR, runPreSendGates } from "./send";
import { endpoint, makeHarness } from "../test/billing-support";
import { completeEnv, stubFetch } from "../test/support";
import { getSendGates, type AupEnforcement } from "../telnyx/registration";
import { sourceFiles, sourceText, stripComments } from "../test/source-tree";

const COMPANY_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const DESTINATION = "+14155559001";
const env = completeEnv();

/**
 * The only files allowed to write `aup_enforcement`.
 *
 * Deliberately short. Every addition is somebody claiming a new path may take
 * an enforcement decision, which is exactly the change that deserves a second
 * reader — and the one that must never be a billing or provisioning path.
 */
const ALLOWED_TO_ENFORCE: readonly string[] = [];

/**
 * The gates come from the aliased double under this vitest project, so the
 * enforcement state is set THERE rather than by stubbing a companies row —
 * the same way every other suite exercises the subscription and registration
 * gates. Everything past the gate (the rate-limit count, the opt-out lookup)
 * is real and goes through the stubbed fetch below.
 */
function world(options: { enforcement?: AupEnforcement; sentThisHour?: number } = {}) {
  // vi.mocked: vitest resolves this import to the aliased double, tsc
  // resolves the real module's plain function. The cast is what makes the
  // two agree — a green vitest run does not mean the file typechecks.
  vi.mocked(getSendGates).mockResolvedValue({
    subscriptionActive: true,
    aupEnforcement: options.enforcement ?? "none",
    usApproved: true,
    caAllowed: true,
  });
  return makeHarness([
    // PostgREST answers an exact HEAD count in the content-range header.
    endpoint(
      "HEAD",
      /\/rest\/v1\/messages/,
      () =>
        new Response(null, {
          status: 206,
          headers: { "content-range": `0-0/${options.sentThisHour ?? 0}` },
        }),
    ),
    endpoint("GET", /\/rest\/v1\/opt_outs/, () => []),
  ]);
}

async function attempt(options: Parameters<typeof world>[0] = {}) {
  stubFetch(world(options).route);
  return runPreSendGates(env, COMPANY_ID, DESTINATION);
}

beforeEach(() => {
  vi.mocked(getSendGates).mockReset();
});

describe("#303 the AUP enforcement ladder", () => {
  it("AE-1: a workspace in good standing is untouched", async () => {
    // The overwhelming default, and the assertion that stops every other test
    // here from passing against a gate that refuses everybody.
    await expect(attempt()).resolves.toEqual({ destinationE164: DESTINATION });
  });

  it("AE-2: a suspended workspace cannot send", async () => {
    await expect(attempt({ enforcement: "suspended" })).rejects.toMatchObject({
      code: "sending_suspended",
    });
  });

  it("AE-3: the refusal says what is and is not affected, without describing the detector", async () => {
    // §8 promises the owner is told what happened and why — in an email a
    // person writes after looking, not in an API error. An error that recited
    // the signals would hand a real abuser a description of the detector; one
    // that said only "forbidden" would read to a crew as a bug in the app.
    const error = await attempt({ enforcement: "suspended" }).catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);

    const message = (error as ApiError).message;
    expect(message).toMatch(/inbox, history and number are unaffected/i);
    expect(message).toMatch(/still\s+arrive/i);
    expect(message).toMatch(/email/i);
    // Nothing about how they were caught.
    for (const leak of ["velocity", "fan-out", "threshold", "opt-out rate", "median"]) {
      expect(message.toLowerCase()).not.toContain(leak);
    }
  });

  it("AE-4: a rate-limited workspace sends up to the cap and then stops", async () => {
    // A step on a ladder, not a punishment. Below the cap it is an ordinary
    // day; at the cap the reply is that this resets, because a crew hitting it
    // needs to know whether to wait or to phone somebody.
    await expect(
      attempt({
        enforcement: "rate_limited",
        sentThisHour: RATE_LIMITED_SENDS_PER_HOUR - 1,
      }),
    ).resolves.toEqual({ destinationE164: DESTINATION });

    const error = await attempt({
      enforcement: "rate_limited",
      sentThisHour: RATE_LIMITED_SENDS_PER_HOUR,
    }).catch((e) => e);
    expect((error as ApiError).code).toBe("rate_limited");
    expect((error as ApiError).message).toMatch(/resets each hour/i);
  });

  it("AE-5: nothing on the billing path can write the enforcement state", () => {
    // THE ONE THAT MATTERS, and the runbook's own warning made mechanical.
    //
    // Written first as a behavioural test — suspended refuses, clean passes —
    // which asserted nothing AE-1 and AE-2 had not already covered. The actual
    // risk is not that the gate reads the wrong column today. It is that some
    // future non-payment path starts writing this one, at which point paying
    // an invoice silently lifts an abuse suspension through code whose author
    // never knew abuse existed.
    //
    // So the assertion is about WHO WRITES IT, which is a question about the
    // source rather than about one request.
    const offenders: string[] = [];
    for (const path of sourceFiles(join(process.cwd(), "src"), [".ts"])) {
      if (/\.test\.ts$/.test(path)) continue;
      const rel = path.replace(/\\/g, "/").split("/src/")[1];
      if (ALLOWED_TO_ENFORCE.includes(rel)) continue;

      const code = stripComments(sourceText(path));
      // A write is the column appearing inside an update/insert payload.
      if (/aup_enforcement\s*:/.test(code)) offenders.push(rel);
    }

    expect(
      offenders,
      "These files write `aup_enforcement`, and they are not the enforcement " +
        "path. If one of them is a billing or provisioning path, paying an " +
        "invoice now lifts an abuse suspension — the exact failure " +
        "docs/AUP-ENFORCEMENT.md warns about. Enforcement needs its own " +
        "state, written only by the people who took the decision:\n  " +
        offenders.join("\n  "),
    ).toEqual([]);
  });

  it("AE-10: the allowlist cannot be pre-opened for a billing path", () => {
    // Found by breaking it. Adding "webhooks/stripe.ts" to ALLOWED_TO_ENFORCE
    // passed, because that file does not write the column YET — so the roster
    // could be opened in one commit and the write added in another, and
    // neither would fail. The same shape as the exemption list in the web
    // dragging guard, which had the same hole.
    //
    // A name on this list is a claim that a path may take an enforcement
    // decision. Billing, provisioning and webhook paths never may, whatever
    // they currently contain.
    const forbidden = ALLOWED_TO_ENFORCE.filter((rel) =>
      /^(billing|webhooks|telnyx)\//.test(rel),
    );

    expect(
      forbidden,
      "These are on the enforcement allowlist and must never be: an abuse " +
        "suspension liftable by a payment webhook or a provisioning job is " +
        "the exact failure docs/AUP-ENFORCEMENT.md warns about:\n  " +
        forbidden.join("\n  "),
    ).toEqual([]);
  });

  it("AE-6: the billing suspension is still a different column", () => {
    // The other half. `phone_numbers.status` is what the Stripe webhook
    // clears; if the gate above ever started reading it, an abuse suspension
    // would become payable. The send gate must not mention it at all.
    const gate = stripComments(
      sourceText(join(process.cwd(), "src", "messaging", "send.ts")),
    );
    expect(gate).toContain("aupEnforcement");
    expect(gate).not.toMatch(/phone_numbers/);
  });

  it("AE-7: an unknown or absent state is not an accidental suspension", async () => {
    // A company row written before the column existed reads as undefined. The
    // safe reading of "we do not know" is "not under enforcement" — the other
    // way round, a migration ordering problem would silence every workspace in
    // the product at once.
    // The real getSendGates coalesces an absent column to "none"; this
    // asserts the GATE agrees, so neither half can start treating unknown as
    // suspended on its own.
    await expect(attempt({ enforcement: undefined })).resolves.toEqual({
      destinationE164: DESTINATION,
    });
  });

  it("AE-8: the rate limit counts only this workspace's outbound", async () => {
    // Counting inbound would limit a workspace for being POPULAR, and counting
    // another tenant's traffic would be a cross-tenant leak in a gate.
    const harness = world({ enforcement: "rate_limited", sentThisHour: 1 });
    stubFetch(harness.route);
    await runPreSendGates(env, COMPANY_ID, DESTINATION);

    const url = harness.callsTo("HEAD", /\/rest\/v1\/messages/)[0].url.href;
    expect(url).toContain(`company_id=eq.${COMPANY_ID}`);
    expect(url).toContain("direction=eq.outbound");
    expect(url).toContain("created_at=gte.");
  });

  it("AE-9: the cap is survivable for a crew and useless for a marketer", async () => {
    // The watch job does not judge a workspace below 100 sends a day, so the
    // hourly cap has to leave an ordinary day intact while making a fan-out of
    // thousands take weeks. A cap of 1 would be a suspension wearing a
    // different name; a cap of 10,000 would be no limit at all.
    expect(RATE_LIMITED_SENDS_PER_HOUR).toBeGreaterThanOrEqual(10);
    expect(RATE_LIMITED_SENDS_PER_HOUR).toBeLessThanOrEqual(60);
  });
});
