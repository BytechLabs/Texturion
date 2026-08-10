"use client";

import { useState } from "react";
import { toast } from "sonner";

import { DeviceRow } from "@/components/settings/device-row";
import {
  LoadError,
  SettingsCard,
  SettingsPage,
} from "@/components/settings/section";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/i18n/provider";
import { ApiError } from "@/lib/api/error";
import {
  useMySessions,
  useRevokeMemberSessions,
  useRevokeMySession,
  useWorkspaceSessions,
} from "@/lib/api/sessions";
import { useMembers } from "@/lib/api/team";
import { useActiveCompany } from "@/lib/company/provider";

/**
 * /settings/devices (#236) — what is signed in, and how to kill it.
 *
 * A phone is the primary device for this product, and phones get lost, stolen,
 * sold, and handed to the next person when a tech quits. Until this screen
 * existed there was no answer to "what is currently signed in", so the only
 * people who could act — the person whose account it is, and the owner who
 * knows somebody left — had nothing to act on.
 *
 * Two lists, in that order, because that is the order the two questions get
 * asked in: my own devices first (everyone has this question), then the crew's
 * (only an owner or admin does).
 */
export default function DevicesSettingsPage() {
  const t = useT();
  const { role } = useActiveCompany();
  const isAdmin = role === "owner" || role === "admin";

  return (
    <SettingsPage
      title={t("appShell.devicesTitle")}
      description={t("appShell.devicesDescription")}
    >
      <div className="space-y-6">
        <MyDevices />
        {isAdmin && <CrewDevices />}
      </div>
    </SettingsPage>
  );
}

