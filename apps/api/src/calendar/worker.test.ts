import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CalendarCredentialRefreshUnavailableError } from "./authorization";
import { openCalendarCredential, sealCalendarCredential } from "./crypto";
import {
  CalendarFullResyncRequiredError,
  CalendarEventNotFoundError,
  CalendarPreconditionError,
  CalendarReauthRequiredError,
  type CalendarChangeNotice,
  type CalendarProvider,
  type CalendarRemoteEvent,
} from "./providers/types";
import type { CalendarScheduleSnapshot } from "./sync";
import {
  calendarAuthorizer,
  calendarOwnerDisclosurePayload,
  createCalendarSyncStore,
  drainCalendarSync,
  type CalendarConnectionRow,
  type CalendarLinkRow,
  type CalendarOutboxRow,
  type CalendarOwnerDisclosureRow,
  type CalendarReminderReplanRow,
  type CalendarSyncStore,
  type CalendarTaskRow,
  type CalendarWebhookSubscriptionRow,
} from "./worker";
import { completeEnv } from "../test/support";
import type { Env } from "../env";

const KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

function configuredEnv(): Env {
  return {
    ...completeEnv(),
    GOOGLE_CALENDAR_CLIENT_ID: "google-client",
    GOOGLE_CALENDAR_CLIENT_SECRET: "google-secret",
    MICROSOFT_CALENDAR_CLIENT_ID: "microsoft-client",
    MICROSOFT_CALENDAR_CLIENT_SECRET: "microsoft-secret",
    CALENDAR_TOKEN_ENCRYPTION_KEYS: JSON.stringify({ v1: KEY }),
    CALENDAR_TOKEN_ENCRYPTION_ACTIVE_KEY: "v1",
  };
}

const BASE: CalendarScheduleSnapshot = {
  start: "2026-09-01T15:00:00.000Z",
  end: "2026-09-01T17:00:00.000Z",
  timeZone: "America/Edmonton",
  title: "Old title",
  descriptionHash: "0".repeat(64),
};

const CONNECTION: CalendarConnectionRow = {
  id: "connection-1",
  company_id: "company-1",
  user_id: "user-1",
  provider: "google",
  provider_account_id: "crew@example.com",
  provider_account_label: "crew@example.com",
  selected_calendar_id: "primary",
  selected_calendar_timezone: "America/Edmonton",
  credential_ciphertext: "ciphertext",
  credential_iv: "abcdefghijklmnop",
  credential_key_version: "v1",
  credential_generation: 1,
  sync_cursor: "cursor-old",
  pull_full_sync: false,
  last_full_sync_at: "2026-08-18T12:00:00.000Z",
  full_sync_due_at: "2026-08-25T12:00:00.000Z",
  pull_generation: 4,
};

async function credentialClaim(generation = CONNECTION.credential_generation) {
  const sealed = await sealCalendarCredential(
    "stored-refresh-token",
    {
      companyId: CONNECTION.company_id,
      userId: CONNECTION.user_id,
      provider: CONNECTION.provider,
      purpose: "refresh_token",
    },
    { activeVersion: "v1", keys: { v1: KEY } },
  );
  return {
    outcome: "claimed",
    credential_generation: generation,
    credential_ciphertext: sealed.ciphertext,
    credential_iv: sealed.iv,
    credential_key_version: sealed.keyVersion,
  };
}

const OUTBOX: CalendarOutboxRow = {
  id: "outbox-1",
  company_id: "company-1",
  connection_id: CONNECTION.id,
  task_id: "task-1",
  link_id: null,
  action: "create",
  requested_snapshot: BASE,
  provider_effect_ambiguous: false,
  generation: 2,
  attempts: 1,
};

const REMINDER_REPLAN: CalendarReminderReplanRow = {
  id: "replan-1",
  company_id: CONNECTION.company_id,
  task_id: OUTBOX.task_id,
  requester_user_id: CONNECTION.user_id,
  generation: 3,
  attempts: 1,
};

const OWNER_DISCLOSURE: CalendarOwnerDisclosureRow = {
  connection_id: CONNECTION.id,
  company_id: CONNECTION.company_id,
  user_id: CONNECTION.user_id,
  reason: "sync_stale",
  generation: 2,
};

const SUBSCRIPTION: CalendarWebhookSubscriptionRow = {
  id: "subscription-row-1",
  company_id: CONNECTION.company_id,
  connection_id: CONNECTION.id,
  provider_subscription_id: "old-channel",
  provider_resource_id: "old-resource",
  provider_calendar_id: CONNECTION.selected_calendar_id,
  expires_at: "2026-08-25T18:00:00.000Z",
  renewal_generation: 3,
  renewal_attempts: 1,
};

const TASK: CalendarTaskRow = {
  id: OUTBOX.task_id,
  company_id: CONNECTION.company_id,
  title: "Current title",
  description: "First line\r\nSecond line",
  due_at: "2026-09-03T18:30:00.000Z",
  assigned_user_id: CONNECTION.user_id,
  deleted_at: null,
};

const LINK: CalendarLinkRow = {
  id: "link-1",
  company_id: CONNECTION.company_id,
  connection_id: CONNECTION.id,
  task_id: TASK.id,
  provider_event_id: "event-1",
  provider_instance_id: "event-1",
  provider_series_id: null,
  provider_version: "etag-current",
  link_state: "active",
  base_snapshot: BASE,
  last_sent_snapshot: BASE,
};

function remote(
  instanceId: string,
  schedule: CalendarScheduleSnapshot = BASE,
): CalendarRemoteEvent {
  return {
    instanceId,
    version: "etag-returned",
    inbound: { kind: "scheduled", schedule },
    description: "First line\nSecond line",
    descriptionFormat: "text",
    hasAttendees: false,
    hasOnlineMeeting: false,
    organizerEmail: "crew@example.com",
    organizerIsConnectedAccount: true,
    webUrl: null,
  };
}

function changeNotice(event: CalendarRemoteEvent): CalendarChangeNotice {
  return {
    instanceId: event.instanceId,
    version: event.version,
    removed: event.inbound.kind === "removed",
  };
}

function provider(): CalendarProvider {
  return {
    name: "google",
    listChanges: vi.fn(),
    getEvent: vi.fn(async (input) => ({
      ...remote(input.instanceId),
      version: LINK.provider_version,
    })),
    createEvent: vi.fn(),
    patchEvent: vi.fn(),
    annotateAndUnlink: vi.fn(),
    deleteEvent: vi.fn(),
    scrubEvent: vi.fn(),
    startWatch: vi.fn(),
    renewWatch: vi.fn(),
    stopWatch: vi.fn(),
  };
}

