/**
 * Member-owned two-way calendar connection management (#245 / D137).
 *
 * This router is mounted under `/v1`, behind the normal JWT and workspace
 * middleware. Every read and mutation is additionally scoped to the caller's
 * user id: connecting a calendar grants long-lived access to that person's
 * schedule, so an owner cannot connect, inspect, or revoke it on their behalf.
 */
import { Hono } from "hono";
import { z } from "zod";

import { requireCapability } from "../auth/company";
import {
  authorizeCalendarConnection,
  CalendarCredentialRefreshUnavailableError,
  type CalendarCredentialClaimResult,
  type CalendarCredentialMutationResult,
} from "../calendar/authorization";
import {
  calendarProviderIsConfigured,
  getCalendarProviderConfiguration,
} from "../calendar/config";
import {
  createCalendarOauthProof,
  sealCalendarCredential,
} from "../calendar/crypto";
import {
  googleAuthorizationUrl,
} from "../calendar/providers/google";
import {
  microsoftAuthorizationUrl,
} from "../calendar/providers/microsoft";
import {
  CalendarProviderError,
  type CalendarProvider,
  type CalendarProviderName,
  type CalendarRemoteEvent,
} from "../calendar/providers/types";
import type { AppEnv } from "../context";
import { getDb } from "../db";
import { getEnv } from "../env";
import { ApiError } from "../http/errors";
import {
  parseJsonBody,
  parseLimit,
  pathUuid,
  unwrap,
} from "./core/http";

export const calendarConnectionRoutes = new Hono<AppEnv>();

interface CalendarConnectionRow {
  id: string;
  provider: CalendarProviderName;
  status: "active" | "reauth_required" | "disconnected";
  provider_account_id: string;
  provider_account_label: string | null;
  selected_calendar_id: string;
  selected_calendar_name: string | null;
  last_verified_at: string | null;
  last_sync_completed_at: string | null;
  last_error_code: string | null;
}

interface CalendarOwnerDisclosureRow {
  connection_id: string;
  provider: CalendarProviderName;
  reason: "reauth_required" | "sync_stale" | "cleanup_failed";
  occurred_at: string;
  push_delivered_at: string | null;
}

interface CalendarSnapshotRow {
  start?: unknown;
  end?: unknown;
  timeZone?: unknown;
  title?: unknown;
  descriptionHash?: unknown;
}

interface CalendarAttentionRow {
  link_id: string;
  task_id: string;
  connection_id: string;
  provider: CalendarProviderName;
  provider_calendar_id: string;
  provider_calendar_name: string | null;
  provider_calendar_timezone: string;
  provider_instance_id: string | null;
  provider_version: string | null;
  link_state: "conflict" | "event_removed" | "refused";
  provider_condition: "conflict" | "event_removed" | "refused";
  task_title: string;
  task_due_at: string | null;
  ours_snapshot: CalendarSnapshotRow | null;
  theirs_snapshot: CalendarSnapshotRow | null;
  ours_changed_at: string | null;
  ours_changed_by: string | null;
  ours_changed_by_name: string | null;
  provider_observed_at: string | null;
  attention_at: string;
  refusal_code: string | null;
  refusal_detail: string | null;
}

function refusalFromRemote(remote: CalendarRemoteEvent): {
  code: string;
  detail: string;
} | null {
  switch (remote.inbound.kind) {
    case "all_day":
      return { code: "all_day", detail: "Provider event is all-day" };
    case "zone_refused":
      return {
        code: "unknown_time_zone",
        detail: remote.inbound.providerZone,
      };
    case "title_refused":
      return { code: "invalid_title", detail: remote.inbound.reason };
    case "time_refused":
      return { code: "invalid_time", detail: remote.inbound.reason };
    case "description_refused":
      return { code: "description_too_long", detail: remote.inbound.reason };
    case "recurrence_refused":
      return {
        code: "recurrence",
        detail: "Provider event became a recurring series",
      };
    case "scheduled":
    case "removed":
      return null;
  }
}

