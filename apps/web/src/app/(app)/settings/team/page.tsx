"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import {
  LoadError,
  SettingsCard,
  SettingsPage,
} from "@/components/settings/section";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useCompany } from "@/lib/api/companies";
import { ApiError } from "@/lib/api/error";
import {
  useCreateInvite,
  useDeactivateMember,
  useInvites,
  useMembers,
  useRevokeInvite,
  useUpdateMemberRole,
} from "@/lib/api/team";
import type { Invite, Member } from "@/lib/api/types";
import { useActiveCompany } from "@/lib/company/provider";
import { formatAbsoluteDateTime, formatRelativeTime } from "@/lib/format/time";
import {
  countActiveMembers,
  countPendingInvites,
  seatUsage,
} from "@/lib/settings/seat-line";

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

const ROLE_LABELS: Record<Member["role"], string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
};

function MemberRow({
  member,
  canManage,
  isSelf,
}: {
  member: Member;
  canManage: boolean;
  isSelf: boolean;
}) {
  const updateRole = useUpdateMemberRole();
  const deactivate = useDeactivateMember();
  const [confirming, setConfirming] = useState(false);
  const name = member.display_name || "Teammate";
  const deactivated = member.deactivated_at !== null;

  return (
    <div className="flex items-center gap-3 py-3">
      <Avatar className="size-8">
        <AvatarFallback className="bg-primary/10 text-xs font-medium text-primary">
          {initials(name)}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {name}
          {isSelf && <span className="text-muted-foreground"> (you)</span>}
        </p>
        <p
          className="text-xs text-muted-foreground"
          title={formatAbsoluteDateTime(
            deactivated ? (member.deactivated_at as string) : member.created_at,
          )}
        >
          {deactivated
            ? `Deactivated ${formatRelativeTime(member.deactivated_at as string)}`
            : `Joined ${formatRelativeTime(member.created_at)}`}
        </p>
      </div>
      {canManage && member.role !== "owner" && !deactivated ? (
        <Select
          value={member.role}
          onValueChange={(role) =>
            updateRole.mutate(
              { memberId: member.id, role: role as "admin" | "member" },
              {
                onError: (cause) =>
                  toast.error(
                    cause instanceof ApiError
                      ? cause.message
                      : "Couldn't change the role. Try again.",
                  ),
              },
            )
          }
          disabled={updateRole.isPending}
        >
          <SelectTrigger
            size="sm"
            className="w-28"
            aria-label={`Role for ${name}`}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="admin">Admin</SelectItem>
            <SelectItem value="member">Member</SelectItem>
          </SelectContent>
        </Select>
      ) : (
        <Badge variant="secondary">{ROLE_LABELS[member.role]}</Badge>
      )}
      {canManage && member.role !== "owner" && !isSelf && !deactivated && (
        <>
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-destructive"
            onClick={() => setConfirming(true)}
          >
            Deactivate
          </Button>
          <Dialog open={confirming} onOpenChange={setConfirming}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Deactivate {name}?</DialogTitle>
                <DialogDescription>
                  They lose access right away and their seat frees up.
                  Conversations and messages they worked on stay put.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setConfirming(false)}>
                  Keep them
                </Button>
                <Button
                  variant="destructive"
                  disabled={deactivate.isPending}
                  onClick={() =>
                    deactivate.mutate(member.id, {
                      onSuccess: () => {
                        setConfirming(false);
                        toast.success(`${name} deactivated.`);
                      },
                      onError: (cause) =>
                        toast.error(
                          cause instanceof ApiError
                            ? cause.message
                            : "Couldn't deactivate. Try again.",
                        ),
                    })
                  }
                >
                  {deactivate.isPending ? "Deactivating…" : "Deactivate"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  );
}

function isPendingInvite(invite: Invite, now: Date): boolean {
  return (
    invite.accepted_at === null &&
    invite.revoked_at === null &&
    new Date(invite.expires_at).getTime() > now.getTime()
  );
}

function InviteRow({ invite }: { invite: Invite }) {
  const revoke = useRevokeInvite();
  const expired = new Date(invite.expires_at).getTime() <= Date.now();

  return (
    <div className="flex items-center gap-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{invite.email}</p>
        <p className="text-xs text-muted-foreground">
          {ROLE_LABELS[invite.role]} ·{" "}
          {expired
            ? "Expired, doesn't hold a seat"
            : `Expires ${new Date(invite.expires_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`}
        </p>
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="text-muted-foreground hover:text-destructive"
        disabled={revoke.isPending}
        onClick={() =>
          revoke.mutate(invite.id, {
            onSuccess: () => toast.success("Invite revoked."),
            onError: (cause) =>
              toast.error(
                cause instanceof ApiError
                  ? cause.message
                  : "Couldn't revoke the invite. Try again.",
              ),
          })
        }
      >
        Revoke
      </Button>
    </div>
  );
}

// Mirrors the API invite schema (apps/api/src/routes/team.ts): a real email +
// role admin|member (owner never assignable).
const inviteSchema = z.object({
  email: z.email("Enter a valid email address."),
  role: z.enum(["admin", "member"]),
});
type InviteValues = z.infer<typeof inviteSchema>;

/** Invite form + pending list — rendered for owners/admins only (the API 403s members). */
function InvitesSection({ activeMemberCount }: { activeMemberCount: number }) {
  const company = useCompany();
  const invites = useInvites();
  const createInvite = useCreateInvite();
  const form = useForm<InviteValues>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { email: "", role: "member" },
  });

  if (invites.isPending || company.isPending) {
    return (
      <SettingsCard title="Invites">
        <Skeleton className="h-16 w-full" />
      </SettingsCard>
    );
  }
  if (invites.isError || company.isError) {
    return (
      <SettingsCard title="Invites">
        <LoadError
          onRetry={() => {
            void invites.refetch();
            void company.refetch();
          }}
        />
      </SettingsCard>
    );
  }

  const now = new Date();
  const pending = invites.data.data.filter((i) => isPendingInvite(i, now));
  const seats = seatUsage(
    activeMemberCount,
    countPendingInvites(invites.data.data, now),
    company.data.plan,
  );

  function onSubmit(values: InviteValues) {
    createInvite.mutate(values, {
      onSuccess: () => {
        form.reset({ email: "", role: "member" });
        toast.success(`Invite sent to ${values.email}.`);
      },
      onError: (cause) =>
        form.setError("root", {
          message:
            cause instanceof ApiError
              ? cause.message
              : "Couldn't send the invite. Try again.",
        }),
    });
  }

  return (
    <SettingsCard
      title="Invites"
      description="Teammates get an email link that adds them to this workspace."
      footer={<p className="text-sm text-muted-foreground">{seats.line}</p>}
    >
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="flex flex-col gap-2 sm:flex-row sm:items-start"
          noValidate
        >
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem className="flex-1">
                <FormLabel>Email</FormLabel>
                <FormControl>
                  <Input
                    type="email"
                    inputMode="email"
                    autoComplete="off"
                    placeholder="teammate@company.com"
                    disabled={seats.full}
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="role"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Role</FormLabel>
                <Select
                  value={field.value}
                  onValueChange={field.onChange}
                  disabled={seats.full}
                >
                  <FormControl>
                    <SelectTrigger className="w-full sm:w-32">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="member">Member</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button
            type="submit"
            disabled={seats.full || createInvite.isPending}
            className="sm:mt-[1.625rem]"
          >
            {createInvite.isPending ? "Sending…" : "Invite"}
          </Button>
        </form>
      </Form>
      {form.formState.errors.root && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {form.formState.errors.root.message}
        </p>
      )}
      {pending.length > 0 && (
        <div className="mt-4 divide-y border-t pt-1">
          {pending.map((invite) => (
            <InviteRow key={invite.id} invite={invite} />
          ))}
        </div>
      )}
    </SettingsCard>
  );
}

