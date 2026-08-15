"use client";

import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Check, Copy, KeyRound } from "lucide-react";

import {
  API_KEY_SCOPES,
  apiKeyScopeLabelKey,
  type ApiKeyScope,
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useT, type MessageKey } from "@/i18n/provider";
import { ApiError } from "@/lib/api/error";
import {
  useApiKeys,
  useCreateApiKey,
  useRevokeApiKey,
  type ApiKey,
} from "@/lib/api/api-keys";

/**
 * #243 — API keys.
 *
 * ---------------------------------------------------------------------------
 * WHY THE DEFAULTS HERE INVERT THE ONES NEXT DOOR
 *
 * Connections opens its form with every event ticked, because subscribing to
 * nothing is a mistake and eight empty boxes is where somebody gives up.
 *
 * This form opens with only the READ scopes ticked, and that is the same
 * principle reaching the opposite answer: a Smart Default is only smart when
 * being wrong about it is cheap. Being wrong about which events you receive
 * costs a redundant webhook. Being wrong about what a key can do costs
 * whatever the key can do — and a key that could write everything by default
 * is a key nobody chose the reach of.
 *
 * It is still a default rather than an empty form. Reading is what a first
 * integration does; somebody who needs writing knows they do.
 *
 * ---------------------------------------------------------------------------
 * THE REST OF THE DECISIONS
 *
 * **"Last used" is the headline, not the creation date.** The question this
 * screen exists to answer is "can I safely switch this off", and the only fact
 * that answers it is whether anything is still calling. So it is on the row,
 * and it is repeated in the confirmation when the answer is "yes, recently".
 *
 * **Revoked keys stay in the list.** "What did we turn off, and when" is an
 * incident question, and a list that hides them cannot answer it.
 *
 * **The token panel is louder than the webhook secret's**, because losing this
 * one is worse: a signing secret can be rotated in place, a lost API key means
 * revoking and re-pasting into somebody else's system.
 *
 * Applying: Smart Defaults (inverted, and said why), Loss Aversion, Ethical
 * Friction, Zen of Clarity, and Lucide throughout.
 */

/** The scopes a first integration usually needs, and the safe half. */
const DEFAULT_SCOPES: ApiKeyScope[] = API_KEY_SCOPES.filter((scope) =>
  scope.endsWith(":read"),
);

function useWhen() {
  return (iso: string | null): string => {
    if (!iso) return "";
    const then = new Date(iso).getTime();
    if (!Number.isFinite(then)) return "";
    const minutes = Math.round((then - Date.now()) / 60_000);
    const abs = Math.abs(minutes);
    const format = (value: number, unit: Intl.RelativeTimeFormatUnit) =>
      new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(value, unit);
    if (abs < 60) return format(minutes, "minute");
    if (abs < 60 * 24) return format(Math.round(minutes / 60), "hour");
    return format(Math.round(minutes / (60 * 24)), "day");
  };
}

/** The token. Shown once, and it says so in the same breath. */
function TokenPanel({ token, onDone }: { token: string; onDone: () => void }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden />
        <div className="min-w-0 flex-1 space-y-3">
          <div className="space-y-1">
            <p className="text-sm font-medium">{t("apiKeys.tokenTitle")}</p>
            <p className="text-sm text-muted-foreground">{t("apiKeys.tokenBody")}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 overflow-x-auto rounded border bg-background px-2 py-1.5 font-mono text-xs">
              {token}
            </code>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                void navigator.clipboard.writeText(token);
                setCopied(true);
              }}
            >
              {copied ? (
                <Check className="size-4" aria-hidden />
              ) : (
                <Copy className="size-4" aria-hidden />
              )}
              {copied ? t("apiKeys.tokenCopied") : t("apiKeys.tokenCopy")}
            </Button>
          </div>
          <Button type="button" size="sm" onClick={onDone}>
            {t("apiKeys.tokenDone")}
          </Button>
        </div>
      </div>
    </div>
  );
}