interface CalendarAttentionResult {
  outcome: "found" | "not_found";
  attention?: CalendarAttentionRow;
}

interface OwnedCalendarCredentialRow {
  id: string;
  provider: CalendarProviderName;
  provider_account_id: string;
  selected_calendar_id: string;
  selected_calendar_timezone: string;
  credential_generation: number;
}

const attentionResolutionSchema = z
  .object({
    action: z.enum([
      "use_app",
      "use_calendar",
      "cancelled",
      "moved",
      "not_sure",
    ]),
    new_due_at: z.iso.datetime({ offset: true }).optional(),
  })
  .strict();

function providerFromPath(raw: string): CalendarProviderName {
  if (raw === "google" || raw === "microsoft") return raw;
  throw new ApiError("not_found", "No such calendar provider.");
}

function connectorUnavailable(provider: CalendarProviderName): ApiError {
  return new ApiError(
    "service_unavailable",
    `${provider === "google" ? "Google" : "Microsoft"} Calendar is not configured.`,
  );
}

function snapshotView(snapshot: CalendarSnapshotRow | null) {
  if (
    !snapshot ||
    typeof snapshot.start !== "string" ||
    typeof snapshot.end !== "string" ||
    typeof snapshot.timeZone !== "string" ||
    typeof snapshot.title !== "string"
  ) {
    return null;
  }
  return {
    start: snapshot.start,
    end: snapshot.end,
    time_zone: snapshot.timeZone,
    title: snapshot.title,
  };
}

function attentionView(row: CalendarAttentionRow) {
  const ours = snapshotView(row.ours_snapshot);
  const theirs = snapshotView(row.theirs_snapshot);
  return {
    id: row.link_id,
    state: row.link_state,
    provider_condition: row.provider_condition,
    task: {
      id: row.task_id,
      title: row.task_title,
      due_at: row.task_due_at,
    },
    connection: {
      id: row.connection_id,
      provider: row.provider,
      calendar_label:
        row.provider_calendar_name ?? row.provider_calendar_id,
      time_zone: row.provider_calendar_timezone,
    },
    ours,
    theirs,
    differences: {
      start: Boolean(ours && theirs && ours.start !== theirs.start),
      end: Boolean(ours && theirs && ours.end !== theirs.end),
      time_zone: Boolean(
        ours && theirs && ours.time_zone !== theirs.time_zone,
      ),
      title: Boolean(ours && theirs && ours.title !== theirs.title),
      description: Boolean(
        row.ours_snapshot &&
          row.theirs_snapshot &&
          row.ours_snapshot.descriptionHash !==
            row.theirs_snapshot.descriptionHash,
      ),
    },
    display_timestamps: {
      ours_changed_at: row.ours_changed_at,
      provider_observed_at: row.provider_observed_at,
      attention_at: row.attention_at,
    },
    ours_changed_by: row.ours_changed_by
      ? {
          id: row.ours_changed_by,
          name: row.ours_changed_by_name,
        }
      : null,
    refusal: row.refusal_code
      ? { code: row.refusal_code, detail: row.refusal_detail }
      : null,
  };
}

async function ownAttention(
  env: ReturnType<typeof getEnv>,
  companyId: string,
  userId: string,
  linkId: string,
): Promise<CalendarAttentionRow> {
  const result = unwrap<CalendarAttentionResult>(
    await getDb(env).rpc("api_get_calendar_attention", {
      p_company_id: companyId,
      p_user_id: userId,
      p_link_id: linkId,
    }),
    "calendar attention detail",
  );
  if (result.outcome !== "found" || !result.attention) {
    throw new ApiError("not_found", "No such calendar attention item.");
  }
  return result.attention;
}