export default function TeamSettingsPage() {
  const { role, userId } = useActiveCompany();
  const members = useMembers();
  const canManage = role === "owner" || role === "admin";

  const active = members.data?.data.filter((m) => m.deactivated_at === null);
  const deactivated = members.data?.data.filter(
    (m) => m.deactivated_at !== null,
  );

  return (
    <SettingsPage
      title="Team"
      description="Who can see and answer your customers' texts."
    >
      <div className="space-y-6">
        {members.isPending ? (
          <div className="space-y-3" aria-label="Loading team">
            <Skeleton className="h-16 w-full rounded-lg" />
            <Skeleton className="h-16 w-full rounded-lg" />
          </div>
        ) : members.isError ? (
          <LoadError onRetry={() => members.refetch()} />
        ) : (
          <>
            <SettingsCard title="Members">
              <div className="divide-y">
                {active?.map((member) => (
                  <MemberRow
                    key={member.id}
                    member={member}
                    canManage={canManage}
                    isSelf={member.user_id === userId}
                  />
                ))}
              </div>
              {deactivated && deactivated.length > 0 && (
                <div className="mt-2 border-t pt-2">
                  <p className="pt-1 text-xs font-medium text-muted-foreground">
                    Deactivated
                  </p>
                  <div className="divide-y opacity-60">
                    {deactivated.map((member) => (
                      <MemberRow
                        key={member.id}
                        member={member}
                        canManage={false}
                        isSelf={member.user_id === userId}
                      />
                    ))}
                  </div>
                </div>
              )}
            </SettingsCard>
            {canManage ? (
              <InvitesSection activeMemberCount={countActiveMembers(active ?? [])} />
            ) : (
              <p className="text-sm text-muted-foreground">
                Only owners and admins can invite or deactivate teammates.
              </p>
            )}
          </>
        )}
      </div>
    </SettingsPage>
  );
}
