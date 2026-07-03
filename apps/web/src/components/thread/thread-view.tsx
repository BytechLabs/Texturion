"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

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
import { parseThreadFilter, type ThreadFilter } from "./thread-filter";
import { ThreadHeader } from "./thread-header";

const PANEL_PREF_KEY = "jobtext:contact-panel-open";

function readPanelPref(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(PANEL_PREF_KEY) === "true";
  } catch {
    return false;
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

  // §5.1 in-thread filter — All | Messages | Notes | Events. URL is the state
  // (`?thread=`) for shareability; it defaults to All and does not persist.
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const threadFilter = parseThreadFilter(searchParams.get("thread"));
  const setThreadFilter = useCallback(
    (next: ThreadFilter) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next === "all") params.delete("thread");
      else params.set("thread", next);
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
  // §5.2: the attachments gallery has ONE entry point (the thread-header
  // overflow); the context panel's "View all attachments" row opens this same
  // surface. State lives here so both entry points share it.
  const [galleryOpen, setGalleryOpen] = useState(false);
  const openGallery = () => setGalleryOpen(true);
  const togglePanel = () => {
    const isDesktop =
      typeof window !== "undefined" &&
      window.matchMedia("(min-width: 768px)").matches;
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
      {/* The thread column carries a whisper of petrol wash over the raised stone
          (mockup .thread) so the timeline reads as a surface, not flat paper. */}
      <div className="flex h-full min-w-0 flex-1 flex-col bg-app-stone-1 [background-image:radial-gradient(700px_320px_at_60%_-10%,rgba(15,118,110,0.04),transparent_60%)]">
        <ThreadHeader
          conversation={conversation}
          contact={contact.data}
          onToggleContactPanel={togglePanel}
          panelOpen={panelOpen}
          onOpenGallery={openGallery}
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

      {/* Desktop contact panel (G3: 320px, toggled, persisted). */}
      {panelOpen && (
        <aside
          aria-label={`Contact details for ${contactDisplayName(conversation.contact)}`}
          className="hidden w-80 shrink-0 border-l border-app-line bg-app-stone-0 md:block"
        >
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
          <SheetHeader className="border-b border-border">
            <SheetTitle>
              {contactDisplayName(conversation.contact)}
            </SheetTitle>
            <SheetDescription className="sr-only">
              Contact details
            </SheetDescription>
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
