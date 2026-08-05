/**
 * #277 — the pause, at the one choke point every outbound text passes through.
 *
 * The reason this needs its own suite is that a pause looks like nothing from
 * inside the old gates. `subscription_status` is genuinely 'active' (the pause
 * is a licensed-PRICE swap, chosen precisely so the status mirror stays
 * truthful), `plan` is genuinely populated (it is what they resume onto), and
 * the 10DLC campaign is genuinely approved (deactivating it would cost the
 * customer a week of US texting on their return). Every existing test in
 * runPreSendGates therefore passes for a paused workspace.
 *
 * PG-6 is the one that proves the rest: it removes the pause flag and asserts
 * the send goes through, so the assertions above it are known to be capable of
 * failing rather than merely known to pass.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../http/errors";
import { runPreSendGates } from "./send";
import { endpoint, makeHarness } from "../test/billing-support";
import { completeEnv, stubFetch } from "../test/support";
import { getSendGates } from "../telnyx/registration";

const COMPANY_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const DESTINATION = "+14155559001";
const env = completeEnv();

/**
 * Gates come from the aliased double under this vitest project, so the pause is
 * set THERE — the same way every other suite exercises the subscription and
 * registration gates. Everything past the gate is real and goes through the
 * stubbed fetch.
 */
function world(
  options: {
    paused?: boolean;
    subscriptionActive?: boolean;
    /** The #481 off-ramp opt-in, as the companies row would carry it. */
    offRampRow?: Record<string, unknown> | null;
  } = {},
) {
  vi.mocked(getSendGates).mockResolvedValue({
    subscriptionActive: options.subscriptionActive ?? true,
    paused: options.paused ?? false,
    aupEnforcement: "none",
    usApproved: true,
    caAllowed: true,
  });
  return makeHarness([
    endpoint("GET", /\/rest\/v1\/companies/, () =>
      options.offRampRow ? [options.offRampRow] : [],
    ),
    endpoint("GET", /\/rest\/v1\/opt_outs/, () => []),
  ]);
}

async function attempt(options: Parameters<typeof world>[0] = {}, offRamp = false) {
  stubFetch(world(options).route);
  return runPreSendGates(env, COMPANY_ID, DESTINATION, offRamp);
}

beforeEach(() => {
  vi.mocked(getSendGates).mockReset();
});

describe("#277 the seasonal pause, at the send gate", () => {
  it("PG-1: an ordinary workspace is untouched", async () => {
    await expect(attempt()).resolves.toEqual({ destinationE164: DESTINATION });
  });

  it("PG-2: a paused workspace cannot send, with its own code", async () => {
    await expect(attempt({ paused: true })).rejects.toMatchObject({
      code: "workspace_paused",
    });
  });

  it("PG-3: the pause NEVER borrows the abuse-suspension code or its copy", async () => {
    // The failure this prevents is a sentence, and it is the worst one this
    // product could send: `sending_suspended` says a workspace is under review
    // while we look at its conduct. Telling a crew that because they chose a
    // cheaper winter accuses them of something they did not do.
    const error = (await attempt({ paused: true }).catch((e) => e)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).not.toBe("sending_suspended");
    expect(error.code).not.toBe("subscription_inactive");

    const message = error.message.toLowerCase();
    for (const accusation of ["review", "suspend", "abuse", "violat"]) {
      expect(message).not.toContain(accusation);
    }
    // And it says what is being HELD, because that is the entire promise the
    // customer paid the holding fee for.
    expect(message).toContain("number");
    expect(message).toContain("history");
    expect(message).toContain("resume");
  });

  it("PG-4: a cancellation outranks the pause", async () => {
    // A workspace that paused and then cancelled has both facts true. The
    // cancellation is the one with a 30-day clock attached to their phone
    // number, so it is the one they hear about.
    await expect(
      attempt({ paused: true, subscriptionActive: false }),
    ).rejects.toMatchObject({ code: "subscription_inactive" });
  });

  it("PG-5: the #481 off-ramp still gets through, even from a paused workspace", async () => {
    // The one message a departing workspace may send — telling their old
    // customers where they went, while we still hold the number. It is
    // expressed as an exemption from the SUBSCRIPTION gate, so a pause fact
    // checked first, or checked without regard to the exemption, would silence
    // it. Nobody would notice: the send is best-effort and swallows failures.
    const canceledAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    await expect(
      attempt(
        {
          paused: true,
          subscriptionActive: false,
          offRampRow: {
            offramp_opted_in_at: canceledAt,
            offramp_message: "We have moved to 555-0123.",
            canceled_at: canceledAt,
          },
        },
        true,
      ),
    ).resolves.toEqual({ destinationE164: DESTINATION });
  });

  it("PG-6: with the pause flag off the send goes through — the guards above are real", async () => {
    // PROVE THE GUARD BY BREAKING IT. Everything above passes on the day it is
    // written; this is what says it would FAIL if the pause clause went away,
    // rather than passing because something else in the fixture refuses.
    await expect(attempt({ paused: false })).resolves.toEqual({
      destinationE164: DESTINATION,
    });
  });
});
