"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CalendarSync,
  CheckCircle2,
  CloudOff,
  RefreshCw,
  Unplug,
} from "lucide-react";
import { toast } from "sonner";

import { CalendarAttentionPanel, calendarProviderName, offersCalendarAction } from "@/components/calendar/calendar-attention-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from '@/i18n/provider';
import type { Translate } from '@/i18n/provider';
import { useAuthorizeCalendarConnection, useCalendarConnections, useDisconnectCalendarConnection } from '@/lib/api/calendar';
import type { CalendarConnection, CalendarProvider } from '@/lib/api/calendar';
import { formatTimestamp } from "@/lib/format/time";

const PROVIDERS = ["google", "microsoft"] as const;

function connectLabel(t: Translate, provider: CalendarProvider): string {
  return provider === "google"
    ? t("calendarFeed.connectGoogle")
    : t("calendarFeed.connectMicrosoft");
}

function relative(iso: string, t: Translate): string {
  return formatTimestamp(iso, { style: "long", t });
}

function ConnectionStatus({ connection }: { connection: CalendarConnection }) {
  const t = useT();

  if (connection.status === "active") {
    return (
      <Badge className="border-transparent bg-success/10 text-success">
        <CheckCircle2 aria-hidden />
        {t("calendarFeed.connected")}
      </Badge>
    );
  }

  if (connection.status === "reauth_required") {
    return (
      <Badge className="border-transparent bg-warning/10 text-amber-800 dark:text-warning">
        <RefreshCw aria-hidden />
        {t("calendarFeed.reauthRequired")}
      </Badge>
    );
  }

  if (connection.status === "disconnected") {
    return (
      <Badge variant="secondary">
        <CloudOff aria-hidden />
        {t("calendarFeed.disconnected")}
      </Badge>
    );
  }

  // A new server state must not leak an enum into the interface. Until this
  // client learns the state, the only honest promise is that it needs review.
  return (
    <Badge variant="destructive">
      <AlertTriangle aria-hidden />
      {t("calendarFeed.needsAttention")}
    </Badge>
  );
}

/**
 * #245 — writable Google/Microsoft calendars. #744: rendered inside the one
 * Calendar section, as its first option.
 *
 * The disclosure is intentionally visible at rest. Connecting revokes a live
 * credential and changes which copy can be dragged, so burying that fact in an
 * OAuth consent screen would tell somebody only after the consequential click.
 */
