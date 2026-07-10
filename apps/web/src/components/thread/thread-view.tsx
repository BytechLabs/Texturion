"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ContactPanel } from "@/components/contact-panel/contact-panel";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useCompany } from "@/lib/api/companies";
import { useContact } from "@/lib/api/contacts";
import {
  useConversation,
  useMarkConversationRead,
} from "@/lib/api/conversations";
import { ApiError } from "@/lib/api/error";
import { useMessages } from "@/lib/api/messages";
import type { ConversationDetail } from "@/lib/api/types";
import { useUsage } from "@/lib/api/usage";
import { contactDisplayName } from "@/lib/format/phone";

import { AttachmentsGallery } from "./attachments-gallery";
import {
  destinationCountry,
  selectComposerBanner,
  usSendApproved,
} from "./composer-banner";
import { ComposerBannerCard } from "./composer-banners";
import { Composer } from "./composer";
import { MessageList } from "./message-list";
import {
  parseThreadFilter,
  serializeThreadFilter,
  type ThreadFilter,
} from "./thread-filter";
import { ThreadHeader } from "./thread-header";

const PANEL_PREF_KEY = "loonext:contact-panel-open";

function readPanelPref(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(PANEL_PREF_KEY) === "true";
  } catch {
    return false;
  }
}

// Persisted contact-panel width (drag the panel's left edge to resize). Clamped
// so the thread column (min-w-0) is never crushed even at a 1280px viewport.
const PANEL_WIDTH_KEY = "loonext:contact-panel-width";
const PANEL_MIN_WIDTH = 260;
const PANEL_MAX_WIDTH = 560;
const PANEL_DEFAULT_WIDTH = 300;

function clampPanelWidth(px: number): number {
  return Math.min(PANEL_MAX_WIDTH, Math.max(PANEL_MIN_WIDTH, px));
}

function readPanelWidth(): number {
  if (typeof window === "undefined") return PANEL_DEFAULT_WIDTH;
  try {
    const raw = window.localStorage.getItem(PANEL_WIDTH_KEY);
    const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
    return Number.isFinite(parsed) ? clampPanelWidth(parsed) : PANEL_DEFAULT_WIDTH;
  } catch {
    return PANEL_DEFAULT_WIDTH;
  }
}

function persistPanelWidth(px: number): void {
  try {
    window.localStorage.setItem(PANEL_WIDTH_KEY, String(px));
  } catch {
    /* preference only — losing it is harmless. */
  }
}

/**
 * The G5 thread screen: header → virtualized timeline → composer (or the
 * banner replacing it) with the G6 contact panel on the right (persisted
 * toggle on desktop, bottom sheet on mobile). Skeleton on first load;
 * not_found and network errors are distinct, designed states.
 */
export function ThreadView({ conversationId }: { conversationId: string }) {
  const detail = useConversation(conversationId);

  if (detail.isPending) {
    return (
      <div className="flex h-full flex-col" aria-busy>
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <Skeleton className="size-8 rounded-full" />
          <div className="space-y-1.5">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-24" />
          </div>
        </div>
        <div className="flex-1 space-y-4 px-6 py-4" aria-hidden>
          <div className="flex justify-start">
            <Skeleton className="h-14 w-3/5 rounded-[10px]" />
          </div>
          <div className="flex justify-end">
            <Skeleton className="h-10 w-2/5 rounded-[10px]" />
          </div>
        </div>
        <div className="border-t border-border p-3">
          <Skeleton className="h-10 w-full rounded-md" />
        </div>
      </div>
    );
  }

  if (detail.isError) {
    const notFound =
      detail.error instanceof ApiError && detail.error.code === "not_found";
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-sm text-muted-foreground">
          {notFound
            ? "This conversation doesn't exist or was removed."
            : "We couldn't load this conversation."}
        </p>
        {notFound ? (
          <Button asChild variant="outline" size="sm">
            <Link href="/inbox">Back to inbox</Link>
          </Button>
        ) : (
          <Button variant="outline" size="sm" onClick={() => detail.refetch()}>
            Try again
          </Button>
        )}
      </div>
    );
  }

  return <ThreadLoaded conversation={detail.data} />;
}

