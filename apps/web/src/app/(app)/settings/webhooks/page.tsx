"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  Check,
  Copy,
  MoreHorizontal,
  Plug,
  Send,
} from "lucide-react";

import {
  WEBHOOK_EVENT_TYPES,
  webhookEventLabelKey,
  type WebhookEventType,
} from "@loonext/shared";

import {
  LoadError,
  SettingsCard,
  SettingsPage,
} from "@/components/settings/section";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useT, type MessageKey } from "@/i18n/provider";
import { ApiError } from "@/lib/api/error";
import {
  useCreateWebhookEndpoint,
  useDeleteWebhookEndpoint,
  useRotateWebhookSecret,
  useTestWebhookEndpoint,
  useUpdateWebhookEndpoint,
  useWebhookDeliveries,
  useWebhookEndpoints,
  type WebhookEndpoint,
} from "@/lib/api/webhooks";

/**
 * #243 — Connections.
 *
 * ---------------------------------------------------------------------------
 * WHO THIS IS WRITTEN FOR
 *
 * Two people open this screen: the owner who was told "connect it to the
 * scheduling app", and the developer they hired. The copy is written for the
 * first — "your other apps", "address", "signing key" — because the second can
 * read anything, and the first is the one who gives up.
 *
 * ---------------------------------------------------------------------------
 * THE DESIGN DECISIONS, AND WHAT THEY COST IF REVERSED
 *
 * **The add form opens with every event already ticked.** An empty form is a
 * decision the person is not equipped to make yet — they do not know which of
 * eight events their tool needs, and eight empty boxes at the exact moment
 * somebody is trying to get started is where they stop. Subscribing to nothing
 * is also a mistake rather than a preference: the API refuses it.
 *
 * **The secret is a panel, not a toast.** It is shown once in the product's
 * whole life and a toast is dismissible by accident. It states that we cannot
 * show it again, in the same breath as showing it, because a person who learns
 * that afterwards has already lost it.
 *
 * **Rotate and Remove both confirm.** Rotation breaks a working integration the
 * instant it completes and Removal stops the flow — both are the kind of thing
 * a person does by aiming at the row below.
 *
 * **A stopped endpoint says what was LOST.** "Disabled" is a state; "everything
 * since then has been missed" is the consequence, and the consequence is what
 * makes somebody fix it.
 *
 * **The delivery log is disclosed on demand.** Most visits never open it, and
 * loading fifty rows per endpoint on every page view makes the common case pay
 * for the rare one.
 *
 * Applying: Smart Defaults, Zen of Clarity, Ethical Friction, Loss Aversion,
 * Chunking, and the no-emoji icon rule (Lucide throughout).
 */

/** Relative time, in the reader's own locale, without pulling a library in. */
function useWhen() {
  return (iso: string | null): string => {
    if (!iso) return "";
    const then = new Date(iso).getTime();
    if (!Number.isFinite(then)) return "";
    const minutes = Math.round((then - Date.now()) / 60_000);
    const abs = Math.abs(minutes);
    const format = (value: number, unit: Intl.RelativeTimeFormatUnit) =>
      new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(
        value,
        unit,
      );
    if (abs < 60) return format(minutes, "minute");
    if (abs < 60 * 24) return format(Math.round(minutes / 60), "hour");
    return format(Math.round(minutes / (60 * 24)), "day");
  };
}

type Health = "healthy" | "never" | "failing" | "paused" | "stopped";

/**
 * One endpoint's state, as a single answer.
 *
 * Derived in one place rather than at each render site, because "paused by you"
 * and "we stopped sending" are the two the customer must never see confused —
 * one is their decision and the other is ours, and a screen that blames them
 * for our decision is worse than one that says nothing.
 */
function healthOf(endpoint: WebhookEndpoint): Health {
  if (!endpoint.active) {
    return endpoint.disabled_reason ? "stopped" : "paused";
  }
  if (endpoint.consecutive_failures > 0) return "failing";
  return endpoint.last_success_at ? "healthy" : "never";
}

