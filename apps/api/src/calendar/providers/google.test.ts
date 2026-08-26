import { describe, expect, it, vi } from "vitest";
import {
  exchangeGoogleAuthorizationCode,
  GoogleCalendarProvider,
  googleAuthorizationUrl,
  normalizeGoogleEvent,
  refreshGoogleAccessToken,
} from "./google";
import { hashCalendarDescription } from "./normalize";
import {
  CalendarFullResyncRequiredError,
  CalendarEventNotFoundError,
  CalendarPreconditionError,
  CalendarProviderError,
  CalendarReauthRequiredError,
  CalendarRetryableError,
  type CalendarFetch,
} from "./types";

function json(body: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function queuedFetch(...responses: Response[]): {
  fetcher: CalendarFetch;
  mock: ReturnType<typeof vi.fn>;
} {
  const mock = vi.fn(async () => responses.shift() ?? json({}));
  return { fetcher: mock as CalendarFetch, mock };
}

function googleEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "instance-1",
    etag: '"etag-1"',
    summary: "Boiler repair",
    description: "Bring ladder",
    start: {
      dateTime: "2026-11-01T09:00:00-07:00",
      timeZone: "America/Edmonton",
    },
    end: {
      dateTime: "2026-11-01T10:00:00-07:00",
      timeZone: "America/Edmonton",
    },
    organizer: { email: "owner@example.com", self: true },
    ...overrides,
  };
}

async function writeInput() {
  const description = "Bring ladder";
  return {
    accessToken: "access",
    calendarId: "primary",
    idempotencyKey: "11111111-2222-4333-8444-555555555555",
    connectedAccountEmail: "owner@example.com",
    description,
    schedule: {
      start: "2026-11-01T16:00:00.000Z",
      end: "2026-11-01T17:00:00.000Z",
      timeZone: "America/Edmonton",
      title: "Boiler repair",
      descriptionHash: await hashCalendarDescription(description),
    },
  };
}

