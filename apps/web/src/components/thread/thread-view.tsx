"use client";

import { avatarInitials, roleHasCapability } from "@loonext/shared";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, UserRound, X } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { ContactPanel } from "@/components/contact-panel/contact-panel";
import { MemberAvatar, useMemberNames } from "@/components/inbox/member-avatar";
import { StatusPill } from "@/components/inbox/status-pill";
import { avatarColorClass } from "@/components/shell/avatar-color";
import {
  PanelOverflowMenu,
  PanelResizeHandle,
  usePanelWidth,
} from "@/components/thread/panel-width";
import { SpamSuspectedBanner } from "@/components/thread/spam-suspected-banner";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useT } from "@/i18n/provider";
import { findListRow } from "@/lib/api/cache";
import { useCompany } from "@/lib/api/companies";
import { useActiveCompany } from "@/lib/company/provider";
import { useMe } from "@/lib/api/me";
import { useCompanyId } from "@/lib/company/provider";
import { useConversationPresence } from "@/lib/realtime/presence";
import { PresenceStrip } from "@/components/thread/presence-strip";
import { useContact } from "@/lib/api/contacts";
import {
  readCoveredThrough,
  useConversation,
  useMarkConversationRead,
} from "@/lib/api/conversations";
import { ApiError } from "@/lib/api/error";
import { useMessages } from "@/lib/api/messages";
import type {
  ConversationDetail,
  ConversationListItem,
  Message,
} from "@/lib/api/types";
import { useUsage } from "@/lib/api/usage";
import { contactDisplayName, formatPhone } from "@/lib/format/phone";
import {
  THREAD_CALL_PARAM,
  THREAD_MESSAGE_PARAM,
  THREAD_TASK_PARAM,
} from "@/lib/inbox/thread-href";
import { updateSearch } from "@/lib/url/search-state";
import { useIsXl } from "@/lib/use-is-xl";
import { cn } from "@/lib/utils";
import { TaskDetailPanel } from "@/components/tasks/task-detail-panel";
import { LoadError } from "@/components/ui/load-error";

import { AttachmentsGallery } from "./attachments-gallery";
import {
  destinationCountry,
  selectComposerBanner,
  usSendApproved,
  usTextingOff,
  usSuspended,
} from "./composer-banner";
import { ComposerBannerCard } from "./composer-banners";
import { Composer } from "./composer";
import { AlertBanner } from "./alert-banner";
import { ScheduledStrip } from "./scheduled-strip";
import { TheirTime } from "./their-time";
import { MessageList } from "./message-list";
import {
  parseThreadFilter,
  serializeThreadFilter,
  type ThreadFilter,
} from "./thread-filter";
import { ThreadHeader } from "./thread-header";
import { ThreadBodySkeleton, ThreadSkeleton } from "./thread-skeleton";
import { useCatchUp } from "./use-catch-up";

const PANEL_PREF_KEY = "loonext:contact-panel-open";

function readPanelPref(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(PANEL_PREF_KEY) === "true";
  } catch {
    return false;
  }
}

// §5.1 in-thread filter: `?thread=` is the comma list of enabled kinds, absent when all are on.
function writeThreadFilter(next: ThreadFilter) {
  const serialized = serializeThreadFilter(next);
  updateSearch((params) => {
    if (serialized === null) params.delete("thread");
    else params.set("thread", serialized);
  });
}

function closeThreadTask() {
  updateSearch((params) => params.delete(THREAD_TASK_PARAM));
}

// Back to the plain thread: the anchor is dropped and the newest page loads.
function jumpToLatest() {
  updateSearch((params) => {
    params.delete(THREAD_MESSAGE_PARAM);
    params.delete(THREAD_CALL_PARAM);
  });
}

/** The newest loaded message that `userId` did not send, newest page first. */
function newestNotSentBy(
  pages: readonly { data: Message[] }[] | undefined,
  userId: string,
): Message | undefined {
  for (const page of pages ?? []) {
    const message = page.data.find((m) => m.sent_by_user_id !== userId);
    if (message) return message;
  }
  return undefined;
}