const HEALTH_DOT: Record<Health, string> = {
  healthy: "bg-emerald-500",
  never: "bg-muted-foreground/40",
  failing: "bg-amber-500",
  paused: "bg-muted-foreground/40",
  stopped: "bg-destructive",
};

const HEALTH_LABEL: Record<Health, MessageKey> = {
  healthy: "webhooks.statusHealthy",
  never: "webhooks.statusNeverUsed",
  failing: "webhooks.statusFailing",
  paused: "webhooks.statusPaused",
  stopped: "webhooks.statusStopped",
};

/** The one-time secret. Deliberately loud, and deliberately not a toast. */
function SecretPanel({
  secret,
  onDone,
}: {
  secret: string;
  onDone: () => void;
}) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
      <div className="flex items-start gap-3">
        <AlertTriangle
          className="mt-0.5 size-4 shrink-0 text-amber-600"
          aria-hidden
        />
        <div className="min-w-0 flex-1 space-y-3">
          <div className="space-y-1">
            <p className="text-sm font-medium">{t("webhooks.secretTitle")}</p>
            <p className="text-sm text-muted-foreground">
              {t("webhooks.secretBody")}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 overflow-x-auto rounded border bg-background px-2 py-1.5 font-mono text-xs">
              {secret}
            </code>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                void navigator.clipboard.writeText(secret);
                setCopied(true);
              }}
            >
              {copied ? (
                <Check className="size-4" aria-hidden />
              ) : (
                <Copy className="size-4" aria-hidden />
              )}
              {copied ? t("webhooks.secretCopied") : t("webhooks.secretCopy")}
            </Button>
          </div>
          <Button type="button" size="sm" onClick={onDone}>
            {t("webhooks.secretDone")}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** The add form. Opens with everything ticked — see the header. */