async function authorizedProviderForAttention(input: {
  env: ReturnType<typeof getEnv>;
  companyId: string;
  userId: string;
  connectionId: string;
  expectedProvider: CalendarProviderName;
}): Promise<{
  accessToken: string;
  connection: OwnedCalendarCredentialRow;
  provider: CalendarProvider;
}> {
  const db = getDb(input.env);
  const rows = unwrap<OwnedCalendarCredentialRow[]>(
    await db
      .from("calendar_connections")
      .select(
        "id,provider,provider_account_id,selected_calendar_id," +
          "selected_calendar_timezone,credential_generation",
      )
      .eq("id", input.connectionId)
      .eq("company_id", input.companyId)
      .eq("user_id", input.userId)
      .eq("status", "active")
      .is("revoked_at", null)
      .limit(1),
    "calendar attention connection",
  );
  const connection = rows[0];
  if (!connection || connection.provider !== input.expectedProvider) {
    throw new ApiError("not_found", "No such calendar attention item.");
  }
  const workerId = `attention:${crypto.randomUUID()}`;
  const store = {
    claimCredentialRefresh: async (claimInput: {
      connection: {
        id: string;
        company_id: string;
        user_id: string;
        credential_generation: number;
      };
      workerId: string;
      leaseSeconds: number;
    }) =>
      unwrap<CalendarCredentialClaimResult>(
        await db.rpc("api_claim_calendar_credential_refresh", {
          p_company_id: claimInput.connection.company_id,
          p_connection_id: claimInput.connection.id,
          p_user_id: claimInput.connection.user_id,
          p_worker_id: claimInput.workerId,
          p_expected_generation:
            claimInput.connection.credential_generation,
          p_lease_seconds: claimInput.leaseSeconds,
        }),
        "calendar attention credential claim",
      ),
    commitCredentialRefresh: async (commitInput: {
      connectionId: string;
      workerId: string;
      expectedGeneration: number;
      credential: {
        ciphertext: string;
        iv: string;
        keyVersion: string;
      };
    }) =>
      unwrap<CalendarCredentialMutationResult>(
        await db.rpc("api_commit_calendar_credential_refresh", {
          p_connection_id: commitInput.connectionId,
          p_worker_id: commitInput.workerId,
          p_expected_generation: commitInput.expectedGeneration,
          p_credential_ciphertext: commitInput.credential.ciphertext,
          p_credential_iv: commitInput.credential.iv,
          p_credential_key_version: commitInput.credential.keyVersion,
        }),
        "calendar attention credential commit",
      ),
    retryCredentialRefresh: async (retryInput: {
      connectionId: string;
      workerId: string;
      expectedGeneration: number;
      requiresReauth: boolean;
      errorCode: string;
      errorDetail: string;
    }) =>
      unwrap<CalendarCredentialMutationResult>(
        await db.rpc("api_retry_calendar_credential_refresh", {
          p_connection_id: retryInput.connectionId,
          p_worker_id: retryInput.workerId,
          p_expected_generation: retryInput.expectedGeneration,
          p_requires_reauth: retryInput.requiresReauth,
          p_error_code: retryInput.errorCode,
          p_error_detail: retryInput.errorDetail,
        }),
        "calendar attention credential retry",
      ),
  };
  let authorized;
  try {
    authorized = await authorizeCalendarConnection({
      env: input.env,
      store,
      connection: {
        ...connection,
        company_id: input.companyId,
        user_id: input.userId,
      },
      workerId,
      fetcher: fetch,
    });
  } catch (error) {
    if (
      error instanceof CalendarCredentialRefreshUnavailableError ||
      (error instanceof CalendarProviderError && error.kind === "reauth")
    ) {
      throw new ApiError(
        "conflict",
        error instanceof CalendarCredentialRefreshUnavailableError &&
            error.outcome === "busy"
          ? "Calendar authorization is already refreshing. Try again shortly."
          : "Reconnect this calendar before resolving the item.",
      );
    }
    throw error;
  }
  return {
    accessToken: authorized.accessToken,
    connection,
    provider: authorized.provider,
  };
}

