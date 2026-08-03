/**
 * #244 — the rota and the acknowledgement.
 *
 * The acknowledgement tests are the ones that matter: this route exists to fix
 * diffusion of responsibility, and it only does that if the second person to
 * tap learns a NAME rather than being told they claimed it too.
 */
import { beforeAll, afterEach, describe, expect, it, vi } from "vitest";

import {
  apiRequest,
  buildTestApp,
  membershipResponder,
  supabaseStub,
  type SupabaseStub,
} from "../test/routes-harness";
import {
  completeEnv,
  createTestAuth,
  jwksRoute,
  stubFetch,
  type TestAuth,
} from "../test/support";
import { onCallRoutes } from "./on-call";

const env = completeEnv();
const COMPANY_ID = "5c1b3c5d-7e9f-4a2b-8c4d-6e8f0a2b4c6d";
const MEMBER_ID = "1d9c8b7a-6f5e-4d3c-9b2a-1f0e9d8c7b6a";
const TECH_ID = "2d9c8b7a-6f5e-4d3c-9b2a-1f0e9d8c7b6a";
const ALERT_ID = "3d9c8b7a-6f5e-4d3c-9b2a-1f0e9d8c7b6a";

let auth: TestAuth;
const app = buildTestApp(onCallRoutes);

beforeAll(async () => {
  auth = await createTestAuth(env);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function world(
  options: {
    role?: string;
    members?: { user_id: string }[];
    acknowledge?: Record<string, unknown>;
    shifts?: Record<string, unknown>[];
    inserted?: Record<string, unknown>[];
    deleted?: { id: string }[];
  } = {},
): SupabaseStub {
  const sb = supabaseStub(env);
  sb.on(
    "POST",
    "/rest/v1/rpc/api_authorize_request",
    membershipResponder(MEMBER_ID, options.role ?? "owner"),
  );
  sb.on("GET", "/rest/v1/company_members", () =>
    options.members ?? [{ user_id: TECH_ID }],
  );
  sb.on("GET", "/rest/v1/on_call_shifts", () => options.shifts ?? []);
  sb.on("POST", "/rest/v1/on_call_shifts", () =>
    options.inserted ?? [{ id: "shift-1", user_id: TECH_ID }],
  );
  sb.on("DELETE", "/rest/v1/on_call_shifts", () =>
    options.deleted ?? [{ id: "shift-1" }],
  );
  sb.on("POST", "/rest/v1/rpc/api_acknowledge_alert", () =>
    options.acknowledge ?? { outcome: "acknowledged", kind: "missed_call" },
  );
  stubFetch(jwksRoute(auth), sb.route);
  return sb;
}

async function call(
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  return apiRequest(app, env, await auth.token(), `/v1/on-call${path}`, {
    companyId: COMPANY_ID,
    method,
    ...(body === undefined ? {} : { body }),
  });
}

const TONIGHT = {
  user_id: TECH_ID,
  starts_at: "2026-08-03T22:00:00.000Z",
  ends_at: "2026-08-04T07:00:00.000Z",
};

describe("#244 the rota", () => {
  it("ON-1: any member can see who is holding the phone", async () => {
    // The issue's own acceptance criterion. Knowing who is on call is not
    // privileged inside a crew — it is what stops two people driving to the
    // same job, and what stops a third assuming somebody else has it.
    world({ role: "member", shifts: [{ id: "shift-1", user_id: TECH_ID }] });

    const res = await call("GET", "");

    expect(res.status).toBe(200);
    expect(((await res.json()) as { data: unknown[] }).data).toHaveLength(1);
  });

  it("ON-2: only an owner or admin decides whose night it is", async () => {
    // Scheduling somebody else to be woken at 2am is a decision about their
    // life, not a preference. A member quietly assigning it to a colleague has
    // to be impossible rather than merely discouraged.
    world({ role: "member" });

    const res = await call("POST", "", TONIGHT);

    expect(res.status).toBe(403);
  });

  it("ON-3: only finished-in-the-future shifts are listed", async () => {
    const sb = world();

    await call("GET", "");

    // A list that accumulates every past shift answers "who is on call" less
    // clearly every week.
    const read = sb.calls.find((c) => c.path === "/rest/v1/on_call_shifts");
    expect(read?.url.searchParams.get("ends_at")).toMatch(/^gt\./);
  });

  it("ON-4: a shift with no practical end is refused", async () => {
    // The failure this whole feature exists to prevent is one person silently
    // holding the phone forever. A year-long shift IS that state.
    world();

    const res = await call("POST", "", {
      ...TONIGHT,
      ends_at: "2027-08-04T07:00:00.000Z",
    });

    expect(res.status).toBe(422);
  });

  it("ON-5: somebody from another crew cannot be put on call", async () => {
    world({ members: [] });

    const res = await call("POST", "", TONIGHT);

    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toContain("not in this crew");
  });
});

describe("#244 acknowledging", () => {
  it("ON-6: one tap puts a name on it", async () => {
    const sb = world();

    const res = await call("POST", `/alerts/${ALERT_ID}/acknowledge`);

    expect(res.status).toBe(200);
    expect(((await res.json()) as { outcome: string }).outcome).toBe(
      "acknowledged",
    );
    // The AUTHENTICATED user's id, not the membership row's — the name that
    // ends up on the alert has to be the human who tapped.
    const rpc = sb.calls.find(
      (c) => c.path === "/rest/v1/rpc/api_acknowledge_alert",
    );
    expect((rpc?.body as { p_user_id: string }).p_user_id).toBe(auth.subject);
  });

  it("ON-7: the second tapper is told WHOSE it is, not that they claimed it", async () => {
    // The fix for diffusion of responsibility only works if the answer names
    // somebody. "Acknowledged" to both leaves two people each believing they
    // own it — the original failure with extra steps.
    world({
      acknowledge: {
        outcome: "already_acknowledged",
        acknowledged_by: TECH_ID,
        acknowledged_at: "2026-08-03T23:05:00.000Z",
      },
    });

    const res = await call("POST", `/alerts/${ALERT_ID}/acknowledge`);

    // 200, not 409: the caller did nothing wrong, and what the app needs is
    // the name so it can say "Sam has this" rather than "conflict".
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      outcome: string;
      acknowledged_by: string;
    };
    expect(body.outcome).toBe("already_acknowledged");
    expect(body.acknowledged_by).toBe(TECH_ID);
  });

  it("ON-8: whoever is actually awake may claim it, not only the rota's name", async () => {
    // Refusing a member because the shift named somebody else would leave the
    // alert widening while a human is already pulling their boots on.
    world({ role: "member" });

    const res = await call("POST", `/alerts/${ALERT_ID}/acknowledge`);

    expect(res.status).toBe(200);
  });

  it("ON-9: an alert from another workspace is not found", async () => {
    world({ acknowledge: { outcome: "not_found" } });

    const res = await call("POST", `/alerts/${ALERT_ID}/acknowledge`);

    expect(res.status).toBe(404);
  });
});