// G4: the server counts a thread unread when the newest message the member did not send is newer than their last read.
function readIsCurrent({
  row,
  newestIsMine,
  otherAt,
  otherFromCustomer,
  coveredThrough,
}: {
  row: ConversationListItem | undefined;
  newestIsMine: boolean;
  otherAt: string | null;
  otherFromCustomer: boolean;
  coveredThrough: string | undefined;
}): boolean {
  if (row?.unread !== false) return false;
  const covered =
    otherAt !== null &&
    coveredThrough !== undefined &&
    Date.parse(otherAt) <= Date.parse(coveredThrough);
  if (!newestIsMine) return covered;
  // Realtime flags a row unread for a customer's message only, so a teammate's or an automated one needs this tab's read.
  return otherAt === null || otherFromCustomer || covered;
}

/**
 * The G5 thread screen: header → virtualized timeline → composer (or the
 * banner replacing it) with the G6 contact panel on the right (persisted
 * toggle on desktop, bottom sheet on mobile). While the detail loads, the
 * inbox row already in cache draws the header; without one, a skeleton.
 * not_found and network errors are distinct, designed states.
 */
export function ThreadView({ conversationId }: { conversationId: string }) {
  const t = useT();
  const queryClient = useQueryClient();
  const companyId = useCompanyId();
  const detail = useConversation(conversationId);

  if (detail.isPending) {
    const row = findListRow(queryClient, companyId, conversationId);
    return row ? <ThreadPlaceholder row={row} /> : <ThreadSkeleton />;
  }

  // #299: a failed refetch keeps the open thread on screen; a conversation that is gone does not.
  const notFound =
    detail.isError &&
    detail.error instanceof ApiError &&
    detail.error.code === "not_found";
  if (detail.isLoadingError || notFound) {
    return (
      <LoadError
        variant="fill"
        className="h-full"
        message={notFound ? t("thread.conversationNotFound") : t("thread.conversationLoadFailed")}
        onRetry={() => void detail.refetch()}
        action={
          notFound ? (
            <Button asChild variant="outline" size="sm">
              <Link href="/inbox">{t("thread.backToInbox")}</Link>
            </Button>
          ) : undefined
        }
      />
    );
  }

  return <ThreadLoaded conversation={detail.data} />;
}

