"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
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
  useMemberHoldings,
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
  teammates = [],
}: {
  member: Member;
  canManage: boolean;
  isSelf: boolean;
  /** Active members this person's open work could be handed to (#276). */
  teammates?: Member[];
}) {
  const updateRole = useUpdateMemberRole();
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
      {canManage && member.role !== "owner" && !isSelf && (
        <>
          <Button
            variant="ghost"
            size="sm"
            className={
              deactivated
                ? "text-muted-foreground hover:text-foreground"
                : "text-muted-foreground hover:text-destructive"
            }
            onClick={() => setConfirming(true)}
          >
            {/* #276: every workspace that has ever removed someone has work
                still pointing at them — this is how an owner finds it. */}
            {deactivated ? "Move their work" : "Deactivate"}
          </Button>
          <OffboardDialog
            open={confirming}
            onOpenChange={setConfirming}
            member={member}
            name={name}
            teammates={teammates}
            alreadyGone={deactivated}
          />
        </>
      )}
    </div>
  );
}

/** Sentinel for "nobody" — a Select cannot hold null. */
const UNASSIGNED = "unassigned";

/**
 * #276 — removing someone, with their work accounted for.
 *
 * Deactivation used to hide the person and leave everything they were holding
 * pointing at them: assigned conversations owned by someone who would never
 * open the app again, open tasks nobody would pick up. It did not fail loudly;
 * it just stopped, and the first sign was a customer asking why nobody called
 * back. So this asks the one question that was missing — where does their work
 * go — and only asks it when there is work to move.
 */
