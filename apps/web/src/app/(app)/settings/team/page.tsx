"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { roleHasCapability, SELF_DOWNGRADE_ACK } from "@loonext/shared";

import {
  GiveUpAccessDialog,
  roleChangeNeedsConfirming,
} from "@/components/settings/give-up-access-dialog";
import { OwnershipCard } from "@/components/settings/ownership-card";
import { RequireTwoFactorCard } from "@/components/settings/require-two-factor-card";
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
  FormDescription,
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
import { Textarea } from "@/components/ui/textarea";
import { useCompany } from "@/lib/api/companies";
import { MemberAccessDialog } from "@/components/settings/member-access-dialog";
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
  read_only: "View only",
  bookkeeper: "Bookkeeper",
};

/**
 * #315: what each role is FOR, in the words an owner picking one would use.
 * A checkbox grid is a correct model and a bad product for a crew of four, so
 * the roles ship as named presets and the picker says what each is for.
 */
const ROLE_BLURBS: Record<
  "admin" | "member" | "read_only" | "bookkeeper",
  string
> = {
  admin: "Everything except transferring ownership and closing the workspace",
  member: "Read and answer customers; no billing, team or settings",
  read_only: "Can see conversations, cannot reply or change anything",
  bookkeeper: "Billing and invoices only; no access to conversations",
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
  // #538: the role this person has asked to give themselves, held until they
  // confirm. Null the rest of the time, which is almost always.
  const [givingUp, setGivingUp] = useState<"admin" | "member" | null>(null);
  // #348: what this person actually reaches, on demand.
  const [showingAccess, setShowingAccess] = useState(false);
  const name = member.display_name || "Teammate";
  const deactivated = member.deactivated_at !== null;

  function changeRole(role: "admin" | "member", acknowledged = false) {
    updateRole.mutate(
      {
        memberId: member.id,
        role,
        ...(acknowledged ? { [SELF_DOWNGRADE_ACK]: true } : {}),
      },
      {
        onError: (cause) =>
          toast.error(
            cause instanceof ApiError
              ? cause.message
              : "Couldn't change the role. Try again.",
          ),
      },
    );
  }

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
      {/* #348: the access model was complete and entirely invisible. Quiet and
          text-only — it answers a question, it is not an action, and the row
          already carries a role control and a destructive button. */}
      {canManage && !deactivated && (
        <>
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => setShowingAccess(true)}
          >
            Numbers
          </Button>
          <MemberAccessDialog
            userId={member.user_id}
            name={name}
            open={showingAccess}
            onOpenChange={setShowingAccess}
          />
        </>
      )}
      {canManage && member.role !== "owner" && !deactivated ? (
        <Select
          value={member.role}
          onValueChange={(value) => {
            const role = value as "admin" | "member";
            // #538: TAKING POWERS OFF YOURSELF STOPS AND ASKS.
            //
            // An admin who picks "member" here loses the ability to change roles
            // in the same stroke — which is the ability that would let them
            // change it back. The dropdown gave no sign of that, so an afternoon
            // of chasing the owner started with a two-click gesture.
            //
            // Only for THIS person's own row, and only when it takes something
            // away. An owner demoting somebody else can undo it, and a
            // confirmation that fires on everything is one people learn to
            // dismiss before it matters.
            // *Applying: Ethical Friction — a confirmation layer on the action
            // this person cannot reverse themselves.*
            if (roleChangeNeedsConfirming(isSelf, member.role, role)) {
              setGivingUp(role);
              return;
            }
            changeRole(role);
          }}
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
            <SelectItem value="read_only">View only</SelectItem>
            <SelectItem value="bookkeeper">Bookkeeper</SelectItem>
          </SelectContent>
        </Select>
      ) : (
        <Badge variant="secondary">{ROLE_LABELS[member.role]}</Badge>
      )}
      {/* #538: mounted OUTSIDE the offboard block, which is guarded on `!isSelf`
          — the one case this dialog exists for. It renders nothing until somebody
          asks to give up their own access, which is almost always. */}
      <GiveUpAccessDialog
        from={member.role}
        to={givingUp}
        pending={updateRole.isPending}
        onCancel={() => setGivingUp(null)}
        onConfirm={() => {
          const role = givingUp;
          setGivingUp(null);
          if (role) changeRole(role, true);
        }}
      />
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
/**
 * #538 — before you take powers off yourself.
 *
 * ## Evaluation
 *
 * The role dropdown applied instantly. An admin choosing "member" for their own
 * row lost the ability to change roles in the same gesture — the ability that
 * would have let them change it back — and nothing said so. The way out is to find
 * the owner.
 *
 * ## What binds it
 *
 * *Ethical Friction* — a confirmation layer, because this is the one role change
 * the person making it cannot reverse. It is NOT a typed confirmation: nothing is
 * destroyed and an owner restores it in a tap, so a dialog that made somebody type
 * their workspace name would be theatre.
 *
 * *Meaningful Highlights* — the sentence names what is actually lost, in things
 * they do rather than permission names, and says who can undo it. "Are you sure?"
 * is the version of this dialog that teaches people to click through.
 *
 * The confirm button says what happens rather than "OK", so somebody skimming the
 * buttons still reads the decision.
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
        {/* #521: what this person will be told, still readable by the person
            who wrote it. There is no way to change a note once the invite
            exists, so without this the sentence becomes unverifiable the
            moment it is sent, and the next place it appears is in front of the
            new member. Bounded and scrollable rather than clamped: a truncated
            note is exactly as unverifiable as no note.
            *Applying: Zen of Clarity. The row's actions keep their weight; the
            quote is quiet, indented, and never taller than a couple of lines
            of the list.* */}
        {invite.note && (
          <blockquote className="mt-1.5 max-h-16 overflow-y-auto whitespace-pre-wrap break-words border-l-2 border-border pl-2 text-xs text-muted-foreground">
            {invite.note}
          </blockquote>
        )}
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