export function CalendarConnectionsCard() {
  const t = useT();
  const view = useCalendarConnections();
  const authorize = useAuthorizeCalendarConnection();
  const disconnect = useDisconnectCalendarConnection();
  const [confirmingDisconnect, setConfirmingDisconnect] = useState<string | null>(
    null,
  );
  const handledOauthOutcome = useRef<string | null>(null);

  useEffect(() => {
    const url = new URL(window.location.href);
    const outcome = url.searchParams.get("calendar");
    if (
      outcome !== "connected" &&
      outcome !== "failed" &&
      outcome !== "replacement_requires_disconnect" &&
      outcome !== "disconnect_in_progress"
    ) return;
    if (handledOauthOutcome.current === url.href) return;
    handledOauthOutcome.current = url.href;

    if (outcome === "connected") {
      toast.success(t("calendarFeed.connectedToast"));
    } else if (outcome === "replacement_requires_disconnect") {
      toast.error(t("calendarFeed.replacementRequiresDisconnect"));
    } else if (outcome === "disconnect_in_progress") {
      toast.error(t("calendarFeed.disconnectInProgress"));
    } else {
      toast.error(t("calendarFeed.authorizationFailed"));
    }

    url.searchParams.delete("calendar");
    const query = url.searchParams.toString();
    window.history.replaceState(
      window.history.state,
      "",
      `${url.pathname}${query ? `?${query}` : ""}${url.hash}`,
    );
  }, [t]);

  const connections = view.data?.connections ?? [];
  const disclosures = view.data?.disclosures ?? [];
  const cleanupInProgress = connections.some(
    (connection) => connection.status === "disconnected",
  );
  const connectedProviders = new Set(
    connections.map((connection) => connection.provider),
  );

  function startAuthorization(provider: CalendarProvider) {
    authorize.mutate(
      { provider },
      {
        onSuccess: ({ url }) => window.location.assign(url),
        onError: () => toast.error(t("calendarFeed.authorizationFailed")),
      },
    );
  }

  function disconnectConnection(id: string) {
    disconnect.mutate(id, {
      onSuccess: () => {
        setConfirmingDisconnect(null);
        toast.success(t("calendarFeed.disconnectedToast"));
      },
      onError: () => toast.error(t("calendarFeed.disconnectFailed")),
    });
  }

  return (
    <div id="calendar-two-way">
      <div className="space-y-5">
        <p
          id="calendar-connection-disclosure"
          className="text-sm leading-relaxed text-muted-foreground"
        >
          {t("calendarFeed.twoWayDisclosure")}
        </p>

        {view.isLoading ? (
          <div role="status">
            <span className="sr-only">
              {t("calendarFeed.connectionsLoading")}
            </span>
            <div className="space-y-3" aria-hidden>
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-9 w-72 max-w-full" />
            </div>
          </div>
        ) : (view.isError ? (
          <div role="alert" className="space-y-2">
            <p className="text-sm text-destructive">
              {t("calendarFeed.connectionsLoadFailed")}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void view.refetch()}
            >
              {t("calendarFeed.retryConnections")}
            </Button>
          </div>
        ) : (
          <>
            {disclosures.length > 0 && (
              <ul className="space-y-2">
                {disclosures.map((disclosure) => (
                  <li
                    key={`${disclosure.connection_id}:${disclosure.reason}`}
                    role="status"
                    className="flex items-start gap-2 rounded-md bg-warning/10 px-3 py-2 text-sm text-amber-800 dark:text-warning"
                  >
                    <AlertTriangle
                      className="mt-0.5 size-4 shrink-0"
                      aria-hidden
                    />
                    {disclosure.reason === "cleanup_failed"
                      ? t("calendarFeed.connectionCleanupFailed")
                      : (disclosure.reason === "sync_stale"
                        ? t("calendarFeed.connectionStale")
                        : t("calendarFeed.connectionError"))}
                  </li>
                ))}
              </ul>
            )}
            {connections.length > 0 && (
              <ul className="divide-y divide-border-subtle rounded-lg border">
                {connections.map((connection) => {
                  const reconnect = connection.status === "reauth_required";
                  const cleaningUp = connection.status === "disconnected";
                  const retrying =
                    connection.status === "active" &&
                    connection.last_error_key !== null;
                  const disconnecting =
                    disconnect.isPending && disconnect.variables === connection.id;
                  return (
                    <li key={connection.id} className="space-y-4 p-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0 space-y-1">
                          <h3 className="font-medium">
                            {calendarProviderName(t, connection.provider)}
                          </h3>
                          <p className="truncate text-sm text-muted-foreground">
                            {connection.account_label}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {t("calendarFeed.calendarNamed", {
                              calendar: connection.calendar_label,
                            })}
                          </p>
                        </div>
                        <ConnectionStatus connection={connection} />
                      </div>

                      <dl className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
                        <div>
                          <dt className="sr-only">
                            {t("calendarFeed.verificationLabel")}
                          </dt>
                          <dd>
                            {connection.last_verified_at
                              ? t("calendarFeed.lastVerified", {
                                  when: relative(connection.last_verified_at, t),
                                })
                              : t("calendarFeed.neverVerified")}
                          </dd>
                        </div>
                        <div>
                          <dt className="sr-only">
                            {t("calendarFeed.synchronizationLabel")}
                          </dt>
                          <dd>
                            {connection.last_sync_at
                              ? t("calendarFeed.lastSynced", {
                                  when: relative(connection.last_sync_at, t),
                                })
                              : t("calendarFeed.neverSynced")}
                          </dd>
                        </div>
                      </dl>

                      {(retrying || reconnect || cleaningUp) && (
                        <p
                          role="status"
                          className="flex items-start gap-2 rounded-md bg-warning/10 px-3 py-2 text-sm text-amber-800 dark:text-warning"
                        >
                          <AlertTriangle
                            className="mt-0.5 size-4 shrink-0"
                            aria-hidden
                          />
                          {cleaningUp
                            ? t("calendarFeed.connectionDisconnecting")
                            : (retrying
                              ? t("calendarFeed.connectionRetrying")
                              : t("calendarFeed.connectionError"))}
                        </p>
                      )}

                      {connection.conflict_count > 0 && (
                        <a
                          href="#calendar-attention"
                          className="block text-sm font-medium text-amber-800 underline-offset-4 hover:underline dark:text-warning"
                        >
                          {connection.conflict_count === 1
                            ? t("calendarFeed.conflictsOne")
                            : t("calendarFeed.conflictsMany", {
                                count: connection.conflict_count,
                              })}
                        </a>
                      )}

                      <div className="flex flex-wrap gap-2">
                        {reconnect && offersCalendarAction(connection.allowed_actions, "reconnect") && (
                          <Button
                            type="button"
                            size="sm"
                            disabled={authorize.isPending}
                            aria-describedby="calendar-connection-disclosure"
                            onClick={() => startAuthorization(connection.provider)}
                          >
                            <RefreshCw aria-hidden />
                            {authorize.isPending &&
                            authorize.variables?.provider === connection.provider
                              ? t("calendarFeed.connecting")
                              : t("calendarFeed.reauthorize")}
                          </Button>
                        )}

                        {!cleaningUp &&
                          offersCalendarAction(connection.allowed_actions, "disconnect") &&
                          (confirmingDisconnect === connection.id ? (
                            <Button
                              type="button"
                              variant="destructive"
                              size="sm"
                              disabled={disconnecting}
                              onClick={() => disconnectConnection(connection.id)}
                            >
                              <Unplug aria-hidden />
                              {t("calendarFeed.disconnectConfirm")}
                            </Button>
                          ) : (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => setConfirmingDisconnect(connection.id)}
                            >
                              {t("calendarFeed.disconnect")}
                            </Button>
                          ))}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            {!cleanupInProgress && (
              <div className="flex flex-wrap gap-2">
                {PROVIDERS.filter(
                  (provider) => !connectedProviders.has(provider),
                ).map((provider) => {
                const configured = view.data?.configured[provider] === true;
                const descriptionId = `calendar-${provider}-unavailable`;
                return (
                  <div key={provider} className="max-w-xs space-y-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={!configured || authorize.isPending}
                      aria-describedby={
                        configured
                          ? "calendar-connection-disclosure"
                          : descriptionId
                      }
                      onClick={() => startAuthorization(provider)}
                    >
                      <CalendarSync aria-hidden />
                      {authorize.isPending &&
                      authorize.variables?.provider === provider
                        ? t("calendarFeed.connecting")
                        : connectLabel(t, provider)}
                    </Button>
                    {!configured && (
                      <p
                        id={descriptionId}
                        className="text-xs text-muted-foreground"
                      >
                        {t("calendarFeed.providerUnavailable", {
                          provider: calendarProviderName(t, provider),
                        })}
                      </p>
                    )}
                  </div>
                );
                })}
              </div>
            )}

            <CalendarAttentionPanel />
          </>
        ))}
      </div>
    </div>
  );
}