function resolutionResult<T extends { outcome: string }>(
  result: T,
  successfulOutcomes: readonly string[],
): T {
  if (successfulOutcomes.includes(result.outcome)) return result;

  if (result.outcome === "not_found") {
    throw new ApiError("not_found", "No such calendar attention item.");
  }
  if (result.outcome === "date_required") {
    throw new ApiError(
      "validation_failed",
      "new_due_at is required when a removed event is moved.",
    );
  }
  if (result.outcome === "disconnected") {
    throw new ApiError(
      "conflict",
      "The calendar connection changed. Reconnect and try again.",
    );
  }
  if (result.outcome === "task_ineligible") {
    throw new ApiError(
      "conflict",
      "The linked task is no longer eligible for calendar sync.",
    );
  }
  if (
    result.outcome === "app_snapshot_required" ||
    result.outcome === "attention_stale"
  ) {
    throw new ApiError(
      "conflict",
      "The app schedule changed. Refresh the calendar item before choosing a version.",
    );
  }
  if (result.outcome === "outside_sync_window") {
    throw new ApiError(
      "conflict",
      "That date is outside the calendar sync window.",
    );
  }
  if (result.outcome === "provider_condition_changed") {
    throw new ApiError(
      "conflict",
      "The calendar occurrence is no longer a usable schedule. Refresh and choose the app version or leave it flagged.",
    );
  }
  if (
    result.outcome === "provider_instance_mismatch" ||
    result.outcome === "provider_version_required"
  ) {
    throw new ApiError(
      "conflict",
      "The calendar occurrence changed. Refresh and try again.",
    );
  }

  // RPC outcomes are a server/client contract. Treat an unknown or stale
  // outcome as a conflict instead of showing a successful resolution toast.
  throw new ApiError(
    "conflict",
    "The calendar item changed. Refresh and try again.",
  );
}

async function observeConflictCondition(input: {
  db: ReturnType<typeof getDb>;
  companyId: string;
  userId: string;
  attention: CalendarAttentionRow;
  condition: "event_removed" | "refused";
  observedVersion: string | null;
  refusal?: { code: string; detail: string };
}): Promise<never> {
  const result = resolutionResult(
    unwrap<{ outcome: string }>(
      await input.db.rpc("api_observe_calendar_conflict_condition", {
        p_company_id: input.companyId,
        p_user_id: input.userId,
        p_link_id: input.attention.link_id,
        p_expected_provider_instance_id:
          input.attention.provider_instance_id,
        p_expected_app_snapshot: input.attention.ours_snapshot,
        p_expected_provider_version: input.attention.provider_version,
        p_provider_condition: input.condition,
        p_observed_provider_version: input.observedVersion,
        p_refusal_code: input.refusal?.code ?? null,
        p_refusal_detail: input.refusal?.detail ?? null,
      }),
      "calendar conflict provider observation",
    ),
    ["observed"],
  );
  throw new ApiError(
    "conflict",
    result.outcome === "observed"
      ? "The calendar occurrence changed. Refresh this item before choosing a version."
      : "The calendar item changed. Refresh and try again.",
  );
}