/**
 * The note's cap, mirroring the column CHECK and the API's zod
 * (apps/api/src/routes/team.ts). Held here so the field simply stops taking
 * characters instead of letting somebody write past the limit and meet a 422.
 */
const NOTE_MAX = 500;

/**
 * How close to the cap the count appears. A counter pinned to the screen reads
 * as a word budget on a field most invites leave empty; one that shows up in
 * the last stretch is the only point at which it is information.
 */
const NOTE_COUNTDOWN_FROM = 50;

/**
 * What the field actually promises, kept as one literal because
 * `packages/shared/src/member-orientation-copy.test.ts` reads this file as text
 * to hold the three clients to the same sentence, and a wrapped JSX string is
 * not the sentence any more.
 *
 * It says "when they join" and nothing about mail on purpose. A brand new
 * address is invited by Supabase Auth from a template this repo does not own,
 * and that template carries no note; only the fallback for an address that
 * already has an account renders one. What is true of every invite is that the
 * note is read once, on the way in, and cannot be edited afterwards.
 */
const NOTE_DESCRIPTION =
  "They see this once, when they join. You cannot change it after the invite goes out.";

// Mirrors the API invite schema (apps/api/src/routes/team.ts): a real email +
// role admin|member (owner never assignable) + an optional note.
const inviteSchema = z.object({
  email: z.email("Enter a valid email address."),
  role: z.enum(["admin", "member"]),
  /**
   * Optional the whole way down: no minimum, nothing required, and nothing
   * here can hold up an invite that leaves it blank. The cap is the API's,
   * restated so the only route to its 422 is defeating the field's own
   * maxLength.
   */
  note: z
    .string()
    .max(NOTE_MAX, `Keep the note under ${NOTE_MAX} characters.`),
});
type InviteValues = z.infer<typeof inviteSchema>;

