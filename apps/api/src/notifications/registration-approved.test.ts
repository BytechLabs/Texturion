/**
 * #310 / #525 — the approval push, and the one situation where its words are
 * wrong.
 *
 * Registering for US texting during a #277 paid pause is deliberately allowed:
 * carrier review takes days to weeks, a seasonal crew's quiet winter is when
 * that wait costs nothing, and the $29 is charged once per workspace ever. So
 * approval routinely lands on a workspace every send path is refusing —
 * `runPreSendGates` throws `workspace_paused` for as long as `companies.paused_at`
 * is set — and "You can text customers now" sends that person into the app to be
 * turned away, holding a notification that contradicts the screen.
 *
 * The transport is `deliver.test.ts`'s subject; this pins the decisions: who is
 * told, what it says in each of the two situations, and that a push failure can
 * never unwind an approval that has already been applied.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { getDb } from "../db";
import { supabaseStub } from "../test/routes-harness";
import { completeEnv, stubFetch } from "../test/support";

const deliverPush = vi.fn();
vi.mock("./deliver", () => ({
  deliverPush: (...args: unknown[]) => deliverPush(...args),
}));

const {
  pushRegistrationApproved,
  REGISTRATION_APPROVED_PUSH,
  REGISTRATION_APPROVED_PAUSED_PUSH,
} = await import("./registration-approved");

const env = completeEnv();
const COMPANY_ID = "cccccccc-0000-4000-8000-00000000000c";
const OWNER = "aaaaaaaa-0000-4000-8000-00000000000a";
const CREW = "bbbbbbbb-0000-4000-8000-00000000000b";

afterEach(() => {
  vi.unstubAllGlobals();
  deliverPush.mockReset();
});

/** members + prefs, the only two reads this sender makes. */
function stub(
  members: { user_id: string }[],
  prefs: { user_id: string; push_enabled: boolean }[] = [],
) {
  const sb = supabaseStub(env);
  sb.on("GET", /company_members/, () => members);
  sb.on("GET", /notification_prefs/, () => prefs);
  stubFetch(sb.route);
}

/**
 * #228: the payload is a function of the reader's language now. This returns
 * the ENGLISH rendering, which is what every assertion below is about — the
 * French one is asserted where the copy itself is.
 */
function sent(): { web: { title: string; body: string; url: string } } {
  return { web: composed()("en") };
}

/** The payload composer itself, for the assertions that compare languages. */
function composed(): (locale: "en" | "fr-CA") => {
  title: string;
  body: string;
  url: string;
} {
  const delivery = deliverPush.mock.calls[0][2] as {
    web: (locale: "en" | "fr-CA") => {
      title: string;
      body: string;
      url: string;
    };
  };
  return delivery.web;
}

describe("#310 the approval push", () => {
  it("tells the whole crew that texting is live", async () => {
    stub([{ user_id: OWNER }, { user_id: CREW }]);
    await pushRegistrationApproved(env, getDb(env), COMPANY_ID, false);

    expect(deliverPush).toHaveBeenCalledTimes(1);
    const payload = deliverPush.mock.calls[0][2] as { userIds: string[] };
    expect(payload.userIds.sort()).toEqual([OWNER, CREW].sort());
    // Against the shipped constant, so the assertion cannot pass by quoting a
    // string nobody renders.
    expect(sent().web.title).toBe(REGISTRATION_APPROVED_PUSH.title);
    expect(sent().web.body).toBe(REGISTRATION_APPROVED_PUSH.body);
    expect(sent().web.url).toBe(`${env.APP_ORIGIN}/inbox`);
  });

  it("obeys push_enabled, because this is not a side door", async () => {
    stub(
      [{ user_id: OWNER }, { user_id: CREW }],
      [
        { user_id: OWNER, push_enabled: false },
        { user_id: CREW, push_enabled: true },
      ],
    );
    await pushRegistrationApproved(env, getDb(env), COMPANY_ID, false);
    const payload = deliverPush.mock.calls[0][2] as { userIds: string[] };
    expect(payload.userIds).toEqual([CREW]);
  });
});

describe("#525 the same approval, to a paused workspace", () => {
  it("does not tell them they can text, and points at the resume", async () => {
    stub([{ user_id: OWNER }]);
    await pushRegistrationApproved(env, getDb(env), COMPANY_ID, true);

    expect(sent().web.title).toBe(REGISTRATION_APPROVED_PAUSED_PUSH.title);
    expect(sent().web.body).toBe(REGISTRATION_APPROVED_PAUSED_PUSH.body);
    // The tap lands where the next action is. An inbox they cannot send from is
    // the wrong destination for a notification whose whole message is "resume
    // first".
    expect(sent().web.url).toBe(`${env.APP_ORIGIN}/settings/billing`);
  });

  it("PROVES THE BRANCH: the two notices are genuinely different words", async () => {
    // Without this, both constants could drift to the same sentence and every
    // assertion above would stay green while the paused customer was told,
    // again, that they can text right now.
    expect(REGISTRATION_APPROVED_PAUSED_PUSH.body).not.toBe(
      REGISTRATION_APPROVED_PUSH.body,
    );
    expect(REGISTRATION_APPROVED_PAUSED_PUSH.title).not.toBe(
      REGISTRATION_APPROVED_PUSH.title,
    );
    // And the branch is keyed on the argument rather than on anything ambient:
    // the same company, the same stub, one boolean apart.
    stub([{ user_id: OWNER }]);
    await pushRegistrationApproved(env, getDb(env), COMPANY_ID, false);
    expect(sent().web.body).toBe(REGISTRATION_APPROVED_PUSH.body);
  });

  it("#228: BOTH arms keep their own words in French", async () => {
    // The branch is a fact about the workspace, so it has to survive the
    // translation: a French reader on a paused workspace must not be told they
    // can text now, and the two French bodies must not have collapsed into one.
    stub([{ user_id: OWNER }]);
    await pushRegistrationApproved(env, getDb(env), COMPANY_ID, false);
    const live = composed()("fr-CA");
    expect(live.title).toBe("Vos textos sont en service");
    expect(live.title).not.toBe(REGISTRATION_APPROVED_PUSH.title);

    deliverPush.mockReset();
    stub([{ user_id: OWNER }]);
    await pushRegistrationApproved(env, getDb(env), COMPANY_ID, true);
    const paused = composed()("fr-CA");
    expect(paused.title).toBe("Inscription américaine approuvée");
    expect(paused.body).not.toBe(live.body);
    // And the destination is still chosen by the pause, not by the language.
    expect(paused.url).toBe(`${env.APP_ORIGIN}/settings/billing`);
  });

  it("still swallows a delivery failure — a push cannot unwind an approval", async () => {
    // The transition is already applied and the email has already gone. Raising
    // here would turn the best moment in the customer's lifecycle into a failed
    // job that retries the whole approval.
    stub([{ user_id: OWNER }]);
    deliverPush.mockRejectedValueOnce(new Error("APNs is down"));
    await expect(
      pushRegistrationApproved(env, getDb(env), COMPANY_ID, true),
    ).resolves.toBeUndefined();
  });
});
