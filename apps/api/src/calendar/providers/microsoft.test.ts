import { describe, expect, it, vi } from "vitest";
import {
  exchangeMicrosoftAuthorizationCode,
  MicrosoftCalendarProvider,
  microsoftAuthorizationUrl,
  normalizeMicrosoftEvent,
  refreshMicrosoftAccessToken,
} from "./microsoft";
import { hashCalendarDescription } from "./normalize";
import {
  CalendarPreconditionError,
  CalendarEventNotFoundError,
  CalendarProviderError,
  CalendarReauthRequiredError,
  CalendarRetryableError,
  InvalidCalendarEventError,
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

function graphEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "occurrence-id",
    changeKey: "change-1",
    "@odata.etag": 'W/"change-1"',
    type: "singleInstance",
    subject: "Boiler repair",
    body: { contentType: "text", content: "Bring ladder" },
    start: { dateTime: "2026-11-01T16:00:00", timeZone: "UTC" },
    end: { dateTime: "2026-11-01T17:00:00", timeZone: "UTC" },
    organizer: { emailAddress: { address: "owner@example.com" } },
    isOrganizer: true,
    ...overrides,
  };
}

async function writeInput() {
  const description = "Bring ladder";
  return {
    accessToken: "access",
    calendarId: "crew/a",
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

describe("Microsoft calendar provider", () => {
  it.each([
    {},
    { access_token: " " },
    { access_token: "access", refresh_token: 42 },
    { access_token: "access", expires_in: "3600" },
    { access_token: "access", scope: { value: "calendar" } },
  ])("rejects malformed token success payloads without exposing values", async (payload) => {
    const error = await refreshMicrosoftAccessToken(
      queuedFetch(json(payload)).fetcher,
      { clientId: "client", clientSecret: "secret", redirectUri: "https://api/cb" },
      "sensitive-refresh-token",
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(CalendarProviderError);
    expect(error).toMatchObject({
      provider: "microsoft",
      kind: "response",
      operation: "parse token response",
      status: 200,
    });
    expect(String(error)).not.toContain("sensitive-refresh-token");
    expect(String(error)).not.toContain(JSON.stringify(payload));
  });

  it("classifies a non-JSON token 401 as reauthorization", async () => {
    await expect(
      refreshMicrosoftAccessToken(
        queuedFetch(new Response("unauthorized", { status: 401 })).fetcher,
        { clientId: "client", clientSecret: "secret", redirectUri: "https://api/cb" },
        "sensitive-refresh-token",
      ),
    ).rejects.toBeInstanceOf(CalendarReauthRequiredError);
  });

  it("maps Windows zones and resolves DST at the event date", async () => {
    const normalized = await normalizeMicrosoftEvent(
      graphEvent({
        start: { dateTime: "2026-11-01T09:00:00", timeZone: "Eastern Standard Time" },
        end: { dateTime: "2026-11-01T10:00:00", timeZone: "Eastern Standard Time" },
      }),
      "owner@example.com",
    );
    expect(normalized?.inbound).toMatchObject({
      kind: "scheduled",
      schedule: {
        start: "2026-11-01T14:00:00.000Z",
        end: "2026-11-01T15:00:00.000Z",
        timeZone: "America/New_York",
      },
    });
    expect(normalized?.organizerIsConnectedAccount).toBe(true);
  });

  it("preserves the second occurrence of an overlapping wall clock from a UTC response", async () => {
    const normalized = await normalizeMicrosoftEvent(
      graphEvent({
        start: { dateTime: "2026-11-01T08:30:00", timeZone: "UTC" },
        end: { dateTime: "2026-11-01T09:30:00", timeZone: "UTC" },
      }),
      "owner@example.com",
      "America/Edmonton",
    );

    expect(normalized?.inbound).toMatchObject({
      kind: "scheduled",
      schedule: {
        start: "2026-11-01T08:30:00.000Z",
        end: "2026-11-01T09:30:00.000Z",
        timeZone: "America/Edmonton",
      },
    });
  });

  it("retains guest and Teams-meeting safety metadata", async () => {
    const normalized = await normalizeMicrosoftEvent(
      graphEvent({
        attendees: [{ emailAddress: { address: "guest@example.com" } }],
        isOnlineMeeting: true,
        onlineMeetingProvider: "teamsForBusiness",
        body: {
          contentType: "html",
          // Provider-injected Teams bodies can exceed the task limit. They are
          // opaque metadata, so they must not block honest time/title sync.
          content: `<p>${"meeting blob ".repeat(500)}</p>`,
        },
      }),
      "owner@example.com",
      "America/Edmonton",
    );

    expect(normalized).toMatchObject({
      hasAttendees: true,
      hasOnlineMeeting: true,
      inbound: { kind: "scheduled" },
    });
  });

  it("persists Graph's entity tag and sends it unchanged on every conditional write", async () => {
    const etag = 'W/"CQAAABYAAABc"';
    const normalized = await normalizeMicrosoftEvent(graphEvent({
      changeKey: "raw-change-key",
      "@odata.etag": etag,
    }));
    expect(normalized?.version).toBe(etag);
    await expect(normalizeMicrosoftEvent(graphEvent({
      changeKey: "raw-change-key",
      "@odata.etag": undefined,
    }))).resolves.toMatchObject({ version: 'W/"raw-change-key"' });
    await expect(normalizeMicrosoftEvent(graphEvent({
      changeKey: undefined,
      "@odata.etag": undefined,
    }))).rejects.toBeInstanceOf(InvalidCalendarEventError);

    const { fetcher, mock } = queuedFetch(
      json(graphEvent({ "@odata.etag": etag })),
      json(graphEvent({ "@odata.etag": etag })),
      json(graphEvent({ "@odata.etag": etag })),
      new Response(null, { status: 204 }),
    );
    const provider = new MicrosoftCalendarProvider(fetcher);
    const write = await writeInput();
    await provider.patchEvent({
      ...write,
      instanceId: "occurrence-id",
      version: etag,
    });
    await provider.annotateAndUnlink({
      accessToken: "access",
      calendarId: "crew/a",
      instanceId: "occurrence-id",
      version: etag,
      currentDescription: "Bring ladder",
      note: "Removed",
    });
    await provider.scrubEvent({
      accessToken: "access",
      calendarId: "crew/a",
      instanceId: "occurrence-id",
      version: etag,
    });
    await provider.deleteEvent({
      accessToken: "access",
      calendarId: "crew/a",
      instanceId: "occurrence-id",
      version: etag,
    });

    for (const call of mock.mock.calls) {
      expect(new Headers((call[1] as RequestInit).headers).get("If-Match")).toBe(
        etag,
      );
    }
  });

  it("refuses unknown zones and all-day events without inventing an instant", async () => {
    const unknown = await normalizeMicrosoftEvent(
      graphEvent({
        start: { dateTime: "2026-11-01T09:00:00", timeZone: "Mars Standard Time" },
      }),
    );
    expect(unknown?.inbound).toEqual({
      kind: "zone_refused",
      providerZone: "Mars Standard Time",
    });
    const allDay = await normalizeMicrosoftEvent(
      graphEvent({ isAllDay: true }),
    );
    expect(allDay?.inbound).toEqual({ kind: "all_day" });
  });

  it("turns non-canonical titles into per-occurrence refusals", async () => {
    await expect(
      normalizeMicrosoftEvent(graphEvent({ subject: "\t" })),
    ).resolves.toMatchObject({
      inbound: { kind: "title_refused", reason: "empty" },
    });
    await expect(
      normalizeMicrosoftEvent(graphEvent({ subject: "x".repeat(501) })),
    ).resolves.toMatchObject({
      inbound: { kind: "title_refused", reason: "too_long" },
    });
  });

  it("requests text bodies and never copies Graph HTML markup into task content", async () => {
    const normalized = await normalizeMicrosoftEvent(graphEvent({
      body: {
        contentType: "html",
        content:
          "<p>Gate &amp; <strong>access</strong></p><div>Bring&nbsp;ladder</div><script>secret()</script>",
      },
    }));
    expect(normalized?.description).toBe("Gate & access\nBring ladder");
    expect(normalized?.description).not.toMatch(/<[^>]+>|secret\(\)/);
    expect(normalized?.descriptionFormat).toBe("html");
    expect(normalized?.rawDescription).toContain("<strong>access</strong>");

    const { fetcher, mock } = queuedFetch(json(graphEvent()));
    await new MicrosoftCalendarProvider(fetcher).getEvent({
      accessToken: "access",
      calendarId: "primary",
      instanceId: "occurrence-id",
      calendarTimeZone: "America/Edmonton",
    });
    const prefer = new Headers(
      (mock.mock.calls[0]?.[1] as RequestInit).headers,
    ).get("Prefer");
    expect(prefer).toContain('outlook.body-content-type="text"');
    expect(prefer).toContain('IdType="ImmutableId"');
    expect(prefer).not.toContain("outlook.timezone");
  });

  it("can fetch the original HTML body for a format-preserving unlink", async () => {
    const html = "<div><strong>Customer</strong> note</div>";
    const { fetcher, mock } = queuedFetch(json(graphEvent({
      body: { contentType: "html", content: html },
    })));

    const event = await new MicrosoftCalendarProvider(fetcher).getEvent({
      accessToken: "access",
      calendarId: "primary",
      instanceId: "occurrence-id",
      calendarTimeZone: "America/Edmonton",
      preserveDescriptionFormatting: true,
    });

    const prefer = new Headers(
      (mock.mock.calls[0]?.[1] as RequestInit).headers,
    ).get("Prefer");
    expect(prefer).toContain('outlook.body-content-type="html"');
    expect(event.description).toBe("Customer note");
    expect(event.rawDescription).toBe(html);
    expect(event.descriptionFormat).toBe("html");
  });

  it("turns malformed timing into a per-occurrence refusal", async () => {
    await expect(
      normalizeMicrosoftEvent(graphEvent({
        start: { dateTime: "not-a-time", timeZone: "Mountain Standard Time" },
      })),
    ).resolves.toMatchObject({
      instanceId: "occurrence-id",
      inbound: { kind: "time_refused", reason: "invalid_time" },
    });
    await expect(
      normalizeMicrosoftEvent(graphEvent({
        start: { dateTime: "2026-11-01T10:00:00", timeZone: "Mountain Standard Time" },
        end: { dateTime: "2026-11-01T09:00:00", timeZone: "Mountain Standard Time" },
      })),
    ).resolves.toMatchObject({
      inbound: { kind: "time_refused", reason: "invalid_range" },
    });
  });

  it("refuses descriptions above the task limit without truncating them", async () => {
    await expect(
      normalizeMicrosoftEvent(
        graphEvent({
          body: { contentType: "text", content: "x".repeat(5_001) },
        }),
      ),
    ).resolves.toMatchObject({
      description: "x".repeat(5_001),
      inbound: { kind: "description_refused", reason: "too_long" },
    });
  });

  it("durably refuses series masters and keeps the instance id for occurrences", async () => {
    await expect(
      normalizeMicrosoftEvent(graphEvent({ type: "seriesMaster", id: "series-id" })),
    ).resolves.toMatchObject({ inbound: { kind: "recurrence_refused" } });
    const occurrence = await normalizeMicrosoftEvent(
      graphEvent({
        type: "occurrence",
        id: "occurrence-id",
        seriesMasterId: "series-id",
      }),
    );
    expect(occurrence?.instanceId).toBe("occurrence-id");
    expect(JSON.stringify(occurrence)).not.toContain("series-id");
  });

  it("returns removals from sparse Graph delta tombstones", async () => {
    const removed = await normalizeMicrosoftEvent({
      id: "occurrence-id",
      "@removed": { reason: "deleted" },
    });
    expect(removed).toMatchObject({
      instanceId: "occurrence-id",
      inbound: { kind: "removed" },
    });
  });

  it("follows opaque Graph next links and returns the final delta cursor", async () => {
    const nextLink =
      "https://graph.microsoft.com/v1.0/me/calendarView/delta?$skiptoken=opaque";
    const deltaLink =
      "https://graph.microsoft.com/v1.0/me/calendarView/delta?$deltatoken=durable";
    const { fetcher, mock } = queuedFetch(
      json({ value: [graphEvent()], "@odata.nextLink": nextLink }),
      json({ value: [], "@odata.deltaLink": deltaLink }),
    );
    const provider = new MicrosoftCalendarProvider(fetcher);
    const first = await provider.listChanges({
      accessToken: "access",
      calendarId: "crew/a",
      calendarTimeZone: "America/Edmonton",
      rangeStart: "2026-01-01T00:00:00Z",
      rangeEnd: "2027-01-01T00:00:00Z",
    });
    expect(first.nextPageToken).toBe(nextLink);
    expect(first.nextCursor).toBeNull();
    const firstUrl = new URL(String(mock.mock.calls[0]?.[0]));
    expect(firstUrl.pathname).toContain("crew%2Fa/calendarView/delta");
    expect(firstUrl.searchParams.get("startDateTime")).toBe(
      "2026-01-01T00:00:00Z",
    );
    expect(firstUrl.searchParams.get("$select")).toBe(
      "id,changeKey,isCancelled,type",
    );
    expect(firstUrl.searchParams.get("$select")).not.toMatch(
      /subject|body|attendees|start|end/,
    );

    const second = await provider.listChanges({
      accessToken: "access",
      calendarId: "ignored-for-opaque-link",
      calendarTimeZone: "America/Edmonton",
      pageToken: first.nextPageToken ?? undefined,
    });
    expect(String(mock.mock.calls[1]?.[0])).toBe(nextLink);
    expect(second.nextPageToken).toBeNull();
    expect(second.nextCursor).toBe(deltaLink);
    for (const call of mock.mock.calls) {
      const prefer = new Headers((call[1] as RequestInit).headers).get("Prefer");
      expect(prefer).toContain('IdType="ImmutableId"');
      expect(prefer).not.toContain("outlook.timezone");
      expect(prefer).toContain("odata.maxpagesize=500");
    }
  });

  it("skips id-less rows and advances a delta page containing malformed unrelated timing", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const deltaLink =
      "https://graph.microsoft.com/v1.0/me/calendarView/delta?$deltatoken=after-malformed";
    const { fetcher } = queuedFetch(json({
      value: [
        graphEvent({ id: undefined }),
        graphEvent({ id: "bad-time", start: { dateTime: "bad", timeZone: "Mountain Standard Time" } }),
        graphEvent({ id: "valid" }),
      ],
      "@odata.deltaLink": deltaLink,
    }));

    const page = await new MicrosoftCalendarProvider(fetcher).listChanges({
      accessToken: "access",
      calendarId: "primary",
      rangeStart: "2026-01-01T00:00:00Z",
      rangeEnd: "2027-01-01T00:00:00Z",
    });

    expect(page.events.map((event) => event.instanceId)).toEqual(["bad-time", "valid"]);
    expect(page.events[0]).toMatchObject({
      instanceId: "bad-time",
      removed: false,
    });
    expect(page.nextCursor).toBe(deltaLink);
    expect(warning).toHaveBeenCalledOnce();
    expect(warning).toHaveBeenCalledWith(
      "calendar change page skipped id-less provider events",
      { provider: "microsoft", count: 1 },
    );
    warning.mockRestore();
  });

  it("requests and canonicalizes GET responses in the selected schedule zone", async () => {
    const { fetcher, mock } = queuedFetch(
      json(
        graphEvent({
          start: { dateTime: "2026-11-01T16:00:00", timeZone: "UTC" },
          end: { dateTime: "2026-11-01T17:00:00", timeZone: "UTC" },
        }),
      ),
    );
    const provider = new MicrosoftCalendarProvider(fetcher);

    const event = await provider.getEvent({
      accessToken: "access",
      calendarId: "crew/a",
      instanceId: "occurrence-id",
      calendarTimeZone: "America/Edmonton",
    });

    expect(event.inbound).toMatchObject({
      kind: "scheduled",
      schedule: {
        start: "2026-11-01T16:00:00.000Z",
        timeZone: "America/Edmonton",
      },
    });
    expect(new URL(String(mock.mock.calls[0]?.[0])).pathname).toBe(
      "/v1.0/me/calendars/crew%2Fa/events/occurrence-id",
    );
    const prefer = new Headers(
      (mock.mock.calls[0]?.[1] as RequestInit).headers,
    ).get("Prefer");
    expect(prefer).toContain('IdType="ImmutableId"');
    expect(prefer).not.toContain("outlook.timezone");
  });

  it("rejects a forged delta link instead of issuing an SSRF request", async () => {
    const { fetcher, mock } = queuedFetch(json({}));
    const provider = new MicrosoftCalendarProvider(fetcher);
    await expect(
      provider.listChanges({
        accessToken: "access",
        calendarId: "primary",
        cursor: "https://example.test/steal-token",
      }),
    ).rejects.toBeInstanceOf(InvalidCalendarEventError);
    expect(mock).not.toHaveBeenCalled();
  });

  it("types 401 and 429 responses", async () => {
    const unauthorized = new MicrosoftCalendarProvider(
      queuedFetch(json({}, 401)).fetcher,
    );
    await expect(
      unauthorized.getEvent({
        accessToken: "bad",
        calendarId: "primary",
        instanceId: "event",
      }),
    ).rejects.toBeInstanceOf(CalendarReauthRequiredError);

    const throttled = new MicrosoftCalendarProvider(
      queuedFetch(json({}, 429, { "Retry-After": "2" })).fetcher,
    );
    const error = await throttled
      .getEvent({
        accessToken: "access",
        calendarId: "primary",
        instanceId: "event",
      })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(CalendarRetryableError);
    expect((error as CalendarRetryableError).retryAfterMs).toBe(2_000);
  });

  it("classifies a missing occurrence separately from authorization and retry errors", async () => {
    for (const status of [404, 410] as const) {
      const provider = new MicrosoftCalendarProvider(
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

  it("creates and patches without attendees using exact UTC instants and If-Match", async () => {
    const { fetcher, mock } = queuedFetch(
      json(graphEvent()),
      json(graphEvent({ changeKey: "change-2" })),
    );
    const provider = new MicrosoftCalendarProvider(fetcher);
    const input = await writeInput();
    await provider.createEvent(input);
    await provider.patchEvent({
      ...input,
      instanceId: "occurrence-id",
      version: "change-1",
    });

    const createInit = mock.mock.calls[0]?.[1] as RequestInit;
    const createBody = JSON.parse(String(createInit.body)) as Record<string, unknown>;
    expect(createBody).not.toHaveProperty("attendees");
    expect(createBody).toMatchObject({
      transactionId: input.idempotencyKey,
      start: {
        dateTime: "2026-11-01T16:00:00",
        timeZone: "UTC",
      },
    });
    const patchInit = mock.mock.calls[1]?.[1] as RequestInit;
    expect(new Headers(createInit.headers).get("Prefer")).not.toContain(
      "outlook.timezone",
    );
    expect(new Headers(patchInit.headers).get("If-Match")).toBe("change-1");
    expect(new Headers(patchInit.headers).get("Prefer")).not.toContain(
      "outlook.timezone",
    );
    expect(JSON.parse(String(patchInit.body))).not.toHaveProperty("attendees");
    expect("deleteEvent" in provider).toBe(true);
  });

  it.each([
    ["first", "2026-11-01T07:30:00.000Z", "2026-11-01T08:30:00.000Z"],
    ["second", "2026-11-01T08:30:00.000Z", "2026-11-01T09:30:00.000Z"],
  ] as const)(
    "writes the %s Edmonton 01:30 fold as its distinct UTC instant",
    async (_fold, start, end) => {
      const { fetcher, mock } = queuedFetch(json(graphEvent({
        start: { dateTime: start.replace(".000Z", ""), timeZone: "UTC" },
        end: { dateTime: end.replace(".000Z", ""), timeZone: "UTC" },
      })));
      const provider = new MicrosoftCalendarProvider(fetcher);
      const input = await writeInput();

      await provider.createEvent({
        ...input,
        schedule: { ...input.schedule, start, end },
      });

      const body = JSON.parse(
        String((mock.mock.calls[0]?.[1] as RequestInit).body),
      ) as Record<string, { dateTime?: string; timeZone?: string }>;
      expect(body.start).toEqual({
        dateTime: start.replace(".000Z", ""),
        timeZone: "UTC",
      });
      expect(body.end).toEqual({
        dateTime: end.replace(".000Z", ""),
        timeZone: "UTC",
      });
    },
  );

  it("does not replay a 409 conditional patch", async () => {
    const { fetcher, mock } = queuedFetch(json({}, 409));
    const provider = new MicrosoftCalendarProvider(fetcher);
    await expect(
      provider.patchEvent({
        ...(await writeInput()),
        instanceId: "occurrence-id",
        version: "stale",
      }),
    ).rejects.toBeInstanceOf(CalendarPreconditionError);
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it("annotates the event body instead of deleting the event", async () => {
    const { fetcher, mock } = queuedFetch(
      json(graphEvent({ body: { contentType: "text", content: "Note\n\nRemoved" } })),
    );
    const provider = new MicrosoftCalendarProvider(fetcher);
    await provider.annotateAndUnlink({
      accessToken: "access",
      calendarId: "primary",
      instanceId: "occurrence-id",
      version: "change-1",
      currentDescription: "Note",
      note: "Removed",
      calendarTimeZone: "America/Edmonton",
    });
    const init = mock.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe("PATCH");
    expect(new Headers(init.headers).get("Prefer")).not.toContain(
      "outlook.timezone",
    );
    expect(JSON.parse(String(init.body))).toEqual({
      body: { contentType: "text", content: "Note\n\nRemoved" },
    });
  });

  it("appends an escaped unlink note without flattening an existing HTML body", async () => {
    const { fetcher, mock } = queuedFetch(json(graphEvent({
      body: {
        contentType: "html",
        content: "<p><strong>Customer</strong> note</p><p>Removed &lt;safely&gt;</p>",
      },
    })));
    const provider = new MicrosoftCalendarProvider(fetcher);

    await provider.annotateAndUnlink({
      accessToken: "access",
      calendarId: "primary",
      instanceId: "occurrence-id",
      version: "change-1",
      currentDescription: "<p><strong>Customer</strong> note</p>",
      descriptionFormat: "html",
      note: "Removed <safely>",
      calendarTimeZone: "America/Edmonton",
    });

    expect(JSON.parse(String(mock.mock.calls[0]?.[1]?.body))).toEqual({
      body: {
        contentType: "html",
        content:
          "<p><strong>Customer</strong> note</p><p>Removed &lt;safely&gt;</p>",
      },
    });
  });

  it("deletes safe events conditionally and scrubs meetings without schedule fields", async () => {
    const { fetcher, mock } = queuedFetch(
      new Response(null, { status: 204 }),
      json(graphEvent({
        subject: "Loonext event removed",
        body: { contentType: "text", content: "" },
        attendees: [{ emailAddress: { address: "guest@example.com" } }],
      })),
    );
    const provider = new MicrosoftCalendarProvider(fetcher);
    const base = {
      accessToken: "access",
      calendarId: "primary",
      instanceId: "occurrence-id",
      version: "change-1",
      calendarTimeZone: "America/Edmonton",
      connectedAccountEmail: "owner@example.com",
    };

    await provider.deleteEvent(base);
    await provider.scrubEvent(base);

    const deleteInit = mock.mock.calls[0]?.[1] as RequestInit;
    expect(deleteInit.method).toBe("DELETE");
    expect(new Headers(deleteInit.headers).get("If-Match")).toBe("change-1");
    const scrubInit = mock.mock.calls[1]?.[1] as RequestInit;
    expect(scrubInit.method).toBe("PATCH");
    expect(JSON.parse(String(scrubInit.body))).toEqual({
      subject: "Loonext event removed",
      body: { contentType: "text", content: "" },
    });
  });

  it("creates, renews, and stops Graph subscriptions", async () => {
    const { fetcher, mock } = queuedFetch(
      json({ id: "sub-1", resource: "calendar", expirationDateTime: "2026-11-01T00:00:00Z" }),
      json({ id: "sub-1", resource: "calendar", expirationDateTime: "2026-11-02T00:00:00Z" }),
      new Response(null, { status: 204 }),
    );
    const provider = new MicrosoftCalendarProvider(fetcher);
    const base = {
      accessToken: "access",
      calendarId: "primary",
      callbackUrl: "https://api.example/webhooks/calendar",
      subscriptionId: "client-id",
      clientState: "secret-state",
      expiration: "2026-11-01T00:00:00Z",
    };
    await provider.startWatch(base);
    await provider.renewWatch({
      ...base,
      currentSubscriptionId: "sub-1",
      expiration: "2026-11-02T00:00:00Z",
    });
    await provider.stopWatch({ accessToken: "access", subscriptionId: "sub-1" });
    expect((mock.mock.calls[0]?.[1] as RequestInit).method).toBe("POST");
    expect(
      JSON.parse(String((mock.mock.calls[0]?.[1] as RequestInit).body)),
    ).toMatchObject({ resource: "/me/events" });
    expect((mock.mock.calls[1]?.[1] as RequestInit).method).toBe("PATCH");
    expect((mock.mock.calls[2]?.[1] as RequestInit).method).toBe("DELETE");
    for (const call of mock.mock.calls) {
      expect(
        new Headers((call[1] as RequestInit).headers).get("Prefer"),
      ).toContain('IdType="ImmutableId"');
    }
  });

  it.each([404, 410] as const)(
    "treats an already-gone Graph subscription (%s) as stopped",
    async (status) => {
      const provider = new MicrosoftCalendarProvider(
        queuedFetch(json({}, status)).fetcher,
      );
      await expect(provider.stopWatch({
        accessToken: "access",
        subscriptionId: "sub-1",
      })).resolves.toBeUndefined();
    },
  );

  it("builds PKCE authorization and token exchange/refresh requests", async () => {
    const authorization = new URL(
      microsoftAuthorizationUrl({
        clientId: "client",
        redirectUri: "https://app.example/callback",
        state: "state",
        codeChallenge: "challenge",
      }),
    );
    expect(authorization.pathname).toContain("/common/oauth2/v2.0/authorize");
    expect(authorization.searchParams.get("scope")).toBe(
      "offline_access Calendars.ReadWrite",
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
      exchangeMicrosoftAuthorizationCode(fetcher, client, "code", "verifier"),
    ).resolves.toMatchObject({ accessToken: "a", refreshToken: "r" });
    await expect(
      refreshMicrosoftAccessToken(fetcher, client, "r"),
    ).resolves.toMatchObject({ accessToken: "a2", refreshToken: "r" });
    expect(String((mock.mock.calls[0]?.[1] as RequestInit).body)).toContain(
      "code_verifier=verifier",
    );
  });
});