function AddForm({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: (secret: string) => void;
}) {
  const t = useT();
  const create = useCreateWebhookEndpoint();
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [events, setEvents] = useState<WebhookEventType[]>([
    ...WEBHOOK_EVENT_TYPES,
  ]);

  function toggle(type: WebhookEventType, on: boolean) {
    setEvents((current) =>
      on ? [...current, type] : current.filter((value) => value !== type),
    );
  }

  async function submit() {
    if (events.length === 0) {
      toast.error(t("webhooks.needOneEvent"));
      return;
    }
    try {
      const result = await create.mutateAsync({
        url: url.trim(),
        events,
        ...(description.trim() ? { description: description.trim() } : {}),
      });
      onCreated(result.secret_once);
    } catch (cause) {
      // The API answers with a catalogue KEY for every address rule, so the
      // reason is said in the reader's own language rather than as "invalid
      // URL", which tells them nothing they can act on.
      const message =
        cause instanceof ApiError && cause.message.startsWith("webhooks.")
          ? t(cause.message as MessageKey)
          : t("appShell.saveFailed");
      toast.error(message);
    }
  }

  return (
    <SettingsCard title={t("webhooks.addTitle")}>
      <div className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="webhook-url">{t("webhooks.urlLabel")}</Label>
          <Input
            id="webhook-url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://"
            inputMode="url"
            autoComplete="off"
          />
          <p className="text-xs text-muted-foreground">
            {t("webhooks.urlHint")}
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="webhook-name">{t("webhooks.nameLabel")}</Label>
          <Input
            id="webhook-name"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder={t("webhooks.namePlaceholder")}
            autoComplete="off"
          />
        </div>

        <fieldset className="space-y-3">
          <legend className="text-sm font-medium">
            {t("webhooks.eventsLabel")}
          </legend>
          <p className="text-xs text-muted-foreground">
            {t("webhooks.eventsHint")}
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {WEBHOOK_EVENT_TYPES.map((type) => (
              <label
                key={type}
                className="flex items-center gap-2 text-sm"
                htmlFor={`webhook-event-${type}`}
              >
                <Checkbox
                  id={`webhook-event-${type}`}
                  checked={events.includes(type)}
                  onCheckedChange={(next) => toggle(type, next === true)}
                />
                {t(webhookEventLabelKey(type) as MessageKey)}
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        <Button
          type="button"
          onClick={() => void submit()}
          disabled={create.isPending || url.trim().length === 0}
        >
          {create.isPending
            ? t("webhooks.savingAction")
            : t("webhooks.saveAction")}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t("webhooks.cancelAction")}
        </Button>
      </div>
    </SettingsCard>
  );
}

/** The delivery log, opened on demand. */
function Deliveries({ endpointId }: { endpointId: string }) {
  const t = useT();
  const when = useWhen();
  const { data, isPending } = useWebhookDeliveries(endpointId);

  if (isPending) return <Skeleton className="h-24 w-full rounded-lg" />;
  const deliveries = data?.deliveries ?? [];
  if (deliveries.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {t("webhooks.deliveriesEmpty")}
      </p>
    );
  }

  const STATUS: Record<string, MessageKey> = {
    pending: "webhooks.deliveryPending",
    delivering: "webhooks.deliveryDelivering",
    succeeded: "webhooks.deliverySucceeded",
    failed: "webhooks.deliveryFailed",
  };

  return (
    <ul className="divide-y rounded-lg border">
      {deliveries.map((delivery) => (
        <li
          key={delivery.id}
          className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-3 py-2 text-sm"
        >
          <span className="font-mono text-xs">{delivery.event_type}</span>
          <span className="text-muted-foreground">
            {t(STATUS[delivery.status] ?? "webhooks.deliveryPending")}
            {delivery.response_status !== null
              ? ` · ${delivery.response_status}`
              : ""}
            {delivery.attempts > 1
              ? ` · ${t("webhooks.deliveryAttempts", { count: delivery.attempts })}`
              : ""}
            {` · ${when(delivery.created_at)}`}
          </span>
        </li>
      ))}
    </ul>
  );
}

function EndpointCard({ endpoint }: { endpoint: WebhookEndpoint }) {
  const t = useT();
  const when = useWhen();
  const update = useUpdateWebhookEndpoint();
  const remove = useDeleteWebhookEndpoint();
  const rotate = useRotateWebhookSecret();
  const test = useTestWebhookEndpoint();

  const [showDeliveries, setShowDeliveries] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [rotated, setRotated] = useState<string | null>(null);

  const health = healthOf(endpoint);

  async function runTest() {
    const result = await test.mutateAsync(endpoint.id);
    if (result.ok) {
      toast.success(t("webhooks.testOk"));
    } else if (result.reason === "timeout") {
      toast.error(t("webhooks.testTimeout"));
    } else if (result.reason === "unreachable" || result.status === null) {
      toast.error(t("webhooks.testUnreachable"));
    } else {
      toast.error(t("webhooks.testRefused", { status: result.status }));
    }
  }

  return (
    <SettingsCard>
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            {endpoint.description && (
              <p className="text-sm font-medium">{endpoint.description}</p>
            )}
            <p className="break-all font-mono text-xs text-muted-foreground">
              {endpoint.url}
            </p>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span
                  className={`size-2 rounded-full ${HEALTH_DOT[health]}`}
                  aria-hidden
                />
                {t(HEALTH_LABEL[health])}
              </span>
              <span aria-hidden>·</span>
              <span>
                {t("webhooks.eventsCount", { count: endpoint.events.length })}
              </span>
              {health === "healthy" && endpoint.last_success_at && (
                <>
                  <span aria-hidden>·</span>
                  <span>
                    {t("webhooks.lastSuccess", {
                      when: when(endpoint.last_success_at),
                    })}
                  </span>
                </>
              )}
            </div>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={endpoint.description ?? endpoint.url}
              >
                <MoreHorizontal className="size-4" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onSelect={() => setShowDeliveries((open) => !open)}
              >
                {t("webhooks.deliveriesAction")}
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() =>
                  update.mutate({ id: endpoint.id, active: !endpoint.active })
                }
              >
                {endpoint.active
                  ? t("webhooks.pauseAction")
                  : t("webhooks.resumeAction")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setConfirmRotate(true)}>
                {t("webhooks.rotateAction")}
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => setConfirmDelete(true)}
              >
                {t("webhooks.deleteAction")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* What it COST, not what state it is in. */}
        {health === "stopped" && (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">
            {t("webhooks.stoppedBody")}
          </p>
        )}
        {health === "failing" && (
          <p className="text-sm text-muted-foreground">
            {t("webhooks.failingBody", {
              count: endpoint.consecutive_failures,
            })}
          </p>
        )}

        {rotated && (
          <SecretPanel secret={rotated} onDone={() => setRotated(null)} />
        )}

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void runTest()}
            disabled={test.isPending}
          >
            <Send className="size-4" aria-hidden />
            {test.isPending
              ? t("webhooks.testSending")
              : t("webhooks.testAction")}
          </Button>
        </div>

        {showDeliveries && (
          <div className="space-y-2">
            <p className="text-sm font-medium">
              {t("webhooks.deliveriesTitle")}
            </p>
            <Deliveries endpointId={endpoint.id} />
          </div>
        )}
      </div>

      {/* Ethical Friction: both of these break something that is working. */}
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("webhooks.deleteTitle")}</DialogTitle>
            <DialogDescription>
              {t("webhooks.deleteBody", { url: endpoint.url })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setConfirmDelete(false)}
            >
              {t("webhooks.keepIt")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                remove.mutate(endpoint.id);
                setConfirmDelete(false);
              }}
            >
              {t("webhooks.deleteConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmRotate} onOpenChange={setConfirmRotate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("webhooks.rotateTitle")}</DialogTitle>
            <DialogDescription>{t("webhooks.rotateBody")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setConfirmRotate(false)}
            >
              {t("webhooks.cancelAction")}
            </Button>
            <Button
              type="button"
              onClick={async () => {
                setConfirmRotate(false);
                const result = await rotate.mutateAsync(endpoint.id);
                setRotated(result.secret_once);
              }}
            >
              {t("webhooks.rotateConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsCard>
  );
}

export default function WebhooksPage() {
  const t = useT();
  const { data, isPending, isError, refetch } = useWebhookEndpoints();
  const [adding, setAdding] = useState(false);
  const [minted, setMinted] = useState<string | null>(null);

  const endpoints = data?.endpoints ?? [];
  const cap = data?.cap ?? 0;
  const atCap = endpoints.length >= cap && cap > 0;

  return (
    <SettingsPage title={t("webhooks.title")} description={t("webhooks.intro")}>
      {isError ? (
        <LoadError
          message={t("webhooks.loadFailed")}
          onRetry={() => void refetch()}
        />
      ) : isPending ? (
        <Skeleton className="h-40 w-full rounded-lg" />
      ) : (
        <div className="space-y-4">
          {minted && (
            <SecretPanel secret={minted} onDone={() => setMinted(null)} />
          )}

          {endpoints.length === 0 && !adding ? (
            <SettingsCard>
              <div className="flex flex-col items-start gap-3">
                <Plug className="size-5 text-muted-foreground" aria-hidden />
                <div className="space-y-1">
                  <p className="text-sm font-medium">{t("webhooks.empty")}</p>
                  <p className="text-sm text-muted-foreground">
                    {t("webhooks.emptyBody")}
                  </p>
                </div>
                <Button type="button" onClick={() => setAdding(true)}>
                  {t("webhooks.addAction")}
                </Button>
              </div>
            </SettingsCard>
          ) : (
            <>
              {endpoints.map((endpoint) => (
                <EndpointCard key={endpoint.id} endpoint={endpoint} />
              ))}

              {adding ? (
                <AddForm
                  onCancel={() => setAdding(false)}
                  onCreated={(secret) => {
                    setAdding(false);
                    setMinted(secret);
                  }}
                />
              ) : (
                <div className="space-y-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setAdding(true)}
                    disabled={atCap}
                  >
                    {t("webhooks.addAction")}
                  </Button>
                  {atCap && (
                    <p className="text-sm text-muted-foreground">
                      {t("webhooks.capReached", { count: cap })}
                    </p>
                  )}
                </div>
              )}
            </>
          )}

          <p className="text-xs text-muted-foreground">
            {t("webhooks.developerNote")}
          </p>
        </div>
      )}
    </SettingsPage>
  );
}
