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
  const { role } = useActiveCompany();
  const isAdmin = role === "owner" || role === "admin";

  return (
    <SettingsPage
      title="Signed-in devices"
      description="Every browser and phone with access right now. Signing one out takes effect immediately."
    >
      <div className="space-y-6">
        <MyDevices />
        {isAdmin && <CrewDevices />}
      </div>
    </SettingsPage>
  );
}

function MyDevices() {
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
        onSuccess: () => toast.success("Signed that device out."),
        onError: (error) =>
          toast.error(
            error instanceof ApiError
              ? error.message
              : "Couldn't sign that device out. Try again.",
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
              ? "Nothing else was signed in."
              : `Signed out ${result.sessions} other ${
                  result.sessions === 1 ? "device" : "devices"
                }.`,
          );
        },
        onError: (error) =>
          toast.error(
            error instanceof ApiError
              ? error.message
              : "Couldn't sign the other devices out. Try again.",
          ),
      },
    );
  }

  return (
    <SettingsCard
      title="Your devices"
      description="Anything signed in as you, in any workspace."
      footer={
        others > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm text-muted-foreground">
              Lost a phone, or not sure about one of these?
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setConfirmAll(true)}
            >
              Sign out everywhere else
            </Button>
          </div>
        ) : undefined
      }
    >
      {sessions.isPending && (
        <div className="space-y-3" aria-label="Loading your devices">
          <Skeleton className="h-14 w-full rounded-md" />
          <Skeleton className="h-14 w-full rounded-md" />
        </div>
      )}

      {sessions.isError && <LoadError onRetry={() => void sessions.refetch()} />}

      {sessions.isSuccess && ordered.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Nothing is signed in — which cannot be true, since you are reading
          this. Refresh and check again.
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
                    Sign out
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
            <DialogTitle>Sign out everywhere else?</DialogTitle>
            <DialogDescription>
              {others === 1 ? "One other device" : `${others} other devices`}{" "}
              will stop working on their next tap, and stop receiving your
              customers&apos; messages. You stay signed in here. Anyone who
              should still have access can sign back in with their password.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmAll(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={revoke.isPending}
              onClick={signOutEverywhereElse}
            >
              Sign them out
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsCard>
  );
}

function CrewDevices() {
  const sessions = useWorkspaceSessions(true);
  const members = useMembers();
  const revoke = useRevokeMemberSessions();
  const [target, setTarget] = useState<{ id: string; name: string } | null>(
    null,
  );

  const nameByMember = new Map(
    (members.data?.data ?? []).map((member) => [
      member.id,
      member.display_name?.trim() || "A crew member",
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
            ? "They had nothing signed in."
            : `Signed ${target.name} out of ${result.sessions} ${
                result.sessions === 1 ? "device" : "devices"
              }.`,
        );
      },
      onError: (error) => {
        toast.error(
          error instanceof ApiError
            ? error.message
            : "Couldn't sign them out. Try again.",
        );
      },
    });
  }

  return (
    <SettingsCard
      title="The crew's devices"
      description="Everything signed in to this workspace. Removing someone already ends their access — this is for a phone that went missing while they are still on the team."
    >
      {(sessions.isPending || members.isPending) && (
        <div className="space-y-3" aria-label="Loading the crew's devices">
          <Skeleton className="h-14 w-full rounded-md" />
          <Skeleton className="h-14 w-full rounded-md" />
        </div>
      )}

      {sessions.isError && <LoadError onRetry={() => void sessions.refetch()} />}

      {sessions.isSuccess && rows.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Nobody on the crew has anything signed in right now.
        </p>
      )}

      {sessions.isSuccess && rows.length > 0 && (
        <div className="divide-y divide-border-subtle">
          {rows.map((row) => {
            const name = row.member_id
              ? (nameByMember.get(row.member_id) ?? "A crew member")
              : "A crew member";
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
                      Sign out
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
            <DialogTitle>Sign {target?.name} out?</DialogTitle>
            <DialogDescription>
              Every device they are signed in on —{" "}
              {target ? (countByMember.get(target.id) ?? 0) : 0} right now —
              stops working on its next tap and stops receiving this
              workspace&apos;s messages. They keep their seat and can sign back
              in; a call they are on right now is not cut off.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setTarget(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={revoke.isPending}
              onClick={signOutMember}
            >
              Sign them out
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsCard>
  );
}
