/**
 * Voice enablement (FEATURE-GAPS voice wave, Step 1a). enableVoiceOnNumber binds
 * the shared Call-Control app to a number's VOICE settings, idempotently and
 * SMS-safely: a no-op when already enabled, a no-op PATCH when Telnyx already
 * points the number at our connection, and never touching the messaging binding.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { SUBSCRIPTION_STATUSES } from "../billing/plans";
import { getDb } from "../db";
import type { Env } from "../env";
import { restMatch, stubRoute, type Stub } from "../test/messaging-support";
import { completeEnv, stubFetch, type FetchRoute } from "../test/support";
import {
  effectiveCnamDisplayName,
  enableVoiceOnNumber,
  reconcileVoiceEnablement,
  sanitizeCnamDisplayName,
  syncCallSettingsForCompany,
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

/** #193: the settings read the post-bind catch-up push performs (its select
 *  names cnam_display_name, which discriminates it from other companies GETs). */
function companySettingsGet(
  row: Record<string, unknown> = {
    name: "Ace Plumbing & Co.",
    cnam_display_name: null,
    call_screening: "flag",
    caller_id_lookup: true,
  },
): Stub {
  return stubRoute(
    restMatch(env, "GET", "companies", (url) =>
      (url.searchParams.get("select") ?? "").includes("cnam_display_name"),
    ),
    () => [row],
  );
}

/** #193: the per-number /voice sub-resource PATCH the catch-up push sends. */
function voiceSettingsPatch(): Stub {
  return stubRoute(
    (url, request) =>
      request.method === "PATCH" &&
      url.pathname === `/v2/phone_numbers/${TELNYX_PN_ID}/voice`,
    () => ({ data: {} }),
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
    const settings = companySettingsGet();
    const voicePush = voiceSettingsPatch();
    serve(settings, get, patch, update, voicePush);

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
    // #193: the freshly voice-bound number immediately carries the company's
    // calling settings, with the caller ID DEFAULTED to the company name in
    // the carrier alphabet ("Ace Plumbing & Co." sanitizes + cuts to 15).
    expect(voicePush.calls).toHaveLength(1);
    expect(voicePush.calls[0].body).toMatchObject({
      inbound_call_screening: "flag_calls",
      caller_id_name_enabled: true,
      cnam_listing: {
        cnam_listing_enabled: true,
        cnam_listing_details: "Ace Plumbing Co",
      },
    });
  });

  it("#193: a failed settings catch-up never un-binds voice (best-effort)", async () => {
    const get = voiceGet(null);
    const patch = voicePatch();
    const update = numberUpdate();
    const settings = companySettingsGet();
    const voicePush = stubRoute(
      (url, request) =>
        request.method === "PATCH" &&
        url.pathname === `/v2/phone_numbers/${TELNYX_PN_ID}/voice`,
      () => new Response("{}", { status: 500 }),
    );
    serve(settings, get, patch, update, voicePush);

    const result = await enableVoiceOnNumber(env, getDb(env), baseRow());
    expect(result.changed).toBe(true); // bind + stamp survived the push failure
    expect(update.calls).toHaveLength(1);
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
    serve(get, patch, update, companySettingsGet(), voiceSettingsPatch());

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
    // The settings-read stub precedes companiesStub: its select-param match
    // (cnam_display_name) claims the #193 catch-up read; the reconcile's own
    // id-only companies lookup falls through to companiesStub.
    serve(
      companySettingsGet(),
      companies,
      numbersStub([{}]),
      voiceGet(null),
      patch,
      update,
      voiceSettingsPatch(),
    );

    const summary = await reconcileVoiceEnablement(env);
    expect(summary).toEqual({ checked: 1, enabled: 1 });
    expect(patch.calls).toHaveLength(1);
    expect(update.calls).toHaveLength(1);
    // #134/D42: the gate is the subscription, nothing else — calling is
    // included on every plan, so every live, non-deleted workspace binds.
    const query = companies.calls[0].url.searchParams;
    expect(query.get("subscription_status")).toBe("in.(active,past_due)");
    expect(query.get("deleted_at")).toBe("is.null");

    // Regression (Sentry NODE-D): this filters the DB enum — Postgres rejects
    // the whole query on any non-enum value ('trialing' is a RAW Stripe
    // status; plans.ts launders it to 'active' before it ever hits the DB),
    // which broke the */15 cron on every run. Pin the list to the enum.
    const filtered = /^in\.\((.*)\)$/.exec(
      query.get("subscription_status") ?? "",
    )![1].split(",");
    for (const status of filtered) {
      expect(SUBSCRIPTION_STATUSES).toContain(status);
    }
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

  it("a permanently-failing number no longer fails the whole run (alert-fatigue fix)", async () => {
    // Telnyx rejects the connection create every time — the per-number
    // failure is captured, but the run RESOLVES with a summary instead of
    // rethrowing an AggregateError that would page the */15 cron forever.
    serve(
      companySettingsGet(),
      companiesStub([COMPANY_ID]),
      numbersStub([{}]),
      voiceGet(null),
      stubRoute(
        (url, request) =>
          request.method === "PATCH" &&
          url.pathname === `/v2/phone_numbers/${TELNYX_PN_ID}`,
        () =>
          new Response(JSON.stringify({ errors: [{ detail: "nope" }] }), {
            status: 422,
          }),
      ),
    );

    const summary = await reconcileVoiceEnablement(env);
    expect(summary.checked).toBe(1);
    expect(summary.enabled).toBe(0);
  });
});