calendarConnectionRoutes.get(
  "/calendar/connections",
  requireCapability("conversations.read"),
  async (c) => {
    const env = getEnv(c.env);
    const db = getDb(env);
    const companyId = c.get("companyId");
    const userId = c.get("userId");

    const connections = unwrap<CalendarConnectionRow[]>(
      await db
        .from("calendar_connections")
        .select(
          "id,provider,status,provider_account_id,provider_account_label," +
            "selected_calendar_id,selected_calendar_name,last_verified_at," +
            "last_sync_completed_at,last_error_code",
        )
        .eq("company_id", companyId)
        .eq("user_id", userId)
        .is("revoked_at", null)
        .order("created_at", { ascending: true }),
      "calendar connection list",
    );

    const ids = connections.map((connection) => connection.id);
    const conflicts = ids.length === 0
      ? []
      : unwrap<{ connection_id: string }[]>(
          await db
            .from("task_calendar_links")
            .select("connection_id")
            .eq("company_id", companyId)
            .eq("link_state", "conflict")
            .in("connection_id", ids),
          "calendar conflict count",
        );
    const conflictCounts = new Map<string, number>();
    for (const conflict of conflicts) {
      conflictCounts.set(
        conflict.connection_id,
        (conflictCounts.get(conflict.connection_id) ?? 0) + 1,
      );
    }
    const disclosures = unwrap<CalendarOwnerDisclosureRow[]>(
      await db.rpc("api_list_calendar_owner_disclosures", {
        p_company_id: companyId,
        p_user_id: userId,
      }),
      "calendar owner disclosures",
    );

    return c.json({
      connections: connections.map((connection) => ({
        id: connection.id,
        provider: connection.provider,
        status: connection.status,
        account_label:
          connection.provider_account_label ?? connection.provider_account_id,
        calendar_label:
          connection.selected_calendar_name ?? connection.selected_calendar_id,
        last_verified_at: connection.last_verified_at,
        last_sync_at: connection.last_sync_completed_at,
        last_error_key: connection.last_error_code,
        conflict_count: conflictCounts.get(connection.id) ?? 0,
      })),
      disclosures,
      configured: {
        google: calendarProviderIsConfigured(env, "google"),
        microsoft: calendarProviderIsConfigured(env, "microsoft"),
      },
    });
  },
);

calendarConnectionRoutes.get(
  "/calendar/attention",
  requireCapability("conversations.read"),
  async (c) => {
    const env = getEnv(c.env);
    const rows = unwrap<CalendarAttentionRow[]>(
      await getDb(env).rpc("api_list_calendar_attention", {
        p_company_id: c.get("companyId"),
        p_user_id: c.get("userId"),
        p_limit: parseLimit(c, 50, 100),
      }),
      "calendar attention list",
    );
    return c.json({ attention: rows.map(attentionView) });
  },
);

calendarConnectionRoutes.get(
  "/calendar/attention/:id",
  requireCapability("conversations.read"),
  async (c) => {
    const env = getEnv(c.env);
    const attention = await ownAttention(
      env,
      c.get("companyId"),
      c.get("userId"),
      pathUuid(c, "id"),
    );
    return c.json({ attention: attentionView(attention) });
  },
);

