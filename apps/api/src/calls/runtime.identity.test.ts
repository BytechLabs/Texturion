/**
 * #307 — the identity a CALLER meets, resolved on the live-call path.
 *
 * Greeting and business name were read straight off the company row, so a
 * workspace with a service line and a sales line answered both the same way.
 * RI-1 is the guarantee that matters most on deploy day: a number with no
 * overrides — which is every number in production the moment this ships —
 * must produce exactly the values it produced before, because the alternative
 * is every customer's greeting changing at once with no one having asked.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Env } from "../env";
import { stubRoute } from "../test/messaging-support";
import { completeEnv, stubFetch } from "../test/support";
import { createSessionRuntime } from "./runtime";

const env: Env = completeEnv();

afterEach(() => {
  vi.unstubAllGlobals();
});

const COMPANY_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const NUMBER_ID = "11111111-1111-4111-8111-111111111111";

const COMPANY_GREETING = "You have reached Reed Roofing.";

/**
 * The reads `loadInitiatedContext` makes, with the number row's overrides
 * under test. Everything else is the minimum that lets it reach the return.
 */
function world(
  overrides: { label: string | null; voicemail_greeting: string | null },
  companyGreeting: string | null = COMPANY_GREETING,
) {
  return stubRoute(
    () => true,
    // `respond` receives the recorded StubCall, not a URL — reading
    // `url.pathname` off the wrong object matched nothing, fell through to a
    // real fetch, and every test here timed out at five seconds.
    (call) => {
      const path = call.url.pathname;
      if (path.includes("/phone_numbers")) {
        return Response.json([
          { id: NUMBER_ID, company_id: COMPANY_ID, status: "active", ...overrides },
        ]);
      }
      if (path.includes("/companies")) {
        return Response.json([
          {
            id: COMPANY_ID,
            name: "Reed Roofing",
            voicemail_greeting: companyGreeting,
            call_screening: "off",
            subscription_status: "active",
          },
        ]);
      }
      if (path.includes("/calls")) return Response.json([]);
      return Response.json([]);
    },
  );
}

async function identityFor(
  overrides: { label: string | null; voicemail_greeting: string | null },
  companyGreeting: string | null = COMPANY_GREETING,
) {
  const routes = world(overrides, companyGreeting);
  stubFetch(routes.route);
  const rt = createSessionRuntime(env);
  return rt.loadInitiatedContext({
    call_session_id: "sess-307",
    call_control_id: "ccid-307",
    from: "+14155559001",
    to: "+14155550001",
  } as never);
}

describe("#307 the caller meets the LINE's identity", () => {
  it("RI-1: a number with no overrides is unchanged", async () => {
    // The deploy-day guarantee. Every number in production is all-null when
    // this ships, so both values must be exactly what the company row gave
    // before the resolver existed.
    const ctx = await identityFor({ label: null, voicemail_greeting: null });
    // Narrowed on `typeof`, not on the one string I remembered: the return is
    // `InitiatedContext | "drop" | "replay-ended"`, and excluding only "drop"
    // left a union vitest ran happily and tsc rejected.
    if (typeof ctx === "string") throw new Error(`expected a context, got ${ctx}`);

    expect(ctx.companyName).toBe("Reed Roofing");
    expect(ctx.greeting).toBe(COMPANY_GREETING);
  });

  it("RI-2: an override reaches the caller", async () => {
    const ctx = await identityFor({
      label: "Reed Roofing Sales",
      voicemail_greeting: "Sales line. Leave your number and we will call back.",
    });
    if (typeof ctx === "string") throw new Error(`expected a context, got ${ctx}`);

    expect(ctx.companyName).toBe("Reed Roofing Sales");
    expect(ctx.greeting).toBe("Sales line. Leave your number and we will call back.");
  });

  it("RI-3: the name and the greeting are resolved TOGETHER", async () => {
    // The coherence the issue is really about: a line that introduces itself
    // one way in the greeting and another in the caller ID is worse than one
    // that is generic. A line naming itself but with no greeting of its own
    // still gets the company greeting — and the NAME the caller hears in
    // everything else is the line's.
    const ctx = await identityFor({
      label: "Reed Roofing Sales",
      voicemail_greeting: null,
    });
    if (typeof ctx === "string") throw new Error(`expected a context, got ${ctx}`);

    expect(ctx.companyName).toBe("Reed Roofing Sales");
    expect(ctx.greeting).toBe(COMPANY_GREETING);
  });

  it("RI-4: a blank override is not an override", async () => {
    // A form that posts "" when somebody clears the box would otherwise
    // silence a live call while the company row still holds a greeting.
    const ctx = await identityFor({ label: "   ", voicemail_greeting: "" });
    if (typeof ctx === "string") throw new Error(`expected a context, got ${ctx}`);

    expect(ctx.companyName).toBe("Reed Roofing");
    expect(ctx.greeting).toBe(COMPANY_GREETING);
  });

  it("RI-5: the number's own columns are actually fetched", async () => {
    // A select that never asked for them resolves undefined for both, which
    // the resolver treats as inherit — so every test above would pass while
    // no override could ever take effect.
    const routes = world({ label: null, voicemail_greeting: null });
    stubFetch(routes.route);
    await createSessionRuntime(env).loadInitiatedContext({
      call_session_id: "sess-307",
      call_control_id: "ccid-307",
      from: "+14155559001",
      to: "+14155550001",
    } as never);

    const numberRead = routes.calls.find((call) =>
      call.url.pathname.includes("/phone_numbers"),
    );
    expect(numberRead, "the number row was never read").toBeTruthy();
    const select = numberRead!.url.searchParams.get("select") ?? "";
    expect(select).toContain("label");
    expect(select).toContain("voicemail_greeting");
  });

  it("RI-6: with no greeting anywhere, the SPOKEN default names the line", async () => {
    // `sanitizeGreeting` falls back to `defaultGreeting(companyName)`, and
    // companyName is the resolved label — so a workspace that never wrote a
    // greeting still answers its sales line as the sales line. This is the
    // path most workspaces are actually on, and it was the one case the other
    // five did not cover: every one of them had a company greeting to inherit.
    const ctx = await identityFor(
      { label: "Reed Roofing Sales", voicemail_greeting: null },
      null,
    );
    if (typeof ctx === "string") throw new Error(`expected a context, got ${ctx}`);

    expect(ctx.greeting).toBeNull();
    // The name the runtime will speak, since the greeting itself is absent.
    expect(ctx.companyName).toBe("Reed Roofing Sales");
  });
});