describe("Google calendar provider", () => {
  it.each([
    {},
    { access_token: " " },
    { access_token: "access", refresh_token: 42 },
    { access_token: "access", expires_in: "3600" },
    { access_token: "access", scope: { value: "calendar" } },
  ])("rejects malformed token success payloads without exposing values", async (payload) => {
    const error = await refreshGoogleAccessToken(
      queuedFetch(json(payload)).fetcher,
      { clientId: "client", clientSecret: "secret", redirectUri: "https://api/cb" },
      "sensitive-refresh-token",
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(CalendarProviderError);
    expect(error).toMatchObject({
      provider: "google",
      kind: "response",
      operation: "parse token response",
      status: 200,
    });
    expect(String(error)).not.toContain("sensitive-refresh-token");
    expect(String(error)).not.toContain(JSON.stringify(payload));
  });

  it("classifies a non-JSON token 401 as reauthorization", async () => {
    await expect(
      refreshGoogleAccessToken(
        queuedFetch(new Response("unauthorized", { status: 401 })).fetcher,
        { clientId: "client", clientSecret: "secret", redirectUri: "https://api/cb" },
        "sensitive-refresh-token",
      ),
    ).rejects.toBeInstanceOf(CalendarReauthRequiredError);
  });

  it("normalizes timed events and refuses all-day events", async () => {
    const timed = await normalizeGoogleEvent(
      googleEvent(),
      "America/Edmonton",
      "owner@example.com",
    );
    expect(timed?.inbound).toMatchObject({
      kind: "scheduled",
      schedule: {
        start: "2026-11-01T16:00:00.000Z",
        timeZone: "America/Edmonton",
      },
    });
    expect(timed?.organizerIsConnectedAccount).toBe(true);

    const allDay = await normalizeGoogleEvent(
      googleEvent({ start: { date: "2026-11-01" }, end: { date: "2026-11-02" } }),
      "America/Edmonton",
    );
    expect(allDay?.inbound).toEqual({ kind: "all_day" });
  });

  it("retains guest and online-meeting safety metadata", async () => {
    const normalized = await normalizeGoogleEvent(
      googleEvent({
        attendees: [{ email: "guest@example.com" }],
        conferenceData: { conferenceId: "meet-1" },
      }),
      "America/Edmonton",
      "owner@example.com",
    );

    expect(normalized).toMatchObject({
      hasAttendees: true,
      hasOnlineMeeting: true,
    });
  });

  it("turns non-canonical titles into per-occurrence refusals", async () => {
    await expect(
      normalizeGoogleEvent(
        googleEvent({ summary: "  " }),
        "America/Edmonton",
      ),
    ).resolves.toMatchObject({
      inbound: { kind: "title_refused", reason: "empty" },
    });
    await expect(
      normalizeGoogleEvent(
        googleEvent({ summary: "🔧".repeat(501) }),
        "America/Edmonton",
      ),
    ).resolves.toMatchObject({
      inbound: { kind: "title_refused", reason: "too_long" },
    });
  });

  it("turns malformed timing into a per-occurrence refusal", async () => {
    await expect(
      normalizeGoogleEvent(
        googleEvent({ start: { dateTime: "not-a-time", timeZone: "America/Edmonton" } }),
        "America/Edmonton",
      ),
    ).resolves.toMatchObject({
      instanceId: "instance-1",
      inbound: { kind: "time_refused", reason: "invalid_time" },
    });
    await expect(
      normalizeGoogleEvent(
        googleEvent({
          start: { dateTime: "2026-11-01T10:00:00-07:00", timeZone: "America/Edmonton" },
          end: { dateTime: "2026-11-01T09:00:00-07:00", timeZone: "America/Edmonton" },
        }),
        "America/Edmonton",
      ),
    ).resolves.toMatchObject({
      inbound: { kind: "time_refused", reason: "invalid_range" },
    });
  });

  it("refuses descriptions above the task limit without truncating them", async () => {
    await expect(
      normalizeGoogleEvent(
        googleEvent({ description: "x".repeat(5_001) }),
        "America/Edmonton",
      ),
    ).resolves.toMatchObject({
      description: "x".repeat(5_001),
      inbound: { kind: "description_refused", reason: "too_long" },
    });
  });

  it("durably refuses a series master and stores only an occurrence id", async () => {
    await expect(
      normalizeGoogleEvent(
        googleEvent({ recurrence: ["RRULE:FREQ=WEEKLY"] }),
        "America/Edmonton",
      ),
    ).resolves.toMatchObject({ inbound: { kind: "recurrence_refused" } });
    const occurrence = await normalizeGoogleEvent(
      googleEvent({
        id: "occurrence-id",
        recurringEventId: "series-id",
        originalStartTime: { dateTime: "2026-11-01T09:00:00-07:00" },
      }),
      "America/Edmonton",
    );
    expect(occurrence?.instanceId).toBe("occurrence-id");
    expect(JSON.stringify(occurrence)).not.toContain("series-id");
  });

  it("uses the calendar IANA zone when the event omits one", async () => {
    const event = googleEvent({
      start: { dateTime: "2026-11-01T09:00:00" },
      end: { dateTime: "2026-11-01T10:00:00" },
    });
    const normalized = await normalizeGoogleEvent(event, "America/New_York");
    expect(normalized?.inbound).toMatchObject({
      kind: "scheduled",
      schedule: { start: "2026-11-01T14:00:00.000Z" },
    });
  });

  it("carries Google tokens while requesting content-free change notices", async () => {
    const { fetcher, mock } = queuedFetch(
      json({
        items: [
          googleEvent(),
          googleEvent({ id: "master", recurrence: ["RRULE:FREQ=DAILY"] }),
        ],
        timeZone: "America/Edmonton",
        nextPageToken: "page-2",
      }),
    );
    const provider = new GoogleCalendarProvider(fetcher);
    const page = await provider.listChanges({
      accessToken: "access",
      calendarId: "crew/a",
      cursor: "sync-1",
      pageToken: "page-1",
    });
    expect(page.events).toHaveLength(2);
    expect(page.nextPageToken).toBe("page-2");
    expect(page.nextCursor).toBeNull();
    const request = new URL(String(mock.mock.calls[0]?.[0]));
    expect(request.pathname).toContain("crew%2Fa");
    expect(request.searchParams.get("syncToken")).toBe("sync-1");
    expect(request.searchParams.get("pageToken")).toBe("page-1");
    expect(request.searchParams.get("singleEvents")).toBe("true");
    expect(request.searchParams.get("fields")).toBe(
      "items(id,etag,status),nextPageToken,nextSyncToken,timeZone",
    );
    expect(request.searchParams.get("fields")).not.toMatch(
      /summary|description|attendees|start|end/,
    );
  });

  it("skips id-less rows and advances a page containing malformed unrelated timing", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { fetcher } = queuedFetch(json({
      items: [
        googleEvent({ id: undefined }),
        googleEvent({ id: "bad-time", start: { dateTime: "bad", timeZone: "America/Edmonton" } }),
        googleEvent({ id: "valid" }),
      ],
      timeZone: "America/Edmonton",
      nextSyncToken: "cursor-after-malformed",
    }));

    const page = await new GoogleCalendarProvider(fetcher).listChanges({
      accessToken: "access",
      calendarId: "primary",
    });

    expect(page.events.map((event) => event.instanceId)).toEqual(["bad-time", "valid"]);
    expect(page.events[0]).toMatchObject({
      instanceId: "bad-time",
      removed: false,
    });
    expect(page.nextCursor).toBe("cursor-after-malformed");
    expect(warning).toHaveBeenCalledOnce();
    expect(warning).toHaveBeenCalledWith(
      "calendar change page skipped id-less provider events",
      { provider: "google", count: 1 },
    );
    warning.mockRestore();
  });

  it("turns an expired sync token into a typed full-resync result", async () => {
    const { fetcher } = queuedFetch(json({ error: "Gone" }, 410));
    const provider = new GoogleCalendarProvider(fetcher);
    await expect(
      provider.listChanges({
        accessToken: "access",
        calendarId: "primary",
        cursor: "expired",
      }),
    ).rejects.toBeInstanceOf(CalendarFullResyncRequiredError);
  });

  it("types 401 and 429 responses", async () => {
    const unauthorized = new GoogleCalendarProvider(
      queuedFetch(json({}, 401)).fetcher,
    );
    await expect(
      unauthorized.getEvent({
        accessToken: "bad",
        calendarId: "primary",
        instanceId: "event",
      }),
    ).rejects.toBeInstanceOf(CalendarReauthRequiredError);

    const throttled = new GoogleCalendarProvider(
      queuedFetch(json({}, 429, { "Retry-After": "3" })).fetcher,
    );
    const error = await throttled
      .getEvent({
        accessToken: "access",
        calendarId: "primary",
        instanceId: "event",
      })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(CalendarRetryableError);
    expect((error as CalendarRetryableError).retryAfterMs).toBe(3_000);
  });

  it("classifies a missing occurrence separately from authorization and retry errors", async () => {
    for (const status of [404, 410] as const) {
      const provider = new GoogleCalendarProvider(
        queuedFetch(json({}, status)).fetcher,
      );
      const error = await provider.getEvent({
        accessToken: "access",
        calendarId: "primary",
        instanceId: "missing",
      }).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(CalendarEventNotFoundError);
      expect(error).toMatchObject({ kind: "not_found", status });
    }
  });

  it("creates and patches without attendees and applies If-Match", async () => {
    const { fetcher, mock } = queuedFetch(
      json(googleEvent()),
      json(googleEvent({ etag: '"etag-2"' })),
    );
    const provider = new GoogleCalendarProvider(fetcher);
    const input = await writeInput();
    await provider.createEvent(input);
    await provider.patchEvent({
      ...input,
      instanceId: "instance-1",
      version: '"etag-1"',
    });

    const createInit = mock.mock.calls[0]?.[1] as RequestInit;
    const patchInit = mock.mock.calls[1]?.[1] as RequestInit;
    expect(createInit.method).toBe("POST");
    const createBody = JSON.parse(String(createInit.body)) as Record<
      string,
      unknown
    >;
    expect(createBody).not.toHaveProperty("attendees");
    expect(createBody.id).toMatch(/^[0-9a-f]{64}$/);
    expect(patchInit.method).toBe("PATCH");
    expect(new Headers(patchInit.headers).get("If-Match")).toBe('"etag-1"');
    expect(JSON.parse(String(patchInit.body))).not.toHaveProperty("attendees");
    expect("deleteEvent" in provider).toBe(true);
  });

  it("recovers an accepted create by its stable client event id", async () => {
    const eventIds: string[] = [];
    let createNumber = 0;
    const mock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { id: string };
        eventIds.push(body.id);
        createNumber += 1;
        return createNumber === 1
          ? json(googleEvent({ id: body.id }))
          : json({ error: "duplicate" }, 409);
      }
      const instanceId = decodeURIComponent(
        new URL(String(url)).pathname.split("/").at(-1) ?? "",
      );
      return json(googleEvent({ id: instanceId }));
    });
    const provider = new GoogleCalendarProvider(mock as CalendarFetch);
    const input = await writeInput();

    const first = await provider.createEvent(input);
    const recovered = await provider.createEvent(input);

    expect(eventIds).toHaveLength(2);
    expect(eventIds[0]).toBe(eventIds[1]);
    expect(eventIds[0]).toMatch(/^[0-9a-f]{64}$/);
    expect(first.instanceId).toBe(eventIds[0]);
    expect(recovered.instanceId).toBe(eventIds[0]);
    expect(mock).toHaveBeenCalledTimes(3);
    expect(String(mock.mock.calls[2]?.[0])).toContain(`/events/${eventIds[0]}`);
    expect((mock.mock.calls[2]?.[1] as RequestInit).method).toBeUndefined();
  });

  it("does not replay a failed conditional patch", async () => {
    const { fetcher, mock } = queuedFetch(json({}, 412));
    const provider = new GoogleCalendarProvider(fetcher);
    await expect(
      provider.patchEvent({
        ...(await writeInput()),
        instanceId: "instance-1",
        version: '"stale"',
      }),
    ).rejects.toBeInstanceOf(CalendarPreconditionError);
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it("annotates instead of deleting an event", async () => {
    const { fetcher, mock } = queuedFetch(json(googleEvent({ description: "Note\n\nRemoved" })));
    const provider = new GoogleCalendarProvider(fetcher);
    await provider.annotateAndUnlink({
      accessToken: "access",
      calendarId: "primary",
      instanceId: "instance-1",
      version: '"etag-1"',
      currentDescription: "Note",
      note: "Removed",
      calendarTimeZone: "America/Edmonton",
    });
    const init = mock.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({ description: "Note\n\nRemoved" });
  });

  it("deletes safe events without updates and scrubs meetings without schedule fields", async () => {
    const { fetcher, mock } = queuedFetch(
      new Response(null, { status: 204 }),
      json(googleEvent({
        summary: "Loonext event removed",
        description: "",
        attendees: [{ email: "guest@example.com" }],
      })),
    );
    const provider = new GoogleCalendarProvider(fetcher);
    const base = {
      accessToken: "access",
      calendarId: "primary",
      instanceId: "instance-1",
      version: '"etag-1"',
      calendarTimeZone: "America/Edmonton",
      connectedAccountEmail: "owner@example.com",
    };

    await provider.deleteEvent(base);
    await provider.scrubEvent(base);

    const deleteUrl = new URL(String(mock.mock.calls[0]?.[0]));
    const deleteInit = mock.mock.calls[0]?.[1] as RequestInit;
    expect(deleteInit.method).toBe("DELETE");
    expect(deleteUrl.searchParams.get("sendUpdates")).toBe("none");
    expect(new Headers(deleteInit.headers).get("If-Match")).toBe('"etag-1"');
    const scrubUrl = new URL(String(mock.mock.calls[1]?.[0]));
    const scrubInit = mock.mock.calls[1]?.[1] as RequestInit;
    expect(scrubInit.method).toBe("PATCH");
    expect(scrubUrl.searchParams.get("sendUpdates")).toBe("none");
    expect(JSON.parse(String(scrubInit.body))).toEqual({
      summary: "Loonext event removed",
      description: "",
    });
  });

  it("builds PKCE authorization and token exchange/refresh requests", async () => {
    const authorization = new URL(
      googleAuthorizationUrl({
        clientId: "client",
        redirectUri: "https://app.example/callback",
        state: "state",
        codeChallenge: "challenge",
      }),
    );
    expect(authorization.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorization.searchParams.get("scope")).toBe(
      "https://www.googleapis.com/auth/calendar.events.owned " +
        "https://www.googleapis.com/auth/calendar.calendars.readonly",
    );

    const { fetcher, mock } = queuedFetch(
      json({ access_token: "a", refresh_token: "r", expires_in: 3600 }),
      json({ access_token: "a2", expires_in: 3600 }),
    );
    const client = {
      clientId: "client",
      clientSecret: "secret",
      redirectUri: "https://app.example/callback",
    };
    await expect(
      exchangeGoogleAuthorizationCode(fetcher, client, "code", "verifier"),
    ).resolves.toMatchObject({ accessToken: "a", refreshToken: "r" });
    await expect(
      refreshGoogleAccessToken(fetcher, client, "r"),
    ).resolves.toMatchObject({ accessToken: "a2", refreshToken: "r" });
    expect(String((mock.mock.calls[0]?.[1] as RequestInit).body)).toContain(
      "code_verifier=verifier",
    );
  });

  it("establishes replacement channels before stopping old watches", async () => {
    const expiration = String(Date.parse("2026-11-01T00:00:00Z"));
    const { fetcher, mock } = queuedFetch(
      json({ id: "channel-1", resourceId: "resource-1", expiration }),
      json({ id: "channel-2", resourceId: "resource-2", expiration }),
      new Response(null, { status: 204 }),
    );
    const provider = new GoogleCalendarProvider(fetcher);
    const base = {
      accessToken: "access",
      calendarId: "primary",
      callbackUrl: "https://api.example/webhooks/calendar",
      subscriptionId: "channel-1",
      clientState: "secret-state",
      expiration: "2026-11-01T00:00:00Z",
    };
    await provider.startWatch(base);
    await provider.renewWatch({
      ...base,
      subscriptionId: "channel-2",
      currentSubscriptionId: "channel-1",
    });
    await provider.stopWatch({
      accessToken: "access",
      subscriptionId: "channel-1",
      resourceId: "resource-1",
    });
    expect((mock.mock.calls[0]?.[1] as RequestInit).method).toBe("POST");
    expect((mock.mock.calls[1]?.[1] as RequestInit).method).toBe("POST");
    expect((mock.mock.calls[2]?.[1] as RequestInit).method).toBe("POST");
    expect(JSON.parse(String((mock.mock.calls[2]?.[1] as RequestInit).body))).toEqual({
      id: "channel-1",
      resourceId: "resource-1",
    });
  });

  it.each([404, 410] as const)(
    "treats an already-gone Google watch (%s) as stopped",
    async (status) => {
      const provider = new GoogleCalendarProvider(
        queuedFetch(json({}, status)).fetcher,
      );
      await expect(provider.stopWatch({
        accessToken: "access",
        subscriptionId: "channel-1",
        resourceId: "resource-1",
      })).resolves.toBeUndefined();
    },
  );
});