describe("#193 caller ID defaults to the company name", () => {
  describe("sanitizeCnamDisplayName (carrier alphabet: 15 alnum+space)", () => {
    it("drops punctuation, collapses whitespace, and trims the 15-char cut", () => {
      expect(sanitizeCnamDisplayName("Ace Plumbing & Co.")).toBe(
        "Ace Plumbing Co",
      );
      expect(sanitizeCnamDisplayName("  O'Brien   Heating  ")).toBe(
        "O Brien Heating",
      );
      // The 15-char cut lands on a word gap; no trailing space survives.
      expect(sanitizeCnamDisplayName("Best Home Reno Pros")).toBe(
        "Best Home Reno",
      );
    });

    it("returns null when nothing listable survives", () => {
      expect(sanitizeCnamDisplayName("--- !!! ---")).toBeNull();
      expect(sanitizeCnamDisplayName("   ")).toBeNull();
    });
  });

  describe("effectiveCnamDisplayName (the platform-wide fallback rule)", () => {
    it("prefers the explicit override", () => {
      expect(
        effectiveCnamDisplayName({
          name: "Ace Plumbing",
          cnam_display_name: "ACE PLUMBERS",
        }),
      ).toBe("ACE PLUMBERS");
    });

    it("falls back to the sanitized company name when unset", () => {
      expect(
        effectiveCnamDisplayName({
          name: "Ace Plumbing & Co.",
          cnam_display_name: null,
        }),
      ).toBe("Ace Plumbing Co");
    });

    it("is null only when neither yields a listable name", () => {
      expect(
        effectiveCnamDisplayName({ name: "!!!", cnam_display_name: null }),
      ).toBeNull();
    });
  });

  describe("syncCallSettingsForCompany carries the RESOLVED listing", () => {
    function activeNumbers(): Stub {
      return stubRoute(restMatch(env, "GET", "phone_numbers"), () => [
        { id: NUMBER_ID, telnyx_phone_number_id: TELNYX_PN_ID },
      ]);
    }

    it("pushes the effective name and reports how many numbers it reached", async () => {
      const push = voiceSettingsPatch();
      serve(activeNumbers(), push);

      const result = await syncCallSettingsForCompany(
        env,
        getDb(env),
        COMPANY_ID,
        { cnamDisplayName: "Ace Plumbing Co" },
      );

      expect(result).toEqual({ pushed: 1 });
      expect(push.calls).toHaveLength(1);
      expect(push.calls[0].body).toEqual({
        cnam_listing: {
          cnam_listing_enabled: true,
          cnam_listing_details: "Ace Plumbing Co",
        },
      });
    });

    it("disables the listing only for a genuinely unlistable value (null)", async () => {
      const push = voiceSettingsPatch();
      serve(activeNumbers(), push);

      const result = await syncCallSettingsForCompany(
        env,
        getDb(env),
        COMPANY_ID,
        { cnamDisplayName: null },
      );

      expect(result).toEqual({ pushed: 1 });
      expect(push.calls[0].body).toEqual({
        cnam_listing: { cnam_listing_enabled: false },
      });
    });

    it("reports pushed=0 when every number is hosted (nothing to reach)", async () => {
      const push = voiceSettingsPatch();
      serve(
        stubRoute(restMatch(env, "GET", "phone_numbers"), () => [
          { id: NUMBER_ID, telnyx_phone_number_id: null },
        ]),
        push,
      );

      const result = await syncCallSettingsForCompany(
        env,
        getDb(env),
        COMPANY_ID,
        { cnamDisplayName: "Ace Plumbing Co" },
      );

      expect(result).toEqual({ pushed: 0 });
      expect(push.calls).toHaveLength(0);
    });
  });
});