calendarConnectionRoutes.post(
  "/calendar/attention/:id/resolve",
  requireCapability("conversations.note"),
  async (c) => {
    const linkId = pathUuid(c, "id");
    const body = await parseJsonBody(c, attentionResolutionSchema);
    const env = getEnv(c.env);
    const companyId = c.get("companyId");
    const userId = c.get("userId");
    const attention = await ownAttention(env, companyId, userId, linkId);
    const db = getDb(env);

    if (attention.link_state === "conflict") {
      if (!["use_app", "use_calendar", "not_sure"].includes(body.action)) {
        throw new ApiError(
          "validation_failed",
          "action must be use_app, use_calendar, or not_sure for a conflict.",
        );
      }
      if (body.new_due_at !== undefined) {
        throw new ApiError(
          "validation_failed",
          "new_due_at is only valid when a removed event is moved.",
        );
      }

      if (body.action !== "use_calendar") {
        const result = resolutionResult(
          unwrap<{ outcome: string }>(
            await db.rpc("api_resolve_calendar_conflict", {
              p_company_id: companyId,
              p_user_id: userId,
              p_link_id: linkId,
              p_resolution: body.action,
              ...(body.action === "use_app"
                ? { p_expected_app_snapshot: attention.ours_snapshot }
                : {}),
            }),
            "calendar conflict resolution",
          ),
          ["queued", "still_flagged"],
        );
        return c.json(result);
      }

      if (!attention.provider_instance_id) {
        throw new ApiError(
          "conflict",
          "The calendar occurrence changed. Refresh and try again.",
        );
      }
      if (
        attention.provider_condition === "event_removed" ||
        attention.provider_condition === "refused"
      ) {
        throw new ApiError(
          "conflict",
          "The calendar occurrence is no longer a usable schedule. Choose the app version or leave it flagged.",
        );
      }
      const authorized = await authorizedProviderForAttention({
        env,
        companyId,
        userId,
        connectionId: attention.connection_id,
        expectedProvider: attention.provider,
      });
      let remote;
      try {
        remote = await authorized.provider.getEvent({
          accessToken: authorized.accessToken,
          calendarId: authorized.connection.selected_calendar_id,
          instanceId: attention.provider_instance_id,
          calendarTimeZone: authorized.connection.selected_calendar_timezone,
          connectedAccountEmail: authorized.connection.provider_account_id,
        });
      } catch (error) {
        if (
          error instanceof CalendarProviderError &&
          error.kind === "not_found"
        ) {
          await observeConflictCondition({
            db,
            companyId,
            userId,
            attention,
            condition: "event_removed",
            observedVersion: null,
          });
          throw new ApiError(
            "conflict",
            "The calendar occurrence changed. Refresh and try again.",
          );
        }
        throw error;
      }
      if (remote.inbound.kind === "removed") {
        await observeConflictCondition({
          db,
          companyId,
          userId,
          attention,
          condition: "event_removed",
          observedVersion: remote.version,
        });
      }
      const refusal = refusalFromRemote(remote);
      if (refusal) {
        await observeConflictCondition({
          db,
          companyId,
          userId,
          attention,
          condition: "refused",
          observedVersion: remote.version,
          refusal,
        });
      }
      if (remote.inbound.kind !== "scheduled" || !remote.version) {
        throw new ApiError(
          "conflict",
          "The calendar occurrence changed. Refresh and try again.",
        );
      }
      const result = resolutionResult(
        unwrap<{ outcome: string }>(
          await db.rpc("api_resolve_calendar_conflict", {
            p_company_id: companyId,
            p_user_id: userId,
            p_link_id: linkId,
            p_resolution: "use_calendar",
            p_provider_instance_id: remote.instanceId,
            p_provider_version: remote.version,
            p_start_at: remote.inbound.schedule.start,
            p_end_at: remote.inbound.schedule.end,
            p_time_zone: remote.inbound.schedule.timeZone,
            p_title: remote.inbound.schedule.title,
            p_description: remote.description,
            p_expected_app_snapshot: attention.ours_snapshot,
          }),
          "calendar conflict resolution",
        ),
        ["resolved"],
      );
      return c.json(result);
    }

    if (attention.link_state === "event_removed") {
      if (!["cancelled", "moved", "not_sure"].includes(body.action)) {
        throw new ApiError(
          "validation_failed",
          "action must be cancelled, moved, or not_sure for a removed event.",
        );
      }
      if (body.action === "moved" && body.new_due_at === undefined) {
        throw new ApiError(
          "validation_failed",
          "new_due_at is required when a removed event is moved.",
        );
      }
      if (body.action !== "moved" && body.new_due_at !== undefined) {
        throw new ApiError(
          "validation_failed",
          "new_due_at is only valid with the moved action.",
        );
      }
      const result = resolutionResult(
        unwrap<{ outcome: string }>(
          await db.rpc("api_resolve_calendar_event_removed", {
            p_company_id: companyId,
            p_user_id: userId,
            p_link_id: linkId,
            p_answer: body.action,
            ...(body.action === "moved"
              ? { p_new_due_at: body.new_due_at }
              : {}),
          }),
          "calendar removed-event resolution",
        ),
        ["cancelled", "moved", "still_flagged"],
      );
      return c.json(result);
    }

    throw new ApiError(
      "conflict",
      "This calendar item cannot be resolved from this action.",
    );
  },
);