// No composer, read or presence here: viewer level, opt-out and the clock come only from the detail (#106/#363).
function ThreadPlaceholder({ row }: { row: ConversationListItem }) {
  const t = useT();
  const memberNames = useMemberNames();
  const name = contactDisplayName(row.contact);
  const assigneeName = row.assigned_user_id
    ? memberNames.get(row.assigned_user_id) ?? t("thread.teammate")
    : null;

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-app-ground" aria-busy>
      <header className="flex items-center gap-2 border-b border-app-line bg-app-paper px-2 py-1.5 md:gap-3 md:px-4 md:py-2.5">
        <Button
          asChild
          variant="ghost"
          size="icon-sm"
          className="md:hidden"
          aria-label={t("thread.backToInbox")}
        >
          <Link href="/inbox">
            <ArrowLeft className="size-4" strokeWidth={1.75} />
          </Link>
        </Button>
        <span
          aria-hidden
          className={cn(
            "hidden size-[42px] shrink-0 place-items-center rounded-[13px] text-[14px] font-bold text-app-olive-deep sm:grid",
            avatarColorClass(row.contact_id || name),
          )}
        >
          {avatarInitials(name)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate px-1 text-[15px] font-bold leading-tight text-app-ink md:leading-normal">
            {name}
          </p>
          {row.contact.name !== null && (
            <p className="hidden truncate px-1 text-[12.5px] tabular-nums text-app-muted md:block">
              {formatPhone(row.contact.phone_e164)}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="flex min-h-11 items-center md:min-h-0">
            <StatusPill status={row.status} />
          </span>
          <span className="flex min-h-11 min-w-11 items-center justify-center md:min-h-0 md:min-w-0">
            {assigneeName ? (
              <MemberAvatar name={assigneeName} className="size-6" />
            ) : (
              <span className="flex size-6 items-center justify-center rounded-full border border-dashed border-border text-muted-foreground">
                <UserRound className="size-3.5" strokeWidth={1.75} aria-hidden />
              </span>
            )}
          </span>
        </div>
      </header>
      <ThreadBodySkeleton />
    </div>
  );
}

function ThreadLoaded({ conversation }: { conversation: ConversationDetail }) {
  const t = useT();
  const conversationId = conversation.id;
  const queryClient = useQueryClient();
  const companyId = useCompanyId();
  const { userId, role } = useActiveCompany();

  // #302: who else is on this thread, and whether they are replying. The hook
  // owns its own realtime channel (see lib/realtime/presence.ts for why it is
  // not the number topic), announces this viewer, and returns nothing at all
  // when the connection is not healthy — stale presence is worse than none.
  const me = useMe();
  const presence = useConversationPresence({
    companyId,
    phoneNumberId: conversation.phone_number_id,
    conversationId,
    selfUserId: me.data?.user_id,
    displayName: me.data?.display_name,
  });
  const contact = useContact(conversation.contact_id);
  const company = useCompany();
  // The server sends cap_segments only to billing.manage, so the cap banner needs nobody else's read.
  const usage = useUsage({ enabled: roleHasCapability(role, "billing.manage") });
  const messages = useMessages(conversationId);
  const markRead = useMarkConversationRead();

  // §5.1 in-thread filter — independent Messages · Notes · Events toggles (#89).
  // URL is the state for shareability; it defaults to all-on and does not persist.
  const searchParams = useSearchParams();
  const threadFilter = parseThreadFilter(searchParams.get("thread"));

  // #718: a link can open the thread at a message (`?message=`) or a call
  // (`?call=`) and with a task beside it (`?task=`). The task takes the side
  // panel's place at xl; below that the global task drawer shows it.
  const taskId = searchParams.get(THREAD_TASK_PARAM);
  const callSessionId = searchParams.get(THREAD_CALL_PARAM);
  const wide = useIsXl();

  // Desktop panel preference persists (G3); mobile uses a bottom sheet.
  const [panelOpen, setPanelOpen] = useState(readPanelPref);
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false);
  // Panel width starts at the default (so server + first client paint agree),
  // then adopts the stored value on mount — avoids a hydration mismatch on the
  // inline style. A ref mirrors it so the drag handler reads the live width.
  const {
    width: panelWidth,
    widthRef: panelWidthRef,
    resize: resizePanel,
    commit: setAndPersistPanelWidth,
  } = usePanelWidth();
  // §5.2: the attachments gallery has ONE entry point (the thread-header
  // overflow); the context panel's "View all attachments" row opens this same
  // surface. State lives here so both entry points share it.
  const [galleryOpen, setGalleryOpen] = useState(false);
  const openGallery = () => setGalleryOpen(true);
  const togglePanel = () => {
    // The context drawer shows at xl (1280px+); below that it collapses to the
    // header toggle and opens as the mobile sheet (PORTAL-UX §3.2 / §5).
    const isDesktop =
      typeof window !== "undefined" &&
      window.matchMedia("(min-width: 1280px)").matches;
    if (isDesktop) {
      setPanelOpen((open) => {
        try {
          window.localStorage.setItem(PANEL_PREF_KEY, String(!open));
        } catch {
          // Preference only — losing it is harmless.
        }
        return !open;
      });
    } else {
      setMobilePanelOpen(true);
    }
  };

  // G4: opening a thread, and each newer message while viewing, marks it read unless the server already counts it read.
  const newest = messages.data?.pages[0]?.data[0]; // newest-first (SPEC §7)
  const newestMessageId = newest?.id ?? null;
  const newestIsMine = newest !== undefined && newest.sent_by_user_id === userId;
  const other = newestNotSentBy(messages.data?.pages, userId);
  const otherAt = other?.created_at ?? null;
  const otherFromCustomer = other?.direction === "inbound";
  // #718: an anchored window that stops short of the newest cannot vouch for it.
  const windowHasNewer = messages.hasPreviousPage === true;
  const markReadMutate = markRead.mutate;
  useEffect(() => {
    const current =
      !windowHasNewer &&
      readIsCurrent({
        row: findListRow(queryClient, companyId, conversationId),
        newestIsMine,
        otherAt,
        otherFromCustomer,
        coveredThrough: readCoveredThrough(conversationId, userId),
      });
    if (!current) markReadMutate(conversationId);
  }, [
    conversationId,
    newestMessageId,
    newestIsMine,
    otherAt,
    otherFromCustomer,
    windowHasNewer,
    queryClient,
    companyId,
    userId,
    markReadMutate,
  ]);

  // #716: offered here, so the header menu and the composer's orb can ask and
  // the card above the stream answers.
  const catchUp = useCatchUp(conversationId, me.data?.user_id);

  const banner =
    company.data && contact.data
      ? selectComposerBanner({
          // #363: the reader's own level on THIS number. Checked first,
          // because it is the only fact here about them rather than about the
          // conversation.
          viewerLevel: conversation.viewer_level === "note" ? "note" : "text",
          // #315: the role and the per-number rule COMPOSE — whichever is more
          // restrictive wins. An observer is read-only on every number; a
          // note-level member is note-only on this one.
          viewerReadOnly: role === "read_only",
          contactOptedOut: contact.data.opted_out,
          contactOptOutSource: contact.data.opt_out_source,
          subscriptionStatus: company.data.subscription_status,
          destinationCountry: destinationCountry(
            conversation.contact.phone_e164,
          ),
          usApproved: usSendApproved(company.data),
          usTextingOff: usTextingOff(company.data),
          usSuspended: usSuspended(company.data),
          usage: usage.data ?? null,
          // #396: the thread itself is the only place this is known, and the
          // only place it matters — a shared inbox means the person replying
          // is often not the person who read the request.
          optOutHint: Boolean(conversation.opt_out_hint_at),
        })
      : null;

  return (
    <div className="flex h-full min-h-0">
      {/* The thread column: calm paper, structure by hairlines not wash. */}
      <div className="flex h-full min-w-0 flex-1 flex-col bg-app-ground">
        <ThreadHeader
          conversation={conversation}
          contact={contact.data}
          onToggleContactPanel={togglePanel}
          panelOpen={panelOpen}
          onOpenGallery={openGallery}
          filter={threadFilter}
          onFilterChange={writeThreadFilter}
          onCatchUp={catchUp.offered ? catchUp.ask : undefined}
        />
        {/* #250: above the list and above the filter bar, because a
            thread-level verdict outranks a view filter. shrink-0 or the
            flex column compresses it to nothing. */}
        <div className="shrink-0 px-4 pt-2 md:px-6">
          <div className="mx-auto w-full max-w-[42rem]">
            <SpamSuspectedBanner
              conversation={conversation}
              canAct={role !== "read_only"}
            />
          </div>
        </div>
        <MessageList
          key={`messages-${conversationId}`}
          conversationId={conversationId}
          contact={conversation.contact}
          contactTimeZone={
            conversation.destination_clock &&
            conversation.destination_clock.source !== "company"
              ? conversation.destination_clock.timezone
              : null
          }
          filter={threadFilter}
          onFilterChange={writeThreadFilter}
          callSessionId={callSessionId}
          onJumpToLatest={jumpToLatest}
          catchUp={{
            offered: catchUp.offered,
            askToken: catchUp.askToken,
            newestMessageId: catchUp.newestMessageId,
            onDismiss: catchUp.recapClosed,
          }}
        />
        {banner ? (
          <>
            <ComposerBannerCard
              banner={banner}
              thread={{
                conversationId,
                contactName: contactDisplayName(conversation.contact),
                canCall: conversation.viewer_level === "text",
              }}
            />
            {/* Keyed so the draft state cannot survive into a different
                conversation: without it the half-typed reply to one customer
                appeared in the box for the next one. The key is namespaced
                because the composer and the message list are siblings: React
                requires keys to be unique among siblings, and matching two
                different components on one key is undefined behaviour. */}
            {/* #233: shown even here. A banner means something is wrong with
                sending, which is exactly when a queued text is HELD and most
                needs saying out loud. */}
            {/* #244: above the scheduled strip, because this is the only
                thing on the screen with a clock running on it — somebody is
                waiting for a callback, and if nobody claims it the alert
                widens to the whole crew. Shown in BOTH composer branches for
                the same reason the strip above is: a notes-only member can
                still be the one who is awake.
                *Applying: Prioritize Intent — the core action first.* */}
            <AlertBanner
              conversationId={conversationId}
              alert={conversation.open_alert ?? null}
              viewerId={me.data?.user_id ?? null}
            />
            <ScheduledStrip conversationId={conversationId} />
            <PresenceStrip viewers={presence.viewers} />
            <Composer
              key={`composer-${conversationId}`}
              conversationId={conversationId}
              noteOnly
            />
          </>
        ) : (
          // #106: a notes-only member (viewer_level 'note') gets the note
          // composer — texting the customer needs level 'text' on this number.
          <>
            {/* #225: only when it is actually quiet where they are, and only
                for somebody who can text. A reply is never blocked — this
                exists so nobody finds out from an annoyed customer. */}
            {conversation.viewer_level === "text" && (
              <TheirTime clock={conversation.destination_clock} />
            )}
            {/* #244: above the scheduled strip, because this is the only
                thing on the screen with a clock running on it — somebody is
                waiting for a callback, and if nobody claims it the alert
                widens to the whole crew. Shown in BOTH composer branches for
                the same reason the strip above is: a notes-only member can
                still be the one who is awake.
                *Applying: Prioritize Intent — the core action first.* */}
            <AlertBanner
              conversationId={conversationId}
              alert={conversation.open_alert ?? null}
              viewerId={me.data?.user_id ?? null}
            />
            <ScheduledStrip conversationId={conversationId} />
            <PresenceStrip viewers={presence.viewers} />
            <Composer
              key={`composer-${conversationId}`}
              conversationId={conversationId}
              noteOnly={conversation.viewer_level === "note"}
              onTyping={presence.onTyping}
              contactLocale={contact.data?.locale ?? null}
              catchUp={{
                shown: catchUp.hintShown,
                onRecap: catchUp.ask,
                onNotNow: catchUp.notNow,
              }}
            />
          </>
        )}
      </div>

      {/* Desktop context drawer (PORTAL-UX §3.2: ~300px slide-in, hairline
          left border, no shadow; the calm floating layer). Auto-collapses below
          ~1100px to the header toggle so the thread keeps a comfortable measure. */}
      {(panelOpen || (taskId !== null && wide)) && (
        <aside
          aria-label={
            taskId !== null
              ? t("tasks.drawerTitle")
              : t("thread.conversationInfoForAria", {
                  name: contactDisplayName(conversation.contact),
                })
          }
          style={{ width: panelWidth }}
          className="relative hidden shrink-0 border-l border-app-line bg-app-paper xl:flex xl:flex-col"
        >
          <PanelResizeHandle
            width={panelWidth}
            widthRef={panelWidthRef}
            onResize={resizePanel}
            onCommit={setAndPersistPanelWidth}
          />
          {/* #742: the no-drag way to pick a width lives in the panel's own
              menu, never on the grip. The task drawer's close sits beside it. */}
          <div className="flex shrink-0 items-center justify-end gap-1 px-2 pt-2">
            <PanelOverflowMenu width={panelWidth} onCommit={setAndPersistPanelWidth} />
            {taskId !== null && (
              <button
                type="button"
                onClick={closeThreadTask}
                aria-label={t("common.close")}
                className="tap-target grid size-8 place-items-center rounded-full text-app-muted-2 transition-colors hover:bg-app-hover hover:text-app-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="size-4" strokeWidth={1.75} aria-hidden />
              </button>
            )}
          </div>
          <div className="min-h-0 flex-1">
            {taskId !== null ? (
              <div className="flex h-full min-h-0 flex-col">
                <div className="min-h-0 flex-1">
                  <TaskDetailPanel taskId={taskId} onClose={closeThreadTask} />
                </div>
              </div>
            ) : (
              <ContactPanel
                conversation={conversation}
                contact={contact.data}
                contactPending={contact.isPending}
                onOpenGallery={openGallery}
                active={panelOpen}
              />
            )}
          </div>
        </aside>
      )}

      {/* Mobile contact sheet (G6). */}
      <Sheet open={mobilePanelOpen} onOpenChange={setMobilePanelOpen}>
        <SheetContent
          side="bottom"
          // #119: the account sheet's anatomy — curved top corners, app card
          // surface; the contact header inside provides the visible title row.
          className="max-h-[85svh] overflow-y-auto rounded-t-2xl border-app-line bg-app-paper p-0 pb-[env(safe-area-inset-bottom)]"
          // #116: without this, Radix focuses the first tabbable on open — the
          // contact-name inline field — stamping a bright focus ring across
          // the identity card before the user has touched anything.
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          {/* The panel's own identity hero is the visible header now (#6), so
              the Sheet's title is sr-only — it still names the dialog for AT,
              without repeating the contact name a scroll above itself. */}
          <SheetHeader className="sr-only">
            <SheetTitle>
              {contactDisplayName(conversation.contact)}
            </SheetTitle>
            <SheetDescription>{t("thread.conversationInfo")}</SheetDescription>
          </SheetHeader>
          <ContactPanel
            conversation={conversation}
            contact={contact.data}
            contactPending={contact.isPending}
            onOpenGallery={openGallery}
            active={mobilePanelOpen}
            variant="sheet"
          />
        </SheetContent>
      </Sheet>

      {/* The attachments gallery (§5.2) — one surface, opened from the
          thread-header overflow or the panel's "View all attachments" row. */}
      <AttachmentsGallery
        conversationId={conversationId}
        open={galleryOpen}
        onOpenChange={setGalleryOpen}
        contactName={contactDisplayName(conversation.contact)}
      />
    </div>
  );
}