function store(overrides: Partial<CalendarSyncStore> = {}): CalendarSyncStore {
  return {
    purgeOauthStates: vi.fn().mockResolvedValue(0),
    queueStaleOwnerDisclosures: vi.fn().mockResolvedValue(0),
    claimOwnerDisclosures: vi.fn().mockResolvedValue([]),
    commitOwnerDisclosure: vi.fn().mockResolvedValue({ outcome: "delivered" }),
    retryOwnerDisclosure: vi.fn().mockResolvedValue({ outcome: "queued" }),
    claimReminderReplans: vi.fn().mockResolvedValue([]),
    completeReminderReplan: vi.fn().mockResolvedValue({ outcome: "completed" }),
    retryReminderReplan: vi.fn().mockResolvedValue({ outcome: "queued" }),
    claimWebhookRenewals: vi.fn().mockResolvedValue([]),
    claimWebhookRevocations: vi.fn().mockResolvedValue([]),
    claimOutbox: vi.fn().mockResolvedValue([]),
    markProviderEffectStarted: vi.fn().mockResolvedValue({ outcome: "marked" }),
    claimPulls: vi.fn().mockResolvedValue([]),
    renewPullLease: vi.fn().mockResolvedValue({ outcome: "renewed" }),
    getConnection: vi.fn().mockResolvedValue(CONNECTION),
    getTask: vi.fn().mockResolvedValue(TASK),
    getLink: vi.fn().mockResolvedValue(LINK),
    findSyncableLink: vi.fn().mockResolvedValue(null),
    listSyncableLinks: vi.fn().mockResolvedValue([]),
    refreshTaskReminders: vi.fn().mockResolvedValue(undefined),
    claimCredentialRefresh: vi.fn().mockResolvedValue({ outcome: "busy" }),
    commitCredentialRefresh: vi.fn().mockResolvedValue({ outcome: "committed" }),
    retryCredentialRefresh: vi.fn().mockResolvedValue({ outcome: "released" }),
    commitCreated: vi.fn().mockResolvedValue({ outcome: "committed" }),
    commitSent: vi.fn().mockResolvedValue({ outcome: "committed" }),
    commitScrubbed: vi.fn().mockResolvedValue({ outcome: "committed" }),
    abandonCleanup: vi.fn().mockResolvedValue({
      outcome: "cleanup_abandoned",
      remote_cleanup_failed: true,
    }),
    applyProviderEvent: vi.fn().mockResolvedValue({ outcome: "provider_applied" }),
    markEventRemoved: vi.fn().mockResolvedValue({ outcome: "event_removed" }),
    markRefused: vi.fn().mockResolvedValue({ outcome: "refused" }),
    retryOutbox: vi.fn().mockResolvedValue({ outcome: "queued" }),
    cancelOutbox: vi.fn().mockResolvedValue({ outcome: "cancelled" }),
    commitPull: vi.fn().mockResolvedValue({ outcome: "committed" }),
    retryPull: vi.fn().mockResolvedValue({ outcome: "queued" }),
    commitWebhookRenewal: vi.fn().mockResolvedValue({ outcome: "committed" }),
    retryWebhookRenewal: vi.fn().mockResolvedValue({ outcome: "queued" }),
    commitWebhookRevocation: vi.fn().mockResolvedValue({ outcome: "revoked" }),
    retryWebhookRevocation: vi.fn().mockResolvedValue({ outcome: "queued" }),
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("calendar sync worker", () => {
  it("explains an unverified disconnect cleanup honestly in both locales", () => {
    const english = calendarOwnerDisclosurePayload(
      "cleanup_failed",
      "en",
      "https://app.example",
    );
    const french = calendarOwnerDisclosurePayload(
      "cleanup_failed",
      "fr-CA",
      "https://app.example",
    );
    expect(english.body).toMatch(/disconnected.*could not confirm removal/i);
    expect(french.body).toMatch(/déconnecté.*pas pu confirmer/i);
    expect(english.url).toBe("https://app.example/settings/profile");
    expect(JSON.stringify([english, french])).not.toMatch(
      /task|customer|address|provider_event/i,
    );
  });

  it("purges expired OAuth state before any normal claim, even with no calendar work", async () => {
    const db = store();

    await drainCalendarSync({
      store: db,
      authorize: vi.fn(),
      workerId: "worker-1",
      now: new Date("2026-08-25T12:00:00.000Z"),
    });

    expect(db.purgeOauthStates).toHaveBeenCalledWith(1_000);
    const purgeOrder = vi.mocked(db.purgeOauthStates).mock.invocationCallOrder[0]!;
    expect(purgeOrder).toBeLessThan(
      vi.mocked(db.claimReminderReplans).mock.invocationCallOrder[0]!,
    );
    expect(db.queueStaleOwnerDisclosures).toHaveBeenCalledWith(
      "2026-08-25T11:45:00.000Z",
      25,
    );
    expect(purgeOrder).toBeLessThan(
      vi.mocked(db.queueStaleOwnerDisclosures).mock.invocationCallOrder[0]!,
    );
    expect(purgeOrder).toBeLessThan(
      vi.mocked(db.claimWebhookRenewals).mock.invocationCallOrder[0]!,
    );
    expect(purgeOrder).toBeLessThan(
      vi.mocked(db.claimOutbox).mock.invocationCallOrder[0]!,
    );
    expect(purgeOrder).toBeLessThan(
      vi.mocked(db.claimPulls).mock.invocationCallOrder[0]!,
    );
  });

  it("delivers one claimed stale-calendar disclosure to its connection owner", async () => {
    const discloseOwner = vi.fn().mockResolvedValue(undefined);
    const db = store({
      claimOwnerDisclosures: vi.fn().mockResolvedValue([OWNER_DISCLOSURE]),
    });

    await drainCalendarSync({
      store: db,
      authorize: vi.fn(),
      discloseOwner,
      workerId: "worker-1",
      now: new Date("2026-08-25T12:00:00.000Z"),
    });

    expect(discloseOwner).toHaveBeenCalledWith(OWNER_DISCLOSURE);
    expect(db.commitOwnerDisclosure).toHaveBeenCalledWith({
      disclosure: OWNER_DISCLOSURE,
      workerId: "worker-1",
    });
    expect(db.retryOwnerDisclosure).not.toHaveBeenCalled();
  });

  it("durably completes route-driven reminder replanning", async () => {
    const db = store({
      claimReminderReplans: vi.fn().mockResolvedValue([REMINDER_REPLAN]),
    });

    await drainCalendarSync({
      store: db,
      authorize: vi.fn(),
      workerId: "worker-1",
    });

    expect(db.refreshTaskReminders).toHaveBeenCalledWith({
      companyId: REMINDER_REPLAN.company_id,
      taskId: REMINDER_REPLAN.task_id,
      userId: REMINDER_REPLAN.requester_user_id,
    });
    expect(db.completeReminderReplan).toHaveBeenCalledWith({
      replan: REMINDER_REPLAN,
      workerId: "worker-1",
    });
    expect(
      vi.mocked(db.refreshTaskReminders).mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(db.completeReminderReplan).mock.invocationCallOrder[0]!,
    );
    expect(db.retryReminderReplan).not.toHaveBeenCalled();
  });

  it("retries reminder replanning instead of losing a failed rebuild", async () => {
    const db = store({
      claimReminderReplans: vi.fn().mockResolvedValue([REMINDER_REPLAN]),
      refreshTaskReminders: vi.fn().mockRejectedValue(new Error("rules unavailable")),
    });

    await drainCalendarSync({
      store: db,
      authorize: vi.fn(),
      workerId: "worker-1",
    });

    expect(db.completeReminderReplan).not.toHaveBeenCalled();
    expect(db.retryReminderReplan).toHaveBeenCalledWith({
      replan: REMINDER_REPLAN,
      workerId: "worker-1",
      delaySeconds: 10,
      errorCode: "calendar_sync_failed",
      errorDetail: "rules unavailable",
    });
  });

  it("allows only one overlapping refresh-token exchange per connection", async () => {
    const claimed = await credentialClaim();
    const claimCredentialRefresh = vi.fn(async (input: { workerId: string }) =>
      input.workerId === "credential-worker-1"
        ? claimed
        : { outcome: "busy", credential_generation: 1 },
    );
    const db = store({ claimCredentialRefresh });
    let finishTokenRequest!: (response: Response) => void;
    const tokenRequest = new Promise<Response>((resolve) => {
      finishTokenRequest = resolve;
    });
    const fetcher = vi.fn(() => tokenRequest);
    vi.stubGlobal("fetch", fetcher);
    const first = calendarAuthorizer(
      configuredEnv(),
      db,
      "credential-worker-1",
    )(CONNECTION);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());

    const second = calendarAuthorizer(
      configuredEnv(),
      db,
      "credential-worker-2",
    )(CONNECTION);
    await expect(second).rejects.toMatchObject({ outcome: "busy" });
    expect(fetcher).toHaveBeenCalledOnce();

    finishTokenRequest(Response.json({
      access_token: "first-access-token",
      expires_in: 3600,
    }));
    await expect(first).resolves.toMatchObject({
      accessToken: "first-access-token",
    });
    expect(db.commitCredentialRefresh).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionId: CONNECTION.id,
        workerId: "credential-worker-1",
        expectedGeneration: 1,
      }),
    );
  });

  it("retries the identical rotated credential until its durable commit is confirmed", async () => {
    const commitCredentialRefresh = vi
      .fn()
      .mockRejectedValueOnce(new Error("database response lost"))
      .mockResolvedValueOnce({
        outcome: "committed",
        credential_generation: 2,
        idempotent: true,
      });
    const db = store({
      claimCredentialRefresh: vi.fn().mockResolvedValue(await credentialClaim()),
      commitCredentialRefresh,
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      access_token: "fresh-access-token",
      refresh_token: "rotated-refresh-token",
      expires_in: 3600,
    })));

    await expect(
      calendarAuthorizer(configuredEnv(), db, "credential-worker")(CONNECTION),
    ).resolves.toMatchObject({ accessToken: "fresh-access-token" });

    expect(commitCredentialRefresh).toHaveBeenCalledTimes(2);
    const first = commitCredentialRefresh.mock.calls[0]![0];
    const second = commitCredentialRefresh.mock.calls[1]![0];
    expect(second.credential).toEqual(first.credential);
    await expect(openCalendarCredential(
      first.credential,
      {
        companyId: CONNECTION.company_id,
        userId: CONNECTION.user_id,
        provider: CONNECTION.provider,
        purpose: "refresh_token",
      },
      { activeVersion: "v1", keys: { v1: KEY } },
    )).resolves.toBe("rotated-refresh-token");
    expect(db.retryCredentialRefresh).not.toHaveBeenCalled();
  });

  it("never releases or exposes a rotated token while its commit remains ambiguous", async () => {
    const db = store({
      claimCredentialRefresh: vi.fn().mockResolvedValue(await credentialClaim()),
      commitCredentialRefresh: vi.fn().mockRejectedValue(
        new Error("database transport unavailable"),
      ),
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      access_token: "must-not-escape",
      refresh_token: "rotated-refresh-token",
      expires_in: 3600,
    })));

    await expect(
      calendarAuthorizer(configuredEnv(), db, "credential-worker")(CONNECTION),
    ).rejects.toThrow("database transport unavailable");
    expect(db.commitCredentialRefresh).toHaveBeenCalledTimes(3);
    expect(db.retryCredentialRefresh).not.toHaveBeenCalled();
  });

  it("discards an access token when OAuth reconnect supersedes the credential CAS", async () => {
    const db = store({
      claimCredentialRefresh: vi.fn().mockResolvedValue(await credentialClaim(4)),
      commitCredentialRefresh: vi.fn().mockResolvedValue({
        outcome: "superseded",
        credential_generation: 5,
      }),
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      access_token: "stale-access-token",
      expires_in: 3600,
    })));

    const authorization = calendarAuthorizer(
      configuredEnv(),
      db,
      "credential-worker",
    )({ ...CONNECTION, credential_generation: 4 });

    await expect(authorization).rejects.toEqual(
      expect.objectContaining<Partial<CalendarCredentialRefreshUnavailableError>>({
        outcome: "superseded",
      }),
    );
    expect(db.retryCredentialRefresh).not.toHaveBeenCalled();
  });

  it("marks reauthorization only when the claimed refresh-token exchange is rejected", async () => {
    const db = store({
      claimCredentialRefresh: vi.fn().mockResolvedValue(await credentialClaim()),
      retryCredentialRefresh: vi.fn().mockResolvedValue({
        outcome: "reauth_required",
      }),
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(
      { error: "invalid_grant" },
      { status: 400 },
    )));

    await expect(
      calendarAuthorizer(configuredEnv(), db, "credential-worker")(CONNECTION),
    ).rejects.toBeInstanceOf(CalendarReauthRequiredError);
    expect(db.retryCredentialRefresh).toHaveBeenCalledWith({
      connectionId: CONNECTION.id,
      workerId: "credential-worker",
      expectedGeneration: 1,
      requiresReauth: true,
      errorCode: "google_reauth",
      errorDetail: expect.stringContaining("authorization must be renewed"),
    });
  });

  it("rebuilds a create from the current task instead of replaying a queued body", async () => {
    const calendar = provider();
    vi.mocked(calendar.createEvent).mockImplementation(async (input) =>
      remote("created-event", input.schedule),
    );
    const db = store({ claimOutbox: vi.fn().mockResolvedValue([OUTBOX]) });

    await drainCalendarSync({
      store: db,
      authorize: vi.fn().mockResolvedValue({
        accessToken: "access",
        provider: calendar,
      }),
      workerId: "worker-1",
      now: new Date("2026-08-25T12:00:00.000Z"),
    });

    expect(calendar.createEvent).toHaveBeenCalledOnce();
    expect(db.markProviderEffectStarted).toHaveBeenCalledWith({
      outbox: OUTBOX,
      workerId: "worker-1",
    });
    expect(
      vi.mocked(db.markProviderEffectStarted).mock.invocationCallOrder[0],
    ).toBeLessThan(vi.mocked(calendar.createEvent).mock.invocationCallOrder[0]!);
    const input = vi.mocked(calendar.createEvent).mock.calls[0]![0];
    expect(input.idempotencyKey).toBe(OUTBOX.id);
    expect(input.schedule).toMatchObject({
      start: TASK.due_at,
      end: "2026-09-03T19:30:00.000Z",
      title: TASK.title,
    });
    expect(input.description).toBe("First line\nSecond line");
    expect(db.commitCreated).toHaveBeenCalledWith(
      expect.objectContaining({
        outbox: OUTBOX,
        sent: input.schedule,
        description: "First line\nSecond line",
      }),
    );
    expect(db.retryOutbox).not.toHaveBeenCalled();
  });

  it("keeps create idempotency tied to the outbox row across generations", async () => {
    const calendar = provider();
    vi.mocked(calendar.createEvent).mockImplementation(async (input) =>
      remote("created-event", input.schedule),
    );
    const claimOutbox = vi
      .fn()
      .mockResolvedValueOnce([OUTBOX])
      .mockResolvedValueOnce([{ ...OUTBOX, generation: 17, attempts: 8 }]);
    const db = store({ claimOutbox });
    const dependencies = {
      store: db,
      authorize: vi.fn().mockResolvedValue({
        accessToken: "access",
        provider: calendar,
      }),
      workerId: "worker-1",
    };

    await drainCalendarSync(dependencies);
    await drainCalendarSync(dependencies);

    expect(
      vi.mocked(calendar.createEvent).mock.calls.map(
        ([input]) => input.idempotencyKey,
      ),
    ).toEqual([OUTBOX.id, OUTBOX.id]);
  });

  it("commits recovered provider truth so a newer generation can follow up", async () => {
    const calendar = provider();
    const providerSnapshot = {
      ...BASE,
      title: "Title accepted before the response was lost",
    };
    vi.mocked(calendar.createEvent).mockResolvedValue({
      ...remote("created-event", providerSnapshot),
      description: "Description accepted before the response was lost",
    });
    const db = store({
      claimOutbox: vi.fn().mockResolvedValue([{ ...OUTBOX, generation: 9 }]),
    });

    await drainCalendarSync({
      store: db,
      authorize: vi.fn().mockResolvedValue({
        accessToken: "access",
        provider: calendar,
      }),
      workerId: "worker-1",
    });

    expect(db.commitCreated).toHaveBeenCalledWith(
      expect.objectContaining({
        sent: providerSnapshot,
        description: "Description accepted before the response was lost",
      }),
    );
  });

  it("preserves the agreed duration and uses the mapping's latest version", async () => {
    const calendar = provider();
    vi.mocked(calendar.patchEvent).mockImplementation(async (input) =>
      remote(LINK.provider_instance_id, input.schedule),
    );
    const row = { ...OUTBOX, action: "upsert" as const, link_id: LINK.id };
    const db = store({ claimOutbox: vi.fn().mockResolvedValue([row]) });

    await drainCalendarSync({
      store: db,
      authorize: vi.fn().mockResolvedValue({ accessToken: "a", provider: calendar }),
      workerId: "worker-1",
    });

    expect(calendar.patchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        instanceId: LINK.provider_instance_id,
        version: "etag-current",
        schedule: expect.objectContaining({
          start: TASK.due_at,
          end: "2026-09-03T20:30:00.000Z",
        }),
      }),
    );
    expect(
      vi.mocked(db.markProviderEffectStarted).mock.invocationCallOrder[0],
    ).toBeLessThan(vi.mocked(calendar.patchEvent).mock.invocationCallOrder[0]!);
    expect(db.commitSent).toHaveBeenCalledOnce();
  });

  it.each([
    ["participants", { hasAttendees: true }],
    ["an online meeting", { hasOnlineMeeting: true }],
  ])("refuses a Microsoft update when the event gained %s", async (_label, risk) => {
    const calendar = { ...provider(), name: "microsoft" as const };
    const current = {
      ...remote(LINK.provider_instance_id),
      version: LINK.provider_version,
      ...risk,
    };
    vi.mocked(calendar.getEvent).mockResolvedValue(current);
    const row = { ...OUTBOX, action: "upsert" as const, link_id: LINK.id };
    const db = store({ claimOutbox: vi.fn().mockResolvedValue([row]) });

    await drainCalendarSync({
      store: db,
      authorize: vi.fn().mockResolvedValue({ accessToken: "a", provider: calendar }),
      workerId: "worker-1",
    });

    expect(db.markRefused).toHaveBeenCalledWith(
      expect.objectContaining({
        connection: CONNECTION,
        link: LINK,
        remote: current,
        code: "unsafe_meeting",
        outbox: row,
      }),
    );
    expect(db.markProviderEffectStarted).not.toHaveBeenCalled();
    expect(calendar.patchEvent).not.toHaveBeenCalled();
  });

  it("reconciles a changed fresh observation instead of patching it with a new etag", async () => {
    const calendar = provider();
    const changed = {
      ...remote(LINK.provider_instance_id, {
        ...BASE,
        start: "2026-09-07T15:00:00.000Z",
        end: "2026-09-07T17:00:00.000Z",
      }),
      version: "etag-provider-changed",
    };
    vi.mocked(calendar.getEvent).mockResolvedValue(changed);
    const row = { ...OUTBOX, action: "upsert" as const, link_id: LINK.id };
    const db = store({ claimOutbox: vi.fn().mockResolvedValue([row]) });

    await drainCalendarSync({
      store: db,
      authorize: vi.fn().mockResolvedValue({ accessToken: "a", provider: calendar }),
      workerId: "worker-1",
    });

    expect(calendar.patchEvent).not.toHaveBeenCalled();
    expect(db.applyProviderEvent).toHaveBeenCalledWith({
      connection: CONNECTION,
      link: LINK,
      remote: changed,
      workerId: "worker-1",
      outbox: row,
    });
    expect(db.retryOutbox).toHaveBeenCalledOnce();
  });

  it.each(["direct_404", "precondition_then_404"])(
    "turns %s during update into durable event-removed attention",
    async (path) => {
      const calendar = provider();
      vi.mocked(calendar.getEvent).mockResolvedValueOnce({
        ...remote(LINK.provider_instance_id),
        version: LINK.provider_version,
      });
      if (path === "direct_404") {
        vi.mocked(calendar.patchEvent).mockRejectedValue(
          new CalendarEventNotFoundError("google", "patch event", 404),
        );
      } else {
        vi.mocked(calendar.patchEvent).mockRejectedValue(
          new CalendarPreconditionError("google", "patch event", 412),
        );
        vi.mocked(calendar.getEvent).mockRejectedValueOnce(
          new CalendarEventNotFoundError("google", "get event", 404),
        );
      }
      const row = { ...OUTBOX, action: "upsert" as const, link_id: LINK.id };
      const db = store({ claimOutbox: vi.fn().mockResolvedValue([row]) });

      await drainCalendarSync({
        store: db,
        authorize: vi.fn().mockResolvedValue({ accessToken: "a", provider: calendar }),
        workerId: "worker-1",
      });

      expect(db.markEventRemoved).toHaveBeenCalledWith(
        expect.objectContaining({ link: LINK, outbox: row }),
      );
      expect(db.retryOutbox).not.toHaveBeenCalled();
    },
  );

  it("turns a precondition re-read refusal into durable attention", async () => {
    const calendar = provider();
    const current = {
      ...remote(LINK.provider_instance_id),
      version: LINK.provider_version,
    };
    const allDay: CalendarRemoteEvent = {
      ...remote(LINK.provider_instance_id),
      inbound: { kind: "all_day" },
    };
    vi.mocked(calendar.getEvent)
      .mockResolvedValueOnce(current)
      .mockResolvedValueOnce(allDay);
    vi.mocked(calendar.patchEvent).mockRejectedValue(
      new CalendarPreconditionError("google", "patch event", 412),
    );
    const row = { ...OUTBOX, action: "upsert" as const, link_id: LINK.id };
    const db = store({ claimOutbox: vi.fn().mockResolvedValue([row]) });

    await drainCalendarSync({
      store: db,
      authorize: vi.fn().mockResolvedValue({ accessToken: "a", provider: calendar }),
      workerId: "worker-1",
    });

    expect(db.markRefused).toHaveBeenCalledWith(
      expect.objectContaining({ code: "all_day", outbox: row, remote: allDay }),
    );
    expect(db.retryOutbox).not.toHaveBeenCalled();
  });

  it("re-reads and re-decides a failed precondition instead of replaying", async () => {
    const calendar = provider();
    vi.mocked(calendar.patchEvent).mockRejectedValue(
      new CalendarPreconditionError("google", "patch", 412),
    );
    const changed = remote(LINK.provider_instance_id, {
      ...BASE,
      start: "2026-09-04T15:00:00.000Z",
      end: "2026-09-04T17:00:00.000Z",
    });
    vi.mocked(calendar.getEvent)
      .mockResolvedValueOnce({
        ...remote(LINK.provider_instance_id),
        version: LINK.provider_version,
      })
      .mockResolvedValueOnce(changed);
    const row = { ...OUTBOX, action: "upsert" as const, link_id: LINK.id };
    const db = store({ claimOutbox: vi.fn().mockResolvedValue([row]) });

    await drainCalendarSync({
      store: db,
      authorize: vi.fn().mockResolvedValue({ accessToken: "a", provider: calendar }),
      workerId: "worker-1",
    });

    expect(calendar.patchEvent).toHaveBeenCalledOnce();
    expect(calendar.getEvent).toHaveBeenCalledTimes(2);
    expect(db.applyProviderEvent).toHaveBeenCalledWith({
      connection: CONNECTION,
      link: LINK,
      remote: changed,
      workerId: "worker-1",
      outbox: row,
    });
    expect(db.retryOutbox).toHaveBeenCalledWith(
      expect.objectContaining({
        outbox: row,
        delaySeconds: 1,
        errorCode: "provider_precondition_reconciled",
      }),
    );
  });

  it("recovers a lost update response as an echo and preserves newer local truth", async () => {
    const calendar = provider();
    vi.mocked(calendar.patchEvent).mockRejectedValue(
      new CalendarPreconditionError("google", "patch", 412),
    );
    const acceptedBeforeResponseLoss: CalendarScheduleSnapshot = {
      ...BASE,
      start: "2026-09-04T15:00:00.000Z",
      end: "2026-09-04T17:00:00.000Z",
      title: "Provider accepted this earlier body",
    };
    const acceptedRemote = remote(
      LINK.provider_instance_id,
      acceptedBeforeResponseLoss,
    );
    vi.mocked(calendar.getEvent)
      .mockResolvedValueOnce({
        ...remote(LINK.provider_instance_id),
        version: LINK.provider_version,
      })
      .mockResolvedValueOnce(acceptedRemote);
    const row: CalendarOutboxRow = {
      ...OUTBOX,
      action: "upsert",
      link_id: LINK.id,
      requested_snapshot: acceptedBeforeResponseLoss,
      provider_effect_ambiguous: true,
    };
    const currentTask = {
      ...TASK,
      due_at: "2026-09-05T15:00:00.000Z",
      title: "Newer local decision",
    };
    const db = store({
      claimOutbox: vi.fn().mockResolvedValue([row]),
      getTask: vi.fn().mockResolvedValue(currentTask),
      // The RPC recognizes acceptedRemote as the ambiguous outbox echo and
      // atomically queues currentTask instead of creating a conflict.
      applyProviderEvent: vi.fn().mockResolvedValue({ outcome: "push_queued" }),
    });

    await drainCalendarSync({
      store: db,
      authorize: vi.fn().mockResolvedValue({ accessToken: "a", provider: calendar }),
      workerId: "worker-1",
    });

    expect(calendar.patchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        schedule: expect.objectContaining({
          start: currentTask.due_at,
          title: currentTask.title,
        }),
      }),
    );
    expect(db.applyProviderEvent).toHaveBeenCalledWith({
      connection: CONNECTION,
      link: LINK,
      remote: acceptedRemote,
      workerId: "worker-1",
      outbox: row,
    });
    expect(db.refreshTaskReminders).toHaveBeenCalledWith({
      companyId: CONNECTION.company_id,
      taskId: LINK.task_id,
      userId: CONNECTION.user_id,
    });
    expect(db.retryOutbox).toHaveBeenCalledWith(
      expect.objectContaining({
        outbox: row,
        errorCode: "provider_precondition_reconciled",
      }),
    );
  });

  it("cancels an ineligible create before requesting a provider token", async () => {
    const authorize = vi.fn();
    const db = store({
      claimOutbox: vi.fn().mockResolvedValue([OUTBOX]),
      getTask: vi.fn().mockResolvedValue({ ...TASK, assigned_user_id: "someone-else" }),
    });

    await drainCalendarSync({ store: db, authorize, workerId: "worker-1" });

    expect(authorize).not.toHaveBeenCalled();
    expect(db.markProviderEffectStarted).not.toHaveBeenCalled();
    expect(db.cancelOutbox).toHaveBeenCalledWith(
      expect.objectContaining({ outbox: OUTBOX }),
    );
  });

  it.each([
    "2026-05-27T11:59:59.999Z",
    "2027-08-25T12:00:00.001Z",
  ])("does not let a stale queued create bypass the sync window at %s", async (dueAt) => {
    const authorize = vi.fn();
    const db = store({
      claimOutbox: vi.fn().mockResolvedValue([OUTBOX]),
      getTask: vi.fn().mockResolvedValue({ ...TASK, due_at: dueAt }),
    });

    await drainCalendarSync({
      store: db,
      authorize,
      workerId: "worker-1",
      now: new Date("2026-08-25T12:00:00.000Z"),
    });

    expect(authorize).not.toHaveBeenCalled();
    expect(db.cancelOutbox).toHaveBeenCalledWith(
      expect.objectContaining({ outbox: OUTBOX }),
    );
  });

  it.each([
    ["unscheduled", { due_at: null }],
    ["deleted", { deleted_at: "2026-08-25T12:00:00.000Z" }],
    ["reassigned", { assigned_user_id: "user-2" }],
  ] as const)(
    "recovers an ambiguous create after the task becomes %s",
    async (_label, taskPatch) => {
      const calendar = provider();
      vi.mocked(calendar.createEvent).mockResolvedValue(
        remote("possibly-created-event", BASE),
      );
      const ambiguous = {
        ...OUTBOX,
        requested_snapshot: BASE,
        provider_effect_ambiguous: true,
      };
      const db = store({
        claimOutbox: vi.fn().mockResolvedValue([ambiguous]),
        getTask: vi.fn().mockResolvedValue({ ...TASK, ...taskPatch }),
        commitCreated: vi.fn().mockResolvedValue({ outcome: "followup_queued" }),
      });

      await drainCalendarSync({
        store: db,
        authorize: vi.fn().mockResolvedValue({
          accessToken: "access",
          provider: calendar,
        }),
        workerId: "worker-1",
      });

      expect(db.cancelOutbox).not.toHaveBeenCalled();
      expect(calendar.createEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          idempotencyKey: ambiguous.id,
          schedule: BASE,
        }),
      );
      expect(db.commitCreated).toHaveBeenCalledWith(
        expect.objectContaining({ outbox: ambiguous, sent: BASE }),
      );
      expect(db.retryOutbox).not.toHaveBeenCalled();
    },
  );

  it("marks only after an unlink read proves an external write is needed", async () => {
    const calendar = provider();
    const row = {
      ...OUTBOX,
      action: "unlink" as const,
      link_id: LINK.id,
      requested_snapshot: null,
    };
    vi.mocked(calendar.getEvent).mockResolvedValue(remote(LINK.provider_instance_id));
    vi.mocked(calendar.annotateAndUnlink).mockResolvedValue(
      remote(LINK.provider_instance_id),
    );
    const db = store({ claimOutbox: vi.fn().mockResolvedValue([row]) });

    await drainCalendarSync({
      store: db,
      authorize: vi.fn().mockResolvedValue({ accessToken: "a", provider: calendar }),
      workerId: "worker-1",
    });

    const readOrder = vi.mocked(calendar.getEvent).mock.invocationCallOrder[0]!;
    const markOrder = vi.mocked(db.markProviderEffectStarted).mock
      .invocationCallOrder[0]!;
    const writeOrder = vi.mocked(calendar.annotateAndUnlink).mock
      .invocationCallOrder[0]!;
    expect(readOrder).toBeLessThan(markOrder);
    expect(markOrder).toBeLessThan(writeOrder);
  });

  it("preserves a safe Graph event's original HTML while appending the unlink note", async () => {
    const calendar = { ...provider(), name: "microsoft" as const };
    const row = {
      ...OUTBOX,
      action: "unlink" as const,
      link_id: LINK.id,
      requested_snapshot: null,
    };
    vi.mocked(calendar.getEvent).mockResolvedValue({
      ...remote(LINK.provider_instance_id),
      description: "Formatted note",
      rawDescription: "<p><strong>Formatted</strong> note</p>",
      descriptionFormat: "html",
    });
    vi.mocked(calendar.annotateAndUnlink).mockResolvedValue(
      remote(LINK.provider_instance_id),
    );
    const db = store({ claimOutbox: vi.fn().mockResolvedValue([row]) });

    await drainCalendarSync({
      store: db,
      authorize: vi.fn().mockResolvedValue({ accessToken: "a", provider: calendar }),
      workerId: "worker-1",
    });

    expect(calendar.getEvent).toHaveBeenCalledWith(
      expect.objectContaining({ preserveDescriptionFormatting: true }),
    );
    expect(calendar.annotateAndUnlink).toHaveBeenCalledWith(
      expect.objectContaining({
        currentDescription: "<p><strong>Formatted</strong> note</p>",
        descriptionFormat: "html",
      }),
    );
  });

  it("does not mark a provider effect when an unlink read finds it removed", async () => {
    const calendar = provider();
    const row = {
      ...OUTBOX,
      action: "unlink" as const,
      link_id: LINK.id,
      requested_snapshot: null,
    };
    vi.mocked(calendar.getEvent).mockResolvedValue({
      ...remote(LINK.provider_instance_id),
      inbound: { kind: "removed" },
    });
    const db = store({ claimOutbox: vi.fn().mockResolvedValue([row]) });

    await drainCalendarSync({
      store: db,
      authorize: vi.fn().mockResolvedValue({ accessToken: "a", provider: calendar }),
      workerId: "worker-1",
    });

    expect(db.markProviderEffectStarted).not.toHaveBeenCalled();
    expect(calendar.annotateAndUnlink).not.toHaveBeenCalled();
    expect(db.commitSent).toHaveBeenCalledOnce();
  });

  it("commits an unlink when its provider event is already gone", async () => {
    const calendar = provider();
    const row = {
      ...OUTBOX,
      action: "unlink" as const,
      link_id: LINK.id,
      requested_snapshot: null,
    };
    vi.mocked(calendar.getEvent).mockRejectedValue(
      new CalendarEventNotFoundError("google", "get event", 404),
    );
    const db = store({ claimOutbox: vi.fn().mockResolvedValue([row]) });

    await drainCalendarSync({
      store: db,
      authorize: vi.fn().mockResolvedValue({ accessToken: "a", provider: calendar }),
      workerId: "worker-1",
    });

    expect(db.markProviderEffectStarted).not.toHaveBeenCalled();
    expect(calendar.annotateAndUnlink).not.toHaveBeenCalled();
    expect(db.commitSent).toHaveBeenCalledWith({
      outbox: row,
      workerId: "worker-1",
      providerVersion: null,
      sent: null,
      description: null,
    });
    expect(db.retryOutbox).not.toHaveBeenCalled();
  });

  it("deletes only an attendee-free event organized by the connected account", async () => {
    const calendar = provider();
    const row = {
      ...OUTBOX,
      action: "scrub" as const,
      link_id: LINK.id,
      requested_snapshot: null,
    };
    vi.mocked(calendar.getEvent).mockResolvedValue(remote(LINK.provider_instance_id));
    const db = store({ claimOutbox: vi.fn().mockResolvedValue([row]) });

    await drainCalendarSync({
      store: db,
      authorize: vi.fn().mockResolvedValue({ accessToken: "a", provider: calendar }),
      workerId: "worker-1",
    });

    expect(calendar.deleteEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        instanceId: LINK.provider_instance_id,
        version: "etag-returned",
      }),
    );
    expect(calendar.scrubEvent).not.toHaveBeenCalled();
    expect(db.commitScrubbed).toHaveBeenCalledWith({
      outbox: row,
      workerId: "worker-1",
      providerVersion: null,
      providerDeleted: true,
    });
    expect(
      vi.mocked(db.markProviderEffectStarted).mock.invocationCallOrder[0],
    ).toBeLessThan(vi.mocked(calendar.deleteEvent).mock.invocationCallOrder[0]!);
  });

  it("neutralizes a meeting without deleting it or changing participation", async () => {
    const calendar = provider();
    const row = {
      ...OUTBOX,
      action: "scrub" as const,
      link_id: LINK.id,
      requested_snapshot: null,
      provider_effect_ambiguous: true,
    };
    const meeting = {
      ...remote(LINK.provider_instance_id),
      hasAttendees: true,
    };
    vi.mocked(calendar.getEvent).mockResolvedValue(meeting);
    vi.mocked(calendar.scrubEvent).mockResolvedValue({
      ...meeting,
      version: "etag-scrubbed",
      description: "",
    });
    const db = store({ claimOutbox: vi.fn().mockResolvedValue([row]) });

    await drainCalendarSync({
      store: db,
      authorize: vi.fn().mockResolvedValue({ accessToken: "a", provider: calendar }),
      workerId: "worker-1",
    });

    expect(calendar.deleteEvent).not.toHaveBeenCalled();
    expect(calendar.scrubEvent).toHaveBeenCalledWith({
      accessToken: "a",
      calendarId: CONNECTION.selected_calendar_id,
      instanceId: LINK.provider_instance_id,
      version: "etag-returned",
      calendarTimeZone: CONNECTION.selected_calendar_timezone,
      connectedAccountEmail: CONNECTION.provider_account_id,
    });
    expect(db.commitScrubbed).toHaveBeenCalledWith(
      expect.objectContaining({
        providerVersion: "etag-scrubbed",
        providerDeleted: false,
      }),
    );
  });

  it("never hard-deletes an attendee-free online meeting", async () => {
    const calendar = { ...provider(), name: "microsoft" as const };
    const row = {
      ...OUTBOX,
      action: "scrub" as const,
      link_id: LINK.id,
      requested_snapshot: null,
    };
    const meeting = {
      ...remote(LINK.provider_instance_id),
      hasOnlineMeeting: true,
    };
    vi.mocked(calendar.getEvent).mockResolvedValue(meeting);
    vi.mocked(calendar.scrubEvent).mockResolvedValue({
      ...meeting,
      version: "etag-scrubbed",
      description: "",
    });
    const db = store({ claimOutbox: vi.fn().mockResolvedValue([row]) });

    await drainCalendarSync({
      store: db,
      authorize: vi.fn().mockResolvedValue({ accessToken: "a", provider: calendar }),
      workerId: "worker-1",
    });

    expect(calendar.deleteEvent).not.toHaveBeenCalled();
    expect(calendar.scrubEvent).not.toHaveBeenCalled();
    expect(db.commitScrubbed).not.toHaveBeenCalled();
    expect(db.abandonCleanup).toHaveBeenCalledWith(
      expect.objectContaining({
        outbox: row,
        errorDetail: expect.stringContaining("not attempted"),
      }),
    );
    expect(db.retryOutbox).not.toHaveBeenCalled();
  });

  it("does not write after the effect-start boundary reports a stale lease", async () => {
    const calendar = provider();
    const db = store({
      claimOutbox: vi.fn().mockResolvedValue([OUTBOX]),
      markProviderEffectStarted: vi.fn().mockResolvedValue({
        outcome: "lease_lost",
      }),
    });

    await drainCalendarSync({
      store: db,
      authorize: vi.fn().mockResolvedValue({ accessToken: "a", provider: calendar }),
      workerId: "worker-1",
    });

    expect(calendar.createEvent).not.toHaveBeenCalled();
    expect(db.retryOutbox).not.toHaveBeenCalled();
  });

  it("clears ambiguity only for a concrete rejection from the write itself", async () => {
    const rejectedWrite = provider();
    vi.mocked(rejectedWrite.createEvent).mockRejectedValue(
      new CalendarReauthRequiredError("google", "create event"),
    );
    const rejectedDb = store({
      claimOutbox: vi.fn().mockResolvedValue([OUTBOX]),
    });

    await drainCalendarSync({
      store: rejectedDb,
      authorize: vi.fn().mockResolvedValue({
        accessToken: "expired",
        provider: rejectedWrite,
      }),
      workerId: "worker-1",
    });

    expect(rejectedDb.markProviderEffectStarted).toHaveBeenCalledOnce();
    expect(rejectedDb.retryOutbox).toHaveBeenCalledWith(
      expect.objectContaining({
        requiresReauth: false,
        effectDefinitelyAbsent: true,
      }),
    );

    const ambiguousRecoveryRead = provider();
    vi.mocked(ambiguousRecoveryRead.createEvent).mockRejectedValue(
      new CalendarReauthRequiredError("google", "get event"),
    );
    const ambiguousDb = store({
      claimOutbox: vi.fn().mockResolvedValue([OUTBOX]),
    });
    await drainCalendarSync({
      store: ambiguousDb,
      authorize: vi.fn().mockResolvedValue({
        accessToken: "expired",
        provider: ambiguousRecoveryRead,
      }),
      workerId: "worker-2",
    });
    expect(ambiguousDb.retryOutbox).toHaveBeenCalledWith(
      expect.objectContaining({ effectDefinitelyAbsent: false }),
    );

    const priorAmbiguityWrite = provider();
    vi.mocked(priorAmbiguityWrite.createEvent).mockRejectedValue(
      new CalendarReauthRequiredError("google", "create event"),
    );
    const priorAmbiguityDb = store({
      claimOutbox: vi.fn().mockResolvedValue([
        { ...OUTBOX, provider_effect_ambiguous: true },
      ]),
    });
    await drainCalendarSync({
      store: priorAmbiguityDb,
      authorize: vi.fn().mockResolvedValue({
        accessToken: "expired",
        provider: priorAmbiguityWrite,
      }),
      workerId: "worker-3",
    });
    expect(priorAmbiguityDb.retryOutbox).toHaveBeenCalledWith(
      expect.objectContaining({ effectDefinitelyAbsent: false }),
    );
  });

  it("applies only mapped provider instances and commits the final cursor", async () => {
    const calendar = provider();
    const mapped = remote(LINK.provider_instance_id);
    const unrelated = remote("somebody-elses-event");
    vi.mocked(calendar.listChanges).mockResolvedValue({
      events: [changeNotice(mapped), changeNotice(unrelated)],
      nextPageToken: null,
      nextCursor: "cursor-new",
    });
    vi.mocked(calendar.getEvent).mockResolvedValue(mapped);
    const db = store({
      claimPulls: vi.fn().mockResolvedValue([CONNECTION]),
      findSyncableLink: vi.fn(async (_companyId, _connectionId, instanceId) =>
        instanceId === LINK.provider_instance_id ? LINK : null,
      ),
    });

    await drainCalendarSync({
      store: db,
      authorize: vi.fn().mockResolvedValue({ accessToken: "a", provider: calendar }),
      workerId: "worker-1",
      now: new Date("2026-08-25T12:00:00.000Z"),
    });

    expect(db.applyProviderEvent).toHaveBeenCalledTimes(1);
    expect(db.applyProviderEvent).toHaveBeenCalledWith({
      connection: CONNECTION,
      link: LINK,
      remote: mapped,
      workerId: "worker-1",
    });
    expect(db.refreshTaskReminders).toHaveBeenCalledWith({
      companyId: CONNECTION.company_id,
      taskId: LINK.task_id,
      userId: CONNECTION.user_id,
    });
    expect(db.commitPull).toHaveBeenCalledWith({
      connection: CONNECTION,
      workerId: "worker-1",
      cursor: "cursor-new",
    });
  });

  it("accepts an access-loss scrub decision without rebuilding reminders", async () => {
    const calendar = provider();
    vi.mocked(calendar.listChanges).mockResolvedValue({
      events: [changeNotice(remote(LINK.provider_instance_id))],
      nextPageToken: null,
      nextCursor: "cursor-after-scrub",
    });
    const db = store({
      claimPulls: vi.fn().mockResolvedValue([CONNECTION]),
      findSyncableLink: vi.fn().mockResolvedValue(LINK),
      applyProviderEvent: vi.fn().mockResolvedValue({ outcome: "scrub_queued" }),
    });

    await drainCalendarSync({
      store: db,
      authorize: vi.fn().mockResolvedValue({ accessToken: "a", provider: calendar }),
      workerId: "worker-1",
    });

    expect(db.refreshTaskReminders).not.toHaveBeenCalled();
    expect(db.commitPull).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: "cursor-after-scrub" }),
    );
    expect(db.retryPull).not.toHaveBeenCalled();
  });

  it.each(["refused", "event_removed", "conflict"] as const)(
    "re-applies a later scheduled event for a %s mapping",
    async (linkState) => {
      const calendar = provider();
      const recoveredLink: CalendarLinkRow = {
        ...LINK,
        link_state: linkState,
      };
      const scheduled = remote(recoveredLink.provider_instance_id, {
        ...BASE,
        start: "2026-09-06T15:00:00.000Z",
        end: "2026-09-06T17:00:00.000Z",
      });
      vi.mocked(calendar.listChanges).mockResolvedValue({
        events: [changeNotice(scheduled)],
        nextPageToken: null,
        nextCursor: "cursor-recovered",
      });
      vi.mocked(calendar.getEvent).mockResolvedValue(scheduled);
      const db = store({
        claimPulls: vi.fn().mockResolvedValue([CONNECTION]),
        findSyncableLink: vi.fn().mockResolvedValue(recoveredLink),
      });

      await drainCalendarSync({
        store: db,
        authorize: vi.fn().mockResolvedValue({
          accessToken: "access",
          provider: calendar,
        }),
        workerId: "worker-1",
      });

      expect(db.findSyncableLink).toHaveBeenCalledWith(
        CONNECTION.company_id,
        CONNECTION.id,
        recoveredLink.provider_instance_id,
      );
      expect(db.applyProviderEvent).toHaveBeenCalledWith({
        connection: CONNECTION,
        link: recoveredLink,
        remote: scheduled,
        workerId: "worker-1",
      });
      expect(db.refreshTaskReminders).toHaveBeenCalledWith({
        companyId: CONNECTION.company_id,
        taskId: recoveredLink.task_id,
        userId: CONNECTION.user_id,
      });
    },
  );

  it.each(["conflict", "refused"] as const)(
    "lets a %s mapping transition to removed without poisoning the cursor",
    async (linkState) => {
      const calendar = provider();
      const link = { ...LINK, link_state: linkState };
      const removed = {
        ...remote(link.provider_instance_id),
        inbound: { kind: "removed" as const },
      };
      vi.mocked(calendar.listChanges).mockResolvedValue({
        events: [changeNotice(removed)],
        nextPageToken: null,
        nextCursor: `after-${linkState}-removed`,
      });
      vi.mocked(calendar.getEvent).mockResolvedValue(removed);
      const db = store({
        claimPulls: vi.fn().mockResolvedValue([CONNECTION]),
        findSyncableLink: vi.fn().mockResolvedValue(link),
      });

      await drainCalendarSync({
        store: db,
        authorize: vi.fn().mockResolvedValue({ accessToken: "a", provider: calendar }),
        workerId: "worker-1",
      });

      expect(db.markEventRemoved).toHaveBeenCalledWith(
        expect.objectContaining({ link, remote: removed }),
      );
      expect(db.commitPull).toHaveBeenCalledWith(
        expect.objectContaining({ cursor: `after-${linkState}-removed` }),
      );
    },
  );

  it.each(["conflict", "event_removed"] as const)(
    "lets a %s mapping transition to refusal without poisoning the cursor",
    async (linkState) => {
      const calendar = provider();
      const link = { ...LINK, link_state: linkState };
      const refused = {
        ...remote(link.provider_instance_id),
        inbound: { kind: "all_day" as const },
      };
      vi.mocked(calendar.listChanges).mockResolvedValue({
        events: [changeNotice(refused)],
        nextPageToken: null,
        nextCursor: `after-${linkState}-refusal`,
      });
      vi.mocked(calendar.getEvent).mockResolvedValue(refused);
      const db = store({
        claimPulls: vi.fn().mockResolvedValue([CONNECTION]),
        findSyncableLink: vi.fn().mockResolvedValue(link),
      });

      await drainCalendarSync({
        store: db,
        authorize: vi.fn().mockResolvedValue({ accessToken: "a", provider: calendar }),
        workerId: "worker-1",
      });

      expect(db.markRefused).toHaveBeenCalledWith(
        expect.objectContaining({ link, code: "all_day" }),
      );
      expect(db.commitPull).toHaveBeenCalledWith(
        expect.objectContaining({ cursor: `after-${linkState}-refusal` }),
      );
    },
  );

  it("has the Supabase store exclude only explicitly unlinked mappings", async () => {
    const recoveredLink: CalendarLinkRow = {
      ...LINK,
      link_state: "refused",
    };
    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      neq: vi.fn(),
      maybeSingle: vi.fn(),
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.neq.mockReturnValue(query);
    query.maybeSingle.mockResolvedValue({ data: recoveredLink, error: null });
    const from = vi.fn().mockReturnValue(query);
    const db = { from } as unknown as SupabaseClient;

    const result = await createCalendarSyncStore(db).findSyncableLink(
      CONNECTION.company_id,
      CONNECTION.id,
      LINK.provider_instance_id,
    );

    expect(result).toEqual(recoveredLink);
    expect(from).toHaveBeenCalledWith("task_calendar_links");
    expect(query.eq).toHaveBeenNthCalledWith(
      1,
      "company_id",
      CONNECTION.company_id,
    );
    expect(query.eq).toHaveBeenNthCalledWith(
      2,
      "connection_id",
      CONNECTION.id,
    );
    expect(query.eq).toHaveBeenNthCalledWith(
      3,
      "provider_instance_id",
      LINK.provider_instance_id,
    );
    expect(query.neq).toHaveBeenCalledWith("link_state", "unlinked");
  });

  it("clears stale due dates for every timing refusal but retains them for invalid titles", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { outcome: "refused" },
      error: null,
    });
    const db = { rpc } as unknown as SupabaseClient;
    const calendarStore = createCalendarSyncStore(db);
    const input = {
      connection: CONNECTION,
      link: LINK,
      remote: remote(LINK.provider_instance_id),
      detail: "provider occurrence is not actionable",
      workerId: "worker-1",
    };

    for (const code of [
      "all_day",
      "unknown_time_zone",
      "invalid_time",
    ] as const) {
      await calendarStore.markRefused({ ...input, code });
      expect(rpc).toHaveBeenLastCalledWith(
        "api_mark_calendar_refusal",
        expect.objectContaining({
          p_refusal_code: code,
          p_provider_version: input.remote.version,
          p_clear_due: true,
        }),
      );
    }

    await calendarStore.markRefused({ ...input, code: "invalid_title" });
    expect(rpc).toHaveBeenLastCalledWith(
      "api_mark_calendar_refusal",
      expect.objectContaining({
        p_refusal_code: "invalid_title",
        p_provider_version: input.remote.version,
        p_clear_due: false,
      }),
    );
  });

  it("keeps a Teams meeting body opaque while applying its time and title", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { outcome: "provider_applied" },
      error: null,
    });
    const calendarStore = createCalendarSyncStore(
      { rpc } as unknown as SupabaseClient,
    );
    const meeting = {
      ...remote(LINK.provider_instance_id),
      hasOnlineMeeting: true,
      description: "Teams meeting boilerplate and join URL",
    };

    await calendarStore.applyProviderEvent({
      connection: { ...CONNECTION, provider: "microsoft" },
      link: LINK,
      remote: meeting,
      workerId: "worker-1",
    });

    expect(rpc).toHaveBeenCalledWith(
      "api_apply_calendar_provider_snapshot",
      expect.objectContaining({
        p_start_at: BASE.start,
        p_title: BASE.title,
        p_description: meeting.description,
        p_preserve_description: true,
      }),
    );
  });

  it("does one full restart when a provider cursor expires", async () => {
    const calendar = provider();
    vi.mocked(calendar.listChanges)
      .mockRejectedValueOnce(
        new CalendarFullResyncRequiredError("google", "list changes"),
      )
      .mockResolvedValueOnce({
        events: [],
        nextPageToken: null,
        nextCursor: "fresh-cursor",
      });
    const db = store({ claimPulls: vi.fn().mockResolvedValue([CONNECTION]) });

    await drainCalendarSync({
      store: db,
      authorize: vi.fn().mockResolvedValue({ accessToken: "a", provider: calendar }),
      workerId: "worker-1",
      now: new Date("2026-08-25T12:00:00.000Z"),
    });

    expect(calendar.listChanges).toHaveBeenCalledTimes(2);
    expect(vi.mocked(calendar.listChanges).mock.calls[0]![0].cursor).toBe(
      "cursor-old",
    );
    expect(vi.mocked(calendar.listChanges).mock.calls[1]![0]).toMatchObject({
      cursor: undefined,
      rangeStart: "2026-05-27T12:00:00.000Z",
      rangeEnd: "2027-08-25T12:00:00.000Z",
    });
    expect(db.commitPull).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: "fresh-cursor" }),
    );
  });

  it("forgets incremental sightings when an expired cursor restarts as a full scan", async () => {
    const calendar = provider();
    vi.mocked(calendar.listChanges)
      .mockResolvedValueOnce({
        events: [changeNotice(remote(LINK.provider_instance_id))],
        nextPageToken: "incremental-page-2",
        nextCursor: null,
      })
      .mockRejectedValueOnce(
        new CalendarFullResyncRequiredError("google", "list changes"),
      )
      .mockResolvedValueOnce({
        events: [],
        nextPageToken: null,
        nextCursor: "fresh-cursor",
      });
    vi.mocked(calendar.getEvent).mockRejectedValue(
      new CalendarEventNotFoundError("google", "get event", 404),
    );
    const db = store({
      claimPulls: vi.fn().mockResolvedValue([CONNECTION]),
      findSyncableLink: vi.fn().mockResolvedValue(LINK),
      listSyncableLinks: vi.fn().mockResolvedValue([LINK]),
    });

    await drainCalendarSync({
      store: db,
      authorize: vi.fn().mockResolvedValue({ accessToken: "a", provider: calendar }),
      workerId: "worker-1",
    });

    expect(calendar.listChanges).toHaveBeenCalledTimes(3);
    expect(calendar.getEvent).toHaveBeenCalledWith(
      expect.objectContaining({ instanceId: LINK.provider_instance_id }),
    );
    expect(db.markEventRemoved).toHaveBeenCalledWith(
      expect.objectContaining({ link: LINK }),
    );
    expect(db.commitPull).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: "fresh-cursor" }),
    );
  });

  it("keeps the initial Google range unchanged across page tokens", async () => {
    const calendar = provider();
    vi.mocked(calendar.listChanges)
      .mockResolvedValueOnce({
        events: [],
        nextPageToken: "google-page-2",
        nextCursor: null,
      })
      .mockResolvedValueOnce({
        events: [],
        nextPageToken: null,
        nextCursor: "google-sync-token",
      });
    const connection = { ...CONNECTION, sync_cursor: null };
    const db = store({ claimPulls: vi.fn().mockResolvedValue([connection]) });

    await drainCalendarSync({
      store: db,
      authorize: vi.fn().mockResolvedValue({
        accessToken: "access",
        provider: calendar,
      }),
      workerId: "worker-1",
      now: new Date("2026-08-25T12:00:00.000Z"),
    });

    const [first, second] = vi.mocked(calendar.listChanges).mock.calls.map(
      ([input]) => input,
    );
    expect(second).toMatchObject({
      pageToken: "google-page-2",
      rangeStart: first?.rangeStart,
      rangeEnd: first?.rangeEnd,
    });
    expect(second?.rangeStart).toBe("2026-05-27T12:00:00.000Z");
    expect(second?.rangeEnd).toBe("2027-08-25T12:00:00.000Z");
  });

  it("records an explicit retry when a provider exceeds the page safety cap", async () => {
    const calendar = provider();
    let page = 0;
    vi.mocked(calendar.listChanges).mockImplementation(async () => ({
      events: [],
      nextPageToken: `page-${++page}`,
      nextCursor: null,
    }));
    const db = store({ claimPulls: vi.fn().mockResolvedValue([CONNECTION]) });

    await drainCalendarSync({
      store: db,
      authorize: vi.fn().mockResolvedValue({ accessToken: "a", provider: calendar }),
      workerId: "worker-1",
    });

    expect(calendar.listChanges).toHaveBeenCalledTimes(100);
    expect(db.commitPull).not.toHaveBeenCalled();
    expect(db.retryPull).toHaveBeenCalledWith(
      expect.objectContaining({
        connection: CONNECTION,
        errorCode: "calendar_sync_failed",
        errorDetail: "calendar provider exceeded the page safety limit",
      }),
    );
  });

  it("retries rows without letting a provider-operation 401 downgrade credentials", async () => {
    const second = { ...OUTBOX, id: "outbox-2", task_id: "task-2" };
    const db = store({
      claimOutbox: vi.fn().mockResolvedValue([OUTBOX, second]),
      getTask: vi.fn(async (id) => ({ ...TASK, id })),
    });
    const authorize = vi
      .fn()
      .mockRejectedValue(
        new CalendarReauthRequiredError("google", "refresh access token"),
      );

    await drainCalendarSync({ store: db, authorize, workerId: "worker-1" });

    expect(db.retryOutbox).toHaveBeenCalledTimes(2);
    expect(db.markProviderEffectStarted).not.toHaveBeenCalled();
    expect(db.retryOutbox).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        outbox: OUTBOX,
        requiresReauth: false,
        errorCode: "google_reauth",
      }),
    );
  });

  it("turns all-day mapped events into an explicit refusal", async () => {
    const calendar = provider();
    const allDay: CalendarRemoteEvent = {
      ...remote(LINK.provider_instance_id),
      inbound: { kind: "all_day" },
    };
    vi.mocked(calendar.listChanges).mockResolvedValue({
      events: [changeNotice(allDay)],
      nextPageToken: null,
      nextCursor: "next",
    });
    vi.mocked(calendar.getEvent).mockResolvedValue(allDay);
    const db = store({
      claimPulls: vi.fn().mockResolvedValue([CONNECTION]),
      findSyncableLink: vi.fn().mockResolvedValue(LINK),
    });

    await drainCalendarSync({
      store: db,
      authorize: vi.fn().mockResolvedValue({ accessToken: "a", provider: calendar }),
      workerId: "worker-1",
    });

    expect(db.markRefused).toHaveBeenCalledWith(
      expect.objectContaining({ code: "all_day", link: LINK }),
    );
  });

  it("re-reads a Graph delta tombstone before treating it as deletion", async () => {
    const calendar = provider();
    const removed: CalendarRemoteEvent = {
      ...remote(LINK.provider_instance_id),
      inbound: { kind: "removed" },
    };
    const moved = remote(LINK.provider_instance_id, {
      ...BASE,
      start: "2027-10-01T15:00:00.000Z",
      end: "2027-10-01T17:00:00.000Z",
    });
    vi.mocked(calendar.listChanges).mockResolvedValue({
      events: [changeNotice(removed)],
      nextPageToken: null,
      nextCursor: "after-window-move",
    });
    vi.mocked(calendar.getEvent).mockResolvedValue(moved);
    const connection = { ...CONNECTION, provider: "microsoft" as const };
    const db = store({
      claimPulls: vi.fn().mockResolvedValue([connection]),
      findSyncableLink: vi.fn().mockResolvedValue(LINK),
    });

    await drainCalendarSync({
      store: db,
      authorize: vi.fn().mockResolvedValue({ accessToken: "a", provider: calendar }),
      workerId: "worker-1",
    });

    expect(calendar.getEvent).toHaveBeenCalledWith(
      expect.objectContaining({ instanceId: LINK.provider_instance_id }),
    );
    expect(db.applyProviderEvent).toHaveBeenCalledWith(
      expect.objectContaining({ remote: moved }),
    );
    expect(db.markEventRemoved).not.toHaveBeenCalled();
    expect(db.commitPull).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: "after-window-move" }),
    );
  });

  it("marks a Graph tombstone removed only after direct GET confirms absence", async () => {
    const calendar = provider();
    const removed: CalendarRemoteEvent = {
      ...remote(LINK.provider_instance_id),
      inbound: { kind: "removed" },
    };
    vi.mocked(calendar.listChanges).mockResolvedValue({
      events: [changeNotice(removed)],
      nextPageToken: null,
      nextCursor: "after-real-removal",
    });
    vi.mocked(calendar.getEvent).mockRejectedValue(
      new CalendarEventNotFoundError("microsoft", "get event", 404),
    );
    const connection = { ...CONNECTION, provider: "microsoft" as const };
    const db = store({
      claimPulls: vi.fn().mockResolvedValue([connection]),
      findSyncableLink: vi.fn().mockResolvedValue(LINK),
    });

    await drainCalendarSync({
      store: db,
      authorize: vi.fn().mockResolvedValue({ accessToken: "a", provider: calendar }),
      workerId: "worker-1",
    });

    expect(db.markEventRemoved).toHaveBeenCalledWith(
      expect.objectContaining({
        remote: expect.objectContaining({
          instanceId: removed.instanceId,
          version: removed.version,
          inbound: { kind: "removed" },
        }),
      }),
    );
    expect(db.applyProviderEvent).not.toHaveBeenCalled();
    expect(db.commitPull).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: "after-real-removal" }),
    );
  });

  it("holds one invalid-title occurrence and still commits the provider cursor", async () => {
    const calendar = provider();
    const invalidTitle: CalendarRemoteEvent = {
      ...remote(LINK.provider_instance_id),
      inbound: { kind: "title_refused", reason: "too_long" },
    };
    vi.mocked(calendar.listChanges).mockResolvedValue({
      events: [changeNotice(invalidTitle)],
      nextPageToken: null,
      nextCursor: "after-invalid-title",
    });
    vi.mocked(calendar.getEvent).mockResolvedValue(invalidTitle);
    const db = store({
      claimPulls: vi.fn().mockResolvedValue([CONNECTION]),
      findSyncableLink: vi.fn().mockResolvedValue(LINK),
    });

    await drainCalendarSync({
      store: db,
      authorize: vi.fn().mockResolvedValue({ accessToken: "a", provider: calendar }),
      workerId: "worker-1",
    });

    expect(db.markRefused).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "invalid_title",
        detail: "too_long",
        link: LINK,
      }),
    );
    expect(db.commitPull).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: "after-invalid-title" }),
    );
    expect(db.retryPull).not.toHaveBeenCalled();
  });

  it("holds one malformed-time occurrence and still commits the provider cursor", async () => {
    const calendar = provider();
    const invalidTime: CalendarRemoteEvent = {
      ...remote(LINK.provider_instance_id),
      inbound: { kind: "time_refused", reason: "invalid_time" },
    };
    vi.mocked(calendar.listChanges).mockResolvedValue({
      events: [changeNotice(invalidTime)],
      nextPageToken: null,
      nextCursor: "after-invalid-time",
    });
    vi.mocked(calendar.getEvent).mockResolvedValue(invalidTime);
    const db = store({
      claimPulls: vi.fn().mockResolvedValue([CONNECTION]),
      findSyncableLink: vi.fn().mockResolvedValue(LINK),
    });

    await drainCalendarSync({
      store: db,
      authorize: vi.fn().mockResolvedValue({ accessToken: "a", provider: calendar }),
      workerId: "worker-1",
    });

    expect(db.markRefused).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "invalid_time",
        detail: "invalid_time",
        link: LINK,
      }),
    );
    expect(db.commitPull).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: "after-invalid-time" }),
    );
    expect(db.retryPull).not.toHaveBeenCalled();
  });

  it("holds a mapped event converted into a recurring series and advances the cursor", async () => {
    const calendar = provider();
    const recurring: CalendarRemoteEvent = {
      ...remote(LINK.provider_instance_id),
      inbound: { kind: "recurrence_refused" },
    };
    vi.mocked(calendar.listChanges).mockResolvedValue({
      events: [{
        instanceId: LINK.provider_instance_id,
        version: recurring.version,
        removed: false,
      }],
      nextPageToken: null,
      nextCursor: "after-recurrence",
    });
    vi.mocked(calendar.getEvent).mockResolvedValue(recurring);
    const db = store({
      claimPulls: vi.fn().mockResolvedValue([CONNECTION]),
      findSyncableLink: vi.fn().mockResolvedValue(LINK),
    });

    await drainCalendarSync({
      store: db,
      authorize: vi.fn().mockResolvedValue({ accessToken: "a", provider: calendar }),
      workerId: "worker-1",
    });

    expect(db.markRefused).toHaveBeenCalledWith(
      expect.objectContaining({ code: "recurrence", remote: recurring }),
    );
    expect(db.commitPull).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: "after-recurrence" }),
    );
  });

  it("accepts an atomic outside-window refusal without refreshing reminders or poisoning the cursor", async () => {
    const calendar = provider();
    const movedOutside = remote(LINK.provider_instance_id, {
      ...BASE,
      start: "2030-01-01T15:00:00.000Z",
      end: "2030-01-01T17:00:00.000Z",
    });
    vi.mocked(calendar.listChanges).mockResolvedValue({
      events: [{
        instanceId: LINK.provider_instance_id,
        version: movedOutside.version,
        removed: false,
      }],
      nextPageToken: null,
      nextCursor: "after-outside-window",
    });
    vi.mocked(calendar.getEvent).mockResolvedValue(movedOutside);
    const db = store({
      claimPulls: vi.fn().mockResolvedValue([CONNECTION]),
      findSyncableLink: vi.fn().mockResolvedValue(LINK),
      applyProviderEvent: vi.fn().mockResolvedValue({ outcome: "refused" }),
    });

    await drainCalendarSync({
      store: db,
      authorize: vi.fn().mockResolvedValue({ accessToken: "a", provider: calendar }),
      workerId: "worker-1",
    });

    expect(db.refreshTaskReminders).not.toHaveBeenCalled();
    expect(db.commitPull).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: "after-outside-window" }),
    );
    expect(db.retryPull).not.toHaveBeenCalled();
  });

  it("persists a replacement webhook before stopping the old capability", async () => {
    const calendar = provider();
    vi.mocked(calendar.startWatch).mockResolvedValue({
      subscriptionId: "new-channel",
      resourceId: "new-resource",
      expiration: "2026-08-31T12:00:00.000Z",
    });
    const db = store({
      claimWebhookRenewals: vi.fn().mockResolvedValue([SUBSCRIPTION]),
    });

    await drainCalendarSync({
      store: db,
      authorize: vi.fn().mockResolvedValue({
        accessToken: "access",
        provider: calendar,
      }),
      webhookCallbackUrl: (name) =>
        `https://api.example/calendar/webhooks/${name}`,
      workerId: "worker-1",
      now: new Date("2026-08-25T12:00:00.000Z"),
    });

    const watchInput = vi.mocked(calendar.startWatch).mock.calls[0]![0];
    expect(watchInput).toMatchObject({
      calendarId: CONNECTION.selected_calendar_id,
      callbackUrl: "https://api.example/calendar/webhooks/google",
      expiration: "2026-08-31T12:00:00.000Z",
    });
    expect(watchInput.clientState).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(watchInput.subscriptionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(db.claimWebhookRenewals).toHaveBeenCalledWith(
      "worker-1",
      25,
      120,
      86_400,
    );
    expect(db.commitWebhookRenewal).toHaveBeenCalledWith(
      expect.objectContaining({
        subscription: SUBSCRIPTION,
        workerId: "worker-1",
        providerSubscriptionId: "new-channel",
        providerResourceId: "new-resource",
        clientStateHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      }),
    );
    expect(calendar.stopWatch).toHaveBeenCalledWith({
      accessToken: "access",
      subscriptionId: "old-channel",
      resourceId: "old-resource",
    });
    expect(
      vi.mocked(db.commitWebhookRenewal).mock.invocationCallOrder[0],
    ).toBeLessThan(vi.mocked(calendar.stopWatch).mock.invocationCallOrder[0]!);
  });

  it("stops a durable webhook revocation before committing local cleanup", async () => {
    const calendar = provider();
    const db = store({
      claimWebhookRevocations: vi.fn().mockResolvedValue([SUBSCRIPTION]),
    });

    const result = await drainCalendarSync({
      store: db,
      authorize: vi.fn().mockResolvedValue({
        accessToken: "access",
        provider: calendar,
      }),
      workerId: "worker-1",
    });

    expect(calendar.stopWatch).toHaveBeenCalledWith({
      accessToken: "access",
      subscriptionId: SUBSCRIPTION.provider_subscription_id,
      resourceId: SUBSCRIPTION.provider_resource_id,
    });
    expect(db.commitWebhookRevocation).toHaveBeenCalledWith({
      subscription: SUBSCRIPTION,
      workerId: "worker-1",
    });
    expect(
      vi.mocked(calendar.stopWatch).mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(db.commitWebhookRevocation).mock.invocationCallOrder[0]!,
    );
    expect(result.revocations).toBe(1);
  });

  it("does not kill a possibly committed replacement when the commit response is lost", async () => {
    const calendar = provider();
    vi.mocked(calendar.startWatch).mockResolvedValue({
      subscriptionId: "provisional-channel",
      resourceId: "provisional-resource",
      expiration: "2026-08-31T12:00:00.000Z",
    });
    const db = store({
      claimWebhookRenewals: vi.fn().mockResolvedValue([SUBSCRIPTION]),
      commitWebhookRenewal: vi.fn().mockRejectedValue(new Error("database down")),
    });

    await drainCalendarSync({
      store: db,
      authorize: vi.fn().mockResolvedValue({
        accessToken: "access",
        provider: calendar,
      }),
      webhookCallbackUrl: () => "https://api.example/calendar/webhooks/google",
      workerId: "worker-1",
      now: new Date("2026-08-25T12:00:00.000Z"),
    });

    expect(calendar.stopWatch).not.toHaveBeenCalled();
    expect(db.retryWebhookRenewal).toHaveBeenCalledWith(
      expect.objectContaining({
        subscription: SUBSCRIPTION,
        errorCode: "calendar_sync_failed",
        requiresReauth: false,
      }),
    );
  });

  it("does not let a webhook API 401 downgrade a freshly reauthorized connection", async () => {
    const calendar = provider();
    vi.mocked(calendar.startWatch).mockRejectedValue(
      new CalendarReauthRequiredError("google", "start watch"),
    );
    const db = store({
      claimWebhookRenewals: vi.fn().mockResolvedValue([SUBSCRIPTION]),
    });

    await drainCalendarSync({
      store: db,
      authorize: vi.fn().mockResolvedValue({
        accessToken: "expired",
        provider: calendar,
      }),
      webhookCallbackUrl: () => "https://api.example/calendar/webhooks/google",
      workerId: "worker-1",
    });

    expect(db.retryWebhookRenewal).toHaveBeenCalledWith(
      expect.objectContaining({
        subscription: SUBSCRIPTION,
        errorCode: "google_reauth",
        requiresReauth: false,
      }),
    );
  });

  it("uses a sliding full-window reseed even when a cursor is stored", async () => {
    const calendar = provider();
    vi.mocked(calendar.listChanges).mockResolvedValue({
      events: [],
      nextPageToken: null,
      nextCursor: "reseeded-cursor",
    });
    const connection = { ...CONNECTION, pull_full_sync: true };
    const db = store({ claimPulls: vi.fn().mockResolvedValue([connection]) });

    await drainCalendarSync({
      store: db,
      authorize: vi.fn().mockResolvedValue({ accessToken: "a", provider: calendar }),
      workerId: "worker-1",
      now: new Date("2026-08-25T12:00:00.000Z"),
    });

    expect(calendar.listChanges).toHaveBeenCalledWith(
      expect.objectContaining({
        cursor: undefined,
        rangeStart: "2026-05-27T12:00:00.000Z",
        rangeEnd: "2027-08-25T12:00:00.000Z",
      }),
    );
    expect(db.commitPull).toHaveBeenCalledWith(
      expect.objectContaining({ connection, cursor: "reseeded-cursor" }),
    );
  });

  it("verifies mapped events absent from a fresh full window before committing", async () => {
    const calendar = provider();
    vi.mocked(calendar.listChanges).mockResolvedValue({
      events: [],
      nextPageToken: null,
      nextCursor: "reseeded-cursor",
    });
    vi.mocked(calendar.getEvent).mockRejectedValue(
      new CalendarEventNotFoundError("google", "get event", 404),
    );
    const connection = { ...CONNECTION, pull_full_sync: true };
    const db = store({
      claimPulls: vi.fn().mockResolvedValue([connection]),
      listSyncableLinks: vi.fn().mockResolvedValue([LINK]),
    });

    await drainCalendarSync({
      store: db,
      authorize: vi.fn().mockResolvedValue({ accessToken: "a", provider: calendar }),
      workerId: "worker-1",
      now: new Date("2026-08-25T12:00:00.000Z"),
    });

    expect(calendar.getEvent).toHaveBeenCalledWith(
      expect.objectContaining({ instanceId: LINK.provider_instance_id }),
    );
    expect(db.markEventRemoved).toHaveBeenCalledWith(
      expect.objectContaining({
        connection,
        link: LINK,
        remote: expect.objectContaining({ inbound: { kind: "removed" } }),
      }),
    );
    expect(db.commitPull).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: "reseeded-cursor" }),
    );
  });

  it("renews the pull lease before every page, mutation, and commit", async () => {
    const calendar = provider();
    const mapped = remote(LINK.provider_instance_id);
    vi.mocked(calendar.listChanges).mockResolvedValue({
      events: [changeNotice(mapped)],
      nextPageToken: null,
      nextCursor: "cursor-new",
    });
    const db = store({
      claimPulls: vi.fn().mockResolvedValue([CONNECTION]),
      findSyncableLink: vi.fn().mockResolvedValue(LINK),
    });

    await drainCalendarSync({
      store: db,
      authorize: vi.fn().mockResolvedValue({ accessToken: "a", provider: calendar }),
      workerId: "worker-1",
    });

    expect(db.renewPullLease).toHaveBeenCalledTimes(4);
    expect(vi.mocked(db.renewPullLease).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(calendar.listChanges).mock.invocationCallOrder[0]!,
    );
    expect(vi.mocked(db.renewPullLease).mock.invocationCallOrder[1]).toBeLessThan(
      vi.mocked(calendar.getEvent).mock.invocationCallOrder[0]!,
    );
    expect(vi.mocked(db.renewPullLease).mock.invocationCallOrder[2]).toBeLessThan(
      vi.mocked(db.applyProviderEvent).mock.invocationCallOrder[0]!,
    );
    expect(vi.mocked(db.renewPullLease).mock.invocationCallOrder[3]).toBeLessThan(
      vi.mocked(db.commitPull).mock.invocationCallOrder[0]!,
    );
  });

  it("does not treat a rejected inbound mutation outcome as success", async () => {
    const calendar = provider();
    vi.mocked(calendar.listChanges).mockResolvedValue({
      events: [changeNotice(remote(LINK.provider_instance_id))],
      nextPageToken: null,
      nextCursor: "cursor-new",
    });
    const db = store({
      claimPulls: vi.fn().mockResolvedValue([CONNECTION]),
      findSyncableLink: vi.fn().mockResolvedValue(LINK),
      applyProviderEvent: vi.fn().mockResolvedValue({ outcome: "not_found" }),
    });

    await drainCalendarSync({
      store: db,
      authorize: vi.fn().mockResolvedValue({ accessToken: "a", provider: calendar }),
      workerId: "worker-1",
    });

    expect(db.commitPull).not.toHaveBeenCalled();
    expect(db.retryPull).toHaveBeenCalledWith(
      expect.objectContaining({
        connection: CONNECTION,
        errorDetail: expect.stringContaining("unexpected outcome not_found"),
      }),
    );
  });

  it("stops stale pull work immediately when the lease is lost", async () => {
    const calendar = provider();
    const db = store({
      claimPulls: vi.fn().mockResolvedValue([CONNECTION]),
      renewPullLease: vi.fn().mockResolvedValue({ outcome: "lease_lost" }),
    });

    await drainCalendarSync({
      store: db,
      authorize: vi.fn().mockResolvedValue({ accessToken: "a", provider: calendar }),
      workerId: "worker-1",
    });

    expect(calendar.listChanges).not.toHaveBeenCalled();
    expect(db.retryPull).not.toHaveBeenCalled();
  });
});