function MyDevices() {
  const t = useT();
  const sessions = useMySessions();
  const revoke = useRevokeMySession();
  const [confirmAll, setConfirmAll] = useState(false);

  const rows = sessions.data?.data ?? [];
  // "This device" first, always. It is the row the reader needs to identify
  // and dismiss before any of the others mean anything.
  const ordered = [...rows].sort(
    (a, b) => Number(b.current) - Number(a.current),
  );
  const others = rows.filter((row) => !row.current).length;

  function signOut(sessionId: string) {
    revoke.mutate(
      { sessionId },
      {
        onSuccess: () => toast.success(t("appShell.devicesSignedOutOne")),
        onError: (error) =>
          toast.error(
            error instanceof ApiError
              ? error.message
              : t("appShell.devicesSignOutOneFailed"),
          ),
      },
    );
  }

  function signOutEverywhereElse() {
    revoke.mutate(
      { others: true },
      {
        onSuccess: (result) => {
          setConfirmAll(false);
          toast.success(
            result.sessions === 0
              ? t("appShell.devicesNothingElseSignedIn")
              : t("appShell.devicesSignedOutOthers", {
                  count: result.sessions,
                  devices:
                    result.sessions === 1
                      ? t("appShell.deviceSingular")
                      : t("appShell.devicePlural"),
                }),
          );
        },
        onError: (error) =>
          toast.error(
            error instanceof ApiError
              ? error.message
              : t("appShell.devicesSignOutOthersFailed"),
          ),
      },
    );
  }

  return (
    <SettingsCard
      title={t("appShell.devicesMineTitle")}
      description={t("appShell.devicesMineDescription")}
      footer={
        others > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm text-muted-foreground">
              {t("appShell.devicesLostPhone")}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setConfirmAll(true)}
            >
              {t("appShell.devicesSignOutEverywhereElse")}
            </Button>
          </div>
        ) : undefined
      }
    >
      {sessions.isPending && (
        <div className="space-y-3" aria-label={t("appShell.devicesMineLoading")}>
          <Skeleton className="h-14 w-full rounded-md" />
          <Skeleton className="h-14 w-full rounded-md" />
        </div>
      )}

      {sessions.isError && <LoadError onRetry={() => void sessions.refetch()} />}

      {sessions.isSuccess && ordered.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {t("appShell.devicesNoneSignedIn")}
        </p>
      )}

      {sessions.isSuccess && ordered.length > 0 && (
        <div className="divide-y divide-border-subtle">
          {ordered.map((row) => (
            <DeviceRow
              key={row.id}
              client={row.client}
              location={row.location}
              signedInAt={row.signed_in_at}
              lastActiveAt={row.last_active_at}
              userAgent={row.user_agent}
              current={row.current}
              action={
                row.current ? undefined : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={revoke.isPending}
                    onClick={() => signOut(row.id)}
                  >
                    {t("appShell.devicesSignOut")}
                  </Button>
                )
              }
            />
          ))}
        </div>
      )}

      {/* Ethical friction, once: one device is a small, reversible act (they
          sign back in). Everything at once is not, so it gets a pause and a
          sentence about what it actually does. */}
      <Dialog open={confirmAll} onOpenChange={setConfirmAll}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("appShell.devicesSignOutEverywhereElseTitle")}
            </DialogTitle>
            <DialogDescription>
              {t("appShell.devicesSignOutEverywhereElseBody", {
                subject:
                  others === 1
                    ? t("appShell.devicesOneOther")
                    : t("appShell.devicesNOthers", { count: others }),
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmAll(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={revoke.isPending}
              onClick={signOutEverywhereElse}
            >
              {t("appShell.devicesSignThemOut")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsCard>
  );
}

function CrewDevices() {
  const t = useT();
  const sessions = useWorkspaceSessions(true);
  const members = useMembers();
  const revoke = useRevokeMemberSessions();
  const [target, setTarget] = useState<{ id: string; name: string } | null>(
    null,
  );

  const nameByMember = new Map(
    (members.data?.data ?? []).map((member) => [
      member.id,
      member.display_name?.trim() || t("appShell.devicesACrewMember"),
    ]),
  );
  const rows = sessions.data?.data ?? [];
  const countByMember = new Map<string, number>();
  for (const row of rows) {
    if (row.member_id) {
      countByMember.set(row.member_id, (countByMember.get(row.member_id) ?? 0) + 1);
    }
  }

  function signOutMember() {
    if (!target) return;
    revoke.mutate(target.id, {
      onSuccess: (result) => {
        setTarget(null);
        toast.success(
          result.sessions === 0
            ? t("appShell.devicesTheyHadNothing")
            : t("appShell.devicesSignedMemberOut", {
                name: target.name,
                count: result.sessions,
                devices:
                  result.sessions === 1
                    ? t("appShell.deviceSingular")
                    : t("appShell.devicePlural"),
              }),
        );
      },
      onError: (error) => {
        toast.error(
          error instanceof ApiError
            ? error.message
            : t("appShell.devicesSignThemOutFailed"),
        );
      },
    });
  }

  return (
    <SettingsCard
      title={t("appShell.devicesCrewTitle")}
      description={t("appShell.devicesCrewDescription")}
    >
      {(sessions.isPending || members.isPending) && (
        <div className="space-y-3" aria-label={t("appShell.devicesCrewLoading")}>
          <Skeleton className="h-14 w-full rounded-md" />
          <Skeleton className="h-14 w-full rounded-md" />
        </div>
      )}

      {sessions.isError && <LoadError onRetry={() => void sessions.refetch()} />}

      {sessions.isSuccess && rows.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {t("appShell.devicesCrewNoneSignedIn")}
        </p>
      )}

      {sessions.isSuccess && rows.length > 0 && (
        <div className="divide-y divide-border-subtle">
          {rows.map((row) => {
            const name = row.member_id
              ? (nameByMember.get(row.member_id) ??
                t("appShell.devicesACrewMember"))
              : t("appShell.devicesACrewMember");
            return (
              <DeviceRow
                key={row.id}
                client={row.client}
                location={row.location}
                signedInAt={row.signed_in_at}
                lastActiveAt={row.last_active_at}
                secondary={
                  row.location ? `${name} · ${row.location}` : name
                }
                action={
                  row.member_id ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={revoke.isPending}
                      onClick={() =>
                        setTarget({ id: row.member_id as string, name })
                      }
                    >
                      {t("appShell.devicesSignOut")}
                    </Button>
                  ) : undefined
                }
              />
            );
          })}
        </div>
      )}

      <Dialog open={target !== null} onOpenChange={() => setTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("appShell.devicesSignMemberOutTitle", {
                name: target?.name ?? "",
              })}
            </DialogTitle>
            <DialogDescription>
              {t("appShell.devicesSignMemberOutBody", {
                count: target ? (countByMember.get(target.id) ?? 0) : 0,
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setTarget(null)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={revoke.isPending}
              onClick={signOutMember}
            >
              {t("appShell.devicesSignThemOut")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsCard>
  );
}