function ThreadLoaded({ conversation }: { conversation: ConversationDetail }) {
  const conversationId = conversation.id;
  const contact = useContact(conversation.contact_id);
  const company = useCompany();
  const usage = useUsage();
  const messages = useMessages(conversationId);
  const markRead = useMarkConversationRead();

  // §5.1 in-thread filter — independent Messages · Notes · Events toggles (#89).
  // URL is the state (`?thread=` — a comma list of the enabled kinds) for
  // shareability; it defaults to all-on and does not persist.
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const threadFilter = parseThreadFilter(searchParams.get("thread"));
  const setThreadFilter = useCallback(
    (next: ThreadFilter) => {
      const params = new URLSearchParams(searchParams.toString());
      const serialized = serializeThreadFilter(next);
      if (serialized === null) params.delete("thread");
      else params.set("thread", serialized);
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, {
        scroll: false,
      });
    },
    [router, pathname, searchParams],
  );

  // Desktop panel preference persists (G3); mobile uses a bottom sheet.
  const [panelOpen, setPanelOpen] = useState(readPanelPref);
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false);
  // Panel width starts at the default (so server + first client paint agree),
  // then adopts the stored value on mount — avoids a hydration mismatch on the
  // inline style. A ref mirrors it so the drag handler reads the live width.
  const [panelWidth, setPanelWidth] = useState(PANEL_DEFAULT_WIDTH);
  useEffect(() => {
    setPanelWidth(readPanelWidth());
  }, []);
  const panelWidthRef = useRef(panelWidth);
  panelWidthRef.current = panelWidth;
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

  // Drag the panel's LEFT edge to resize; the final width persists on release.
  const startResize = useCallback((event: React.PointerEvent) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = panelWidthRef.current;
    let latest = startWidth;
    const onMove = (moveEvent: PointerEvent) => {
      // The handle sits on the left edge, so dragging left (clientX ↓) widens.
      latest = clampPanelWidth(startWidth + (startX - moveEvent.clientX));
      setPanelWidth(latest);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      persistPanelWidth(latest);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  // Opening a thread marks it read immediately (G4); re-mark as messages
  // arrive while viewing — inbound, a teammate's reply/note, or your own send
  // — so last_read_at stays current and the dot stays cleared for this user
  // on every device (G4: replying never re-flags the thread for you).
  const newestMessageId = useMemo(
    () => messages.data?.pages[0]?.data[0]?.id ?? null, // newest-first (SPEC §7)
    [messages.data],
  );
  const markReadMutate = markRead.mutate;
  useEffect(() => {
    markReadMutate(conversationId);
  }, [conversationId, newestMessageId, markReadMutate]);

  const banner =
    company.data && contact.data
      ? selectComposerBanner({
          contactOptedOut: contact.data.opted_out,
          subscriptionStatus: company.data.subscription_status,
          destinationCountry: destinationCountry(
            conversation.contact.phone_e164,
          ),
          usApproved: usSendApproved(company.data),
          usage: usage.data ?? null,
        })
      : null;

  return (
    <div className="flex h-full min-h-0">
      {/* The thread column: calm paper, structure by hairlines not wash. */}
      <div className="flex h-full min-w-0 flex-1 flex-col bg-app-stone-0">
        <ThreadHeader
          conversation={conversation}
          contact={contact.data}
          onToggleContactPanel={togglePanel}
          panelOpen={panelOpen}
          onOpenGallery={openGallery}
          filter={threadFilter}
          onFilterChange={setThreadFilter}
        />
        <MessageList
          key={conversationId}
          conversationId={conversationId}
          contact={conversation.contact}
          filter={threadFilter}
          onFilterChange={setThreadFilter}
        />
        {banner ? (
          <>
            <ComposerBannerCard banner={banner} />
            <Composer conversationId={conversationId} noteOnly />
          </>
        ) : (
          <Composer conversationId={conversationId} />
        )}
      </div>

      {/* Desktop context drawer (PORTAL-UX §3.2: ~300px slide-in, hairline
          left border, no shadow; the calm floating layer). Auto-collapses below
          ~1100px to the header toggle so the thread keeps a comfortable measure. */}
      {panelOpen && (
        <aside
          aria-label={`Contact details for ${contactDisplayName(conversation.contact)}`}
          style={{ width: panelWidth }}
          className="relative hidden shrink-0 border-l border-app-line bg-app-white xl:block"
        >
          {/* Left-edge resize handle. Drag to resize (persisted); double-click
              resets to the default; ←/→ nudge by 16px for keyboard users. */}
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize contact panel"
            tabIndex={0}
            onPointerDown={startResize}
            onDoubleClick={() => {
              setPanelWidth(PANEL_DEFAULT_WIDTH);
              persistPanelWidth(PANEL_DEFAULT_WIDTH);
            }}
            onKeyDown={(event) => {
              if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
              event.preventDefault();
              setPanelWidth((width) => {
                const next = clampPanelWidth(
                  width + (event.key === "ArrowLeft" ? 16 : -16),
                );
                persistPanelWidth(next);
                return next;
              });
            }}
            className="absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize touch-none select-none transition-colors hover:bg-app-tint-line focus-visible:bg-app-petrol/40 focus-visible:outline-none"
          />
          <ContactPanel
            conversation={conversation}
            contact={contact.data}
            contactPending={contact.isPending}
            onOpenGallery={openGallery}
            active={panelOpen}
          />
        </aside>
      )}

      {/* Mobile contact sheet (G6). */}
      <Sheet open={mobilePanelOpen} onOpenChange={setMobilePanelOpen}>
        <SheetContent side="bottom" className="max-h-[85svh] overflow-y-auto p-0">
          {/* The panel's own identity hero is the visible header now (#6), so
              the Sheet's title is sr-only — it still names the dialog for AT,
              without repeating the contact name a scroll above itself. */}
          <SheetHeader className="sr-only">
            <SheetTitle>
              {contactDisplayName(conversation.contact)}
            </SheetTitle>
            <SheetDescription>Contact details</SheetDescription>
          </SheetHeader>
          <ContactPanel
            conversation={conversation}
            contact={contact.data}
            contactPending={contact.isPending}
            onOpenGallery={openGallery}
            active={mobilePanelOpen}
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