function OffboardDialog({
  open,
  onOpenChange,
  member,
  name,
  teammates,
  alreadyGone = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  member: Member;
  name: string;
  teammates: Member[];
  /** They left before this flow existed — this is only about their work. */
  alreadyGone?: boolean;
}) {
  const deactivate = useDeactivateMember();
  const holdings = useMemberHoldings(open ? member.id : null);
  const [destination, setDestination] = useState<string>(UNASSIGNED);

  const carrying =
    (holdings.data?.conversations ?? 0) + (holdings.data?.tasks ?? 0);
  const hasWork = carrying > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {alreadyGone ? `Move ${name}'s work?` : `Remove ${name}?`}
          </DialogTitle>
          <DialogDescription>
            {alreadyGone
              ? `${name} already left, but work was left pointing at them. Send it somewhere a person will look.`
              : "They lose access right away — signed out everywhere, and notifications stop reaching their phone. Their past messages stay theirs."}
          </DialogDescription>
        </DialogHeader>

        {holdings.isPending ? (
          <p className="text-sm text-muted-foreground">
            Checking what {name} is working on…
          </p>
        ) : hasWork ? (
          <div className="space-y-3">
            <p className="text-sm">
              {name} is still on{" "}
              <strong>{plural(holdings.data?.conversations ?? 0, "conversation")}</strong>{" "}
              and <strong>{plural(holdings.data?.tasks ?? 0, "task")}</strong>.
              Where should that go?
            </p>
            <Select value={destination} onValueChange={setDestination}>
              <SelectTrigger aria-label="Hand their work to">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNASSIGNED}>
                  Leave it unassigned for the crew
                </SelectItem>
                {teammates.map((mate) => (
                  <SelectItem key={mate.user_id} value={mate.user_id}>
                    Hand it to {mate.display_name || "a teammate"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {name} isn&apos;t holding any open conversations or tasks.
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {alreadyGone ? "Cancel" : "Keep them"}
          </Button>
          <Button
            variant={alreadyGone ? "default" : "destructive"}
            disabled={
              deactivate.isPending ||
              holdings.isPending ||
              // Nothing to move for someone already gone — nothing to press.
              (alreadyGone && !hasWork)
            }
            onClick={() =>
              deactivate.mutate(
                {
                  memberId: member.id,
                  reassignTo: destination === UNASSIGNED ? null : destination,
                },
                {
                  onSuccess: (result) => {
                    onOpenChange(false);
                    // Say what actually happened, not just that it did.
                    const moved =
                      result.conversations_moved + result.tasks_moved;
                    const where =
                      destination === UNASSIGNED
                        ? `${plural(moved, "item")} left for the crew`
                        : `${plural(moved, "item")} handed on`;
                    toast.success(
                      alreadyGone
                        ? `${where.charAt(0).toUpperCase()}${where.slice(1)}.`
                        : moved === 0
                          ? `${name} removed.`
                          : `${name} removed. ${where}.`,
                    );
                  },
                  onError: (cause) =>
                    toast.error(
                      cause instanceof ApiError
                        ? cause.message
                        : "Couldn't remove them. Try again.",
                    ),
                },
              )
            }
          >
            {deactivate.isPending
              ? alreadyGone
                ? "Moving…"
                : "Removing…"
              : alreadyGone
                ? "Move the work"
                : "Remove"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** "1 task" / "3 tasks" — the count belongs in the sentence, not beside it. */
function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
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
      {/* #99: a shareable accept link — the only way an invitee who already has
          an account (Supabase emails them nothing) can find their invite. */}
      <Button
        variant="ghost"
        size="sm"
        className="text-muted-foreground"
        disabled={expired}
        aria-label={`Copy invite link for ${invite.email}`}
        onClick={() => {
          void navigator.clipboard
            .writeText(`${window.location.origin}/invite/${invite.id}`)
            .then(() => toast.success("Invite link copied."))
            .catch(() => toast.error("Couldn't copy the link."));
        }}
      >
        Copy link
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="text-muted-foreground hover:text-destructive"
        disabled={revoke.isPending}
        aria-label={`Revoke invite for ${invite.email}`}
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
    // #392: the server's number wins. The local formula is the fallback for a
    // client that has never loaded — a client copy HIGHER than the API's tells
    // an owner they have room and then the invite 409s, at the exact moment
    // they are trying to grow.
    company.data.seat_limit,
  );

  function onSubmit(values: InviteValues) {
    createInvite.mutate(values, {
      onSuccess: (created) => {
        form.reset({ email: "", role: "member" });
        if (created.email_sent) {
          toast.success(`Invite sent to ${values.email}.`);
        } else {
          // #109: every invite is emailed automatically now (new addresses via
          // Supabase Auth, existing accounts via a direct email). email_sent is
          // false only when that send FAILED — point the inviter at the
          // shareable link so the teammate isn't silently stranded.
          toast.warning(
            `The invite is saved, but we couldn't email ${values.email} — use "Copy link" below to send it to them.`,
            { duration: 8000 },
          );
        }
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
      description="Teammates get an email link that adds them to this workspace. If they already have a Loonext account, share their invite link instead."
      footer={
        seats.canUpgrade ? (
          // #392. At 3 of 3 the owner has a real person in front of them and a
          // reason — the highest-intent upgrade moment this product has, and it
          // was a sentence telling them to go and find billing themselves.
          // *Applying: Loss Aversion (they are blocked from adding somebody
          // right now, which is the strongest honest framing available) and §5
          // Paywalls (a CTA at the decision point, with a chevron, not prose).*
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              {seats.used} of {seats.limit} seats. Upgrade to add more of your
              crew.
            </p>
            <Button asChild size="sm" variant="outline">
              <Link href="/settings/billing?reason=seats">
                See plans
                <ChevronRight className="size-4" aria-hidden />
              </Link>
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{seats.line}</p>
        )
      }
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
                    // #276: everyone still here is somewhere this person's
                    // open work could go.
                    teammates={
                      active?.filter((mate) => mate.id !== member.id) ?? []
                    }
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
                        // #276: an owner must be able to reach work these
                        // people were still holding when they left.
                        canManage={canManage}
                        isSelf={member.user_id === userId}
                        teammates={active ?? []}
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