/** Invite form + pending list — rendered for owners/admins only (the API 403s members). */
function InvitesSection({ activeMemberCount }: { activeMemberCount: number }) {
  const company = useCompany();
  const invites = useInvites();
  const createInvite = useCreateInvite();
  const form = useForm<InviteValues>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { email: "", role: "member", note: "" },
  });
  const noteLeft = NOTE_MAX - form.watch("note").length;

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
    createInvite.mutate(
      {
        ...values,
        // Blank is no note. The server normalises whitespace to null as well,
        // but sending "" would have this client claiming somebody wrote an
        // empty string, which is a different thing from writing nothing.
        note: values.note.trim() === "" ? null : values.note,
      },
      {
        onSuccess: (created) => {
          form.reset({ email: "", role: "member", note: "" });
          if (created.email_sent) {
            toast.success(`Invite sent to ${values.email}.`);
          } else {
            // #109: every invite is emailed automatically now (new addresses
            // via Supabase Auth, existing accounts via a direct email).
            // email_sent is false only when that send FAILED — point the
            // inviter at the shareable link so the teammate isn't silently
            // stranded.
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
      },
    );
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
          className="space-y-3"
          noValidate
        >
          {/* Who, then why. The note sits under the pair rather than beside
              them so the field an owner may want two sentences in is not a
              third column, and so tab order still ends on Invite. */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
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
                      <SelectTrigger className="w-full sm:w-36">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent className="max-w-[min(22rem,calc(100vw-2rem))]">
                      {/* #315: named presets, and each says what it is FOR. An
                          owner picking a role for their accountant should not
                          have to infer it from the word "member". */}
                      {(
                        ["member", "admin", "read_only", "bookkeeper"] as const
                      ).map((value) => (
                        <SelectItem key={value} value={value}>
                          <span className="flex flex-col gap-0.5 py-0.5">
                            <span>{ROLE_LABELS[value]}</span>
                            <span className="text-xs text-muted-foreground whitespace-normal">
                              {ROLE_BLURBS[value]}
                            </span>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
          {/* #521: why this person, in the owner's words. Optional in every
              direction: blank sends exactly the invite it sent before this
              field existed, and nothing here can hold up a submit. */}
          <FormField
            control={form.control}
            name="note"
            render={({ field }) => (
              <FormItem>
                <FormLabel>What to tell them (optional)</FormLabel>
                <FormControl>
                  <Textarea
                    rows={2}
                    maxLength={NOTE_MAX}
                    placeholder="What they'll be doing, or anything they should know on day one."
                    disabled={seats.full}
                    {...field}
                  />
                </FormControl>
                {/* The count lives INSIDE the description because the field
                    already points at it: `FormControl` wires aria-describedby
                    to this one element and nothing else, so a sibling
                    paragraph is text a screen reader never reaches from the
                    field. The description is the live region rather than the
                    count itself, so the region is already there when the count
                    appears; a region that arrives already populated is the
                    case readers announce least reliably. Nothing else in here
                    ever changes, so the count is the only thing spoken. */}
                <FormDescription aria-live="polite">
                  {NOTE_DESCRIPTION}
                  {noteLeft <= NOTE_COUNTDOWN_FROM && (
                    <span className="mt-1 block text-xs tabular-nums">
                      {plural(noteLeft, "character")} left
                    </span>
                  )}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <div className="flex justify-end">
            <Button
              type="submit"
              disabled={seats.full || createInvite.isPending}
            >
              {createInvite.isPending ? "Sending…" : "Invite"}
            </Button>
          </div>
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
  // #314: the workspace's two-factor policy lives on the company view, so the
  // owner's control reads its current state from the same place every client
  // reads the deadline from.
  const company = useCompany();
  // #315: the capability, not the two role names. Since #286 opened this page
  // to every role, this boolean is the only thing between a member and a row
  // of controls that would fail at the server — it has to answer the same
  // question `requireCapability("team.manage")` answers there.
  const canManage = roleHasCapability(role, "team.manage");

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
            {/* #332: everybody sees this, including a plain member — a
                handover in flight is exactly the thing a colleague is best
                placed to notice is wrong. */}
            <OwnershipCard members={members.data?.data ?? []} />
            {/* #314: a crew-wide security policy sits with the crew, and
                only the owner can set one. */}
            {role === "owner" && (
              <RequireTwoFactorCard
                required={company.data?.mfa_required_at != null}
                graceUntil={company.data?.mfa_grace_until ?? null}
              />
            )}
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