calendarConnectionRoutes.post(
  "/calendar/connections/:provider/authorize",
  // A connected calendar can reschedule its mapped tasks through the worker,
  // so observer access would become a write-capability bypass.
  requireCapability("conversations.note"),
  async (c) => {
    const provider = providerFromPath(c.req.param("provider"));
    const env = getEnv(c.env);
    if (!calendarProviderIsConfigured(env, provider)) {
      throw connectorUnavailable(provider);
    }

    const configuration = getCalendarProviderConfiguration(env, provider);
    const companyId = c.get("companyId");
    const userId = c.get("userId");
    const proof = await createCalendarOauthProof();
    const sealedVerifier = await sealCalendarCredential(
      proof.verifier,
      { companyId, userId, provider, purpose: "oauth_pkce_verifier" },
      configuration.keyring,
    );

    const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
    unwrap<string>(
      await getDb(env).rpc("api_create_calendar_oauth_state", {
        p_company_id: companyId,
        p_user_id: userId,
        p_provider: provider,
        p_state_hash: proof.stateHash,
        p_verifier_ciphertext: sealedVerifier.ciphertext,
        p_verifier_iv: sealedVerifier.iv,
        p_verifier_key_version: sealedVerifier.keyVersion,
        p_redirect_uri: configuration.oauth.redirectUri,
        // Persisted for an operator to diagnose an abandoned flow, but never
        // trusted by the callback. The callback builds its redirect from the
        // validated APP_ORIGIN every time.
        p_return_to: `${env.APP_ORIGIN}/settings/profile`,
        p_expires_at: expiresAt,
      }),
      "calendar OAuth state create",
    );

    const url = provider === "google"
      ? googleAuthorizationUrl({
          clientId: configuration.oauth.clientId,
          redirectUri: configuration.oauth.redirectUri,
          state: proof.state,
          codeChallenge: proof.challenge,
        })
      : microsoftAuthorizationUrl({
          clientId: configuration.oauth.clientId,
          redirectUri: configuration.oauth.redirectUri,
          state: proof.state,
          codeChallenge: proof.challenge,
          tenant: configuration.tenant,
        });

    return c.json({ url });
  },
);

calendarConnectionRoutes.delete(
  "/calendar/connections/:id",
  requireCapability("conversations.note"),
  async (c) => {
    const id = pathUuid(c, "id");
    const env = getEnv(c.env);
    const db = getDb(env);
    const companyId = c.get("companyId");
    const userId = c.get("userId");

    const owned = unwrap<{ id: string }[]>(
      await db
        .from("calendar_connections")
        .select("id")
        .eq("id", id)
        .eq("company_id", companyId)
        .eq("user_id", userId)
        .is("revoked_at", null)
        .limit(1),
      "calendar connection ownership",
    );
    if (!owned[0]) {
      throw new ApiError("not_found", "No such calendar connection.");
    }

    const revoked = unwrap<{
      outcome: "revoked" | "disconnecting" | "busy" | "superseded";
      count?: number;
      reason?: string;
    }>(
      await db.rpc("api_revoke_calendar_connection", {
        p_company_id: companyId,
        p_user_id: userId,
        p_connection_id: id,
      }),
      "calendar connection revoke",
    );
    if (revoked.outcome === "busy") {
      throw new ApiError(
        "conflict",
        "Calendar sync is finishing a provider operation. Try disconnecting again shortly.",
      );
    }
    if (revoked.outcome === "superseded") {
      throw new ApiError(
        "conflict",
        "The calendar connection changed. Refresh before disconnecting it.",
      );
    }
    // Remote watches and mapped event cleanup drain durably before the sealed
    // credential is erased. A 202 is truthful about that asynchronous phase;
    // an already-clean connection can still finalize synchronously with 204.
    return c.body(null, revoked.outcome === "disconnecting" ? 202 : 204);
  },
);
