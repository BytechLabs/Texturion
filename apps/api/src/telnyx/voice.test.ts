/**
 * Voice enablement (FEATURE-GAPS voice wave, Step 1a). enableVoiceOnNumber binds
 * the shared Call-Control app to a number's VOICE settings, idempotently and
 * SMS-safely: a no-op when already enabled, a no-op PATCH when Telnyx already
 * points the number at our connection, and never touching the messaging binding.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { getDb } from "../db";
import type { Env } from "../env";
import { restMatch, stubRoute, type Stub } from "../test/messaging-support";
import { completeEnv, stubFetch, type FetchRoute } from "../test/support";
import {
  enableVoiceOnNumber,
  reconcileVoiceEnablement,
  type VoiceNumberRow,
} from "./voice";

const env: Env = completeEnv();
const CONNECTION = env.TELNYX_VOICE_CONNECTION_ID;
const NUMBER_ID = "dddddddd-0000-4000-8000-00000000000d";
const COMPANY_ID = "cccccccc-0000-4000-8000-00000000000c";
const TELNYX_PN_ID = "1111111111";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function baseRow(overrides: Partial<VoiceNumberRow> = {}): VoiceNumberRow {
  return {
    id: NUMBER_ID,
    company_id: COMPANY_ID,
    status: "active",
    number_e164: "+16135550100",
    telnyx_phone_number_id: TELNYX_PN_ID,
    voice_connection_id: null,
    voice_enabled: false,
    ...overrides,
  };
}

function voiceGet(connectionId: string | null): Stub {
  return stubRoute(
    (url, request) =>
      request.method === "GET" &&
      url.pathname === `/v2/phone_numbers/${TELNYX_PN_ID}/voice`,
    () => ({ data: { connection_id: connectionId } }),
  );
}

// The bind targets the PHONE-NUMBER resource (NOT the /voice sub-resource,
// whose update schema does not accept connection_id) and must echo the
// binding back before the row is stamped.
function voicePatch(): Stub {
  return stubRoute(
    (url, request) =>
      request.method === "PATCH" &&
      url.pathname === `/v2/phone_numbers/${TELNYX_PN_ID}`,
    () => ({ data: { connection_id: CONNECTION } }),
  );
}

function numberUpdate(): Stub {
  return stubRoute(
    (url, request) =>
      request.method === "PATCH" && url.pathname === "/rest/v1/phone_numbers",
    () => new Response(null, { status: 204 }),
  );
}

function serve(...stubs: Stub[]) {
  stubFetch(...(stubs.map((s) => s.route) as FetchRoute[]));
}

describe("enableVoiceOnNumber", () => {
  it("binds the Call-Control app when the number is SMS-only, and stamps the row", async () => {
    const get = voiceGet(null);
    const patch = voicePatch();
    const update = numberUpdate();
    serve(get, patch, update);

    const result = await enableVoiceOnNumber(env, getDb(env), baseRow());

    expect(result.changed).toBe(true);
    expect(result.connectionId).toBe(CONNECTION);
    // The PATCH targets ONLY the voice facet with our connection id.
    expect(patch.calls).toHaveLength(1);
    expect(patch.calls[0].body).toEqual({ connection_id: CONNECTION });
    // The row is stamped voice_enabled=true + connection id.
    expect(update.calls).toHaveLength(1);
    expect(update.calls[0].body).toMatchObject({
      voice_connection_id: CONNECTION,
      voice_enabled: true,
    });
  });

  it("is a no-op when the row is already voice_enabled to our connection", async () => {
    const get = voiceGet(CONNECTION);
    const patch = voicePatch();
    const update = numberUpdate();
    serve(get, patch, update);

    const result = await enableVoiceOnNumber(
      env,
      getDb(env),
      baseRow({ voice_enabled: true, voice_connection_id: CONNECTION }),
    );

    expect(result.changed).toBe(false);
    expect(result.reason).toBe("already_enabled");
    // No Telnyx read/PATCH and no DB write at all.
    expect(get.calls).toHaveLength(0);
    expect(patch.calls).toHaveLength(0);
    expect(update.calls).toHaveLength(0);
  });

  it("skips the PATCH (Telnyx already bound) but stamps the row on a crash re-run", async () => {
    // The row wasn't stamped (crash between PATCH and DB write), but Telnyx
    // already points the number at our connection: no second PATCH, just stamp.
    const get = voiceGet(CONNECTION);
    const patch = voicePatch();
    const update = numberUpdate();
    serve(get, patch, update);

    const result = await enableVoiceOnNumber(env, getDb(env), baseRow());

    expect(result.changed).toBe(true);
    expect(result.reason).toBe("already_bound");
    expect(patch.calls).toHaveLength(0); // idempotent — no duplicate bind
    expect(update.calls).toHaveLength(1);
  });

  it("throws for a number that has not finished provisioning (no telnyx id)", async () => {
    serve(voiceGet(null), voicePatch(), numberUpdate());
    await expect(
      enableVoiceOnNumber(
        env,
        getDb(env),
        baseRow({ telnyx_phone_number_id: null }),
      ),
    ).rejects.toThrow(/no telnyx_phone_number_id/);
  });
});

describe("reconcileVoiceEnablement — §11 cron pass", () => {
  function companiesStub(ids: string[]): Stub {
    return stubRoute(restMatch(env, "GET", "companies"), () =>
      ids.map((id) => ({ id })),
    );
  }
  function numbersStub(rows: Partial<VoiceNumberRow>[]): Stub {
    return stubRoute(restMatch(env, "GET", "phone_numbers"), () =>
      rows.map((row) => baseRow(row)),
    );
  }

  it("#134: binds voice on an active un-bound number of a LIVE-subscription company", async () => {
    const patch = voicePatch();
    const update = numberUpdate();
    const companies = companiesStub([COMPANY_ID]);
    serve(companies, numbersStub([{}]), voiceGet(null), patch, update);

    const summary = await reconcileVoiceEnablement(env);
    expect(summary).toEqual({ checked: 1, enabled: 1 });
    expect(patch.calls).toHaveLength(1);
    expect(update.calls).toHaveLength(1);
    // #134/D42: the gate is the subscription, nothing else — calling is
    // included on every plan, so every live, non-deleted workspace binds.
    const query = companies.calls[0].url.searchParams;
    expect(query.get("subscription_status")).toBe(
      "in.(active,past_due,trialing)",
    );
    expect(query.get("deleted_at")).toBe("is.null");
  });

  it("skips hosted rows (no telnyx id — voice stays on the owner's carrier)", async () => {
    const patch = voicePatch();
    serve(
      companiesStub([COMPANY_ID]),
      numbersStub([{ telnyx_phone_number_id: null }]),
      voiceGet(null),
      patch,
      numberUpdate(),
    );

    const summary = await reconcileVoiceEnablement(env);
    expect(summary).toEqual({ checked: 0, enabled: 0 });
    expect(patch.calls).toHaveLength(0);
  });

  it("does nothing when no company has a live subscription", async () => {
    const numbers = numbersStub([{}]);
    serve(companiesStub([]), numbers);

    const summary = await reconcileVoiceEnablement(env);
    expect(summary).toEqual({ checked: 0, enabled: 0 });
    expect(numbers.calls).toHaveLength(0); // never even queries numbers
  });
});