function CreateForm({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: (token: string) => void;
}) {
  const t = useT();
  const create = useCreateApiKey();
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<ApiKeyScope[]>(DEFAULT_SCOPES);

  async function submit() {
    if (scopes.length === 0) {
      toast.error(t("apiKeys.needOneScope"));
      return;
    }
    try {
      const result = await create.mutateAsync({ name: name.trim(), scopes });
      onCreated(result.token_once);
    } catch (cause) {
      toast.error(
        cause instanceof ApiError ? cause.message : t("appShell.saveFailed"),
      );
    }
  }

  return (
    <SettingsCard title={t("apiKeys.createTitle")}>
      <div className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="api-key-name">{t("apiKeys.nameLabel")}</Label>
          <Input
            id="api-key-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t("apiKeys.namePlaceholder")}
            autoComplete="off"
          />
        </div>

        <fieldset className="space-y-3">
          <legend className="text-sm font-medium">{t("apiKeys.scopesLabel")}</legend>
          <p className="text-xs text-muted-foreground">{t("apiKeys.scopesHint")}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {API_KEY_SCOPES.map((scope) => (
              <label
                key={scope}
                className="flex items-center gap-2 text-sm"
                htmlFor={`api-key-scope-${scope}`}
              >
                <Checkbox
                  id={`api-key-scope-${scope}`}
                  checked={scopes.includes(scope)}
                  onCheckedChange={(next) =>
                    setScopes((current) =>
                      next === true
                        ? [...current, scope]
                        : current.filter((value) => value !== scope),
                    )
                  }
                />
                {t(apiKeyScopeLabelKey(scope) as MessageKey)}
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        <Button
          type="button"
          onClick={() => void submit()}
          disabled={create.isPending || name.trim().length === 0}
        >
          {create.isPending ? t("apiKeys.savingAction") : t("apiKeys.saveAction")}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t("apiKeys.cancelAction")}
        </Button>
      </div>
    </SettingsCard>
  );
}

function KeyRow({ apiKey }: { apiKey: ApiKey }) {
  const t = useT();
  const when = useWhen();
  const revoke = useRevokeApiKey();
  const [confirming, setConfirming] = useState(false);

  const revoked = apiKey.revoked_at !== null;

  return (
    <SettingsCard>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-medium">{apiKey.name}</p>
          <p className="font-mono text-xs text-muted-foreground">
            {apiKey.token_prefix}…
          </p>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            {revoked ? (
              <span>
                {t("apiKeys.revokedOn", { when: when(apiKey.revoked_at) })}
              </span>
            ) : (
              // The fact that decides whether switching this off is safe.
              <span>
                {apiKey.last_used_at
                  ? t("apiKeys.lastUsed", { when: when(apiKey.last_used_at) })
                  : t("apiKeys.neverUsed")}
              </span>
            )}
            <span aria-hidden>·</span>
            <span>{t("apiKeys.scopesCount", { count: apiKey.scopes.length })}</span>
          </div>
        </div>

        {!revoked && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setConfirming(true)}
          >
            {t("apiKeys.revokeAction")}
          </Button>
        )}
      </div>

      <ul className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {apiKey.scopes.map((scope) => (
          <li key={scope}>{t(apiKeyScopeLabelKey(scope) as MessageKey)}</li>
        ))}
      </ul>

      {/* Ethical Friction: this breaks a live integration and cannot be undone. */}
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("apiKeys.revokeTitle")}</DialogTitle>
            <DialogDescription>
              {t("apiKeys.revokeBody")}
              {apiKey.last_used_at
                ? ` ${t("apiKeys.revokeUsedWarning", { when: when(apiKey.last_used_at) })}`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setConfirming(false)}>
              {t("apiKeys.keepIt")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                revoke.mutate(apiKey.id);
                setConfirming(false);
              }}
            >
              {t("apiKeys.revokeConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsCard>
  );
}

export default function ApiKeysPage() {
  const t = useT();
  const { data, isPending, isError, refetch } = useApiKeys();
  const [creating, setCreating] = useState(false);
  const [minted, setMinted] = useState<string | null>(null);

  const rows = data?.keys ?? [];
  const cap = data?.cap ?? 0;
  const atCap = cap > 0 && (data?.live ?? 0) >= cap;

  return (
    <SettingsPage title={t("apiKeys.title")} description={t("apiKeys.intro")}>
      {isError ? (
        <LoadError message={t("apiKeys.loadFailed")} onRetry={() => void refetch()} />
      ) : isPending ? (
        <Skeleton className="h-40 w-full rounded-lg" />
      ) : (
        <div className="space-y-4">
          {minted && <TokenPanel token={minted} onDone={() => setMinted(null)} />}

          {rows.length === 0 && !creating ? (
            <SettingsCard>
              <div className="flex flex-col items-start gap-3">
                <KeyRound className="size-5 text-muted-foreground" aria-hidden />
                <div className="space-y-1">
                  <p className="text-sm font-medium">{t("apiKeys.empty")}</p>
                  <p className="text-sm text-muted-foreground">
                    {t("apiKeys.emptyBody")}
                  </p>
                </div>
                <Button type="button" onClick={() => setCreating(true)}>
                  {t("apiKeys.createAction")}
                </Button>
              </div>
            </SettingsCard>
          ) : (
            <>
              {rows.map((row) => (
                <KeyRow key={row.id} apiKey={row} />
              ))}

              {creating ? (
                <CreateForm
                  onCancel={() => setCreating(false)}
                  onCreated={(token) => {
                    setCreating(false);
                    setMinted(token);
                  }}
                />
              ) : (
                <div className="space-y-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setCreating(true)}
                    disabled={atCap}
                  >
                    {t("apiKeys.createAction")}
                  </Button>
                  {atCap && (
                    <p className="text-sm text-muted-foreground">
                      {t("apiKeys.capReached", { count: cap })}
                    </p>
                  )}
                </div>
              )}
            </>
          )}

          <p className="text-xs text-muted-foreground">{t("apiKeys.developerNote")}</p>
        </div>
      )}
    </SettingsPage>
  );
}
