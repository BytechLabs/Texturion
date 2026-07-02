import { afterEach, describe, expect, it, vi } from "vitest";

import { telnyxRequest, TelnyxApiError } from "./client";
import { completeEnv, stubFetch } from "../test/support";

const env = completeEnv();

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("telnyxRequest", () => {
  it("sends bearer auth + JSON body and returns the parsed response", async () => {
    let captured: Request | undefined;
    stubFetch(async (url, request) => {
      if (url.origin !== "https://api.telnyx.com") return undefined;
      captured = request.clone();
      return Response.json({ data: { id: "profile-1" } });
    });

    const result = await telnyxRequest<{ data: { id: string } }>(env, {
      method: "POST",
      path: "/v2/messaging_profiles",
      body: { name: "co-1" },
    });

    expect(result.data.id).toBe("profile-1");
    expect(captured).toBeDefined();
    expect(captured?.headers.get("Authorization")).toBe(
      `Bearer ${env.TELNYX_API_KEY}`,
    );
    expect(captured?.headers.get("Content-Type")).toBe("application/json");
    expect(await captured?.json()).toEqual({ name: "co-1" });
  });

  it("encodes query params (filter[...] keys verbatim)", async () => {
    let seen: URL | undefined;
    stubFetch((url) => {
      if (url.origin !== "https://api.telnyx.com") return undefined;
      seen = url;
      return Response.json({ data: [] });
    });

    await telnyxRequest(env, {
      method: "GET",
      path: "/v2/available_phone_numbers",
      query: {
        "filter[country_code]": "US",
        "filter[national_destination_code]": "212",
      },
    });

    expect(seen?.searchParams.get("filter[country_code]")).toBe("US");
    expect(seen?.searchParams.get("filter[national_destination_code]")).toBe(
      "212",
    );
  });

  it("surfaces Telnyx error codes on non-2xx", async () => {
    stubFetch((url) =>
      url.origin === "https://api.telnyx.com"
        ? Response.json(
            {
              errors: [
                { code: "40300", title: "Blocked", detail: "STOP recipient" },
                { code: "40012", title: "Other" },
              ],
            },
            { status: 400 },
          )
        : undefined,
    );

    const failure = await telnyxRequest(env, {
      method: "POST",
      path: "/v2/messages",
      body: {},
    }).catch((cause: unknown) => cause);

    expect(failure).toBeInstanceOf(TelnyxApiError);
    const error = failure as TelnyxApiError;
    expect(error.status).toBe(400);
    expect(error.codes).toEqual(["40300", "40012"]);
    expect(error.hasCode("40300")).toBe(true);
    expect(error.message).toContain("40300");
    expect(error.message).toContain("POST /v2/messages");
  });

  it("tolerates a non-JSON error body", async () => {
    stubFetch((url) =>
      url.origin === "https://api.telnyx.com"
        ? new Response("<html>bad gateway</html>", { status: 502 })
        : undefined,
    );
    const failure = await telnyxRequest(env, {
      method: "GET",
      path: "/v2/phone_numbers",
    }).catch((cause: unknown) => cause);
    expect(failure).toBeInstanceOf(TelnyxApiError);
    expect((failure as TelnyxApiError).status).toBe(502);
    expect((failure as TelnyxApiError).codes).toEqual([]);
  });

  it("returns undefined for empty 2xx bodies (DELETE 204)", async () => {
    stubFetch((url) =>
      url.origin === "https://api.telnyx.com"
        ? new Response(null, { status: 204 })
        : undefined,
    );
    const result = await telnyxRequest(env, {
      method: "DELETE",
      path: "/v2/phone_numbers/pn-1",
    });
    expect(result).toBeUndefined();
  });
});
