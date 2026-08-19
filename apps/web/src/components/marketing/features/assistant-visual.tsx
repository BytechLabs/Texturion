/**
 * Assistant embed (features crew), the /features/assistant product visual: a
 * reply Lou has drafted, sitting in the composer, waiting for a person (#491).
 *
 * WHAT THE VISUAL HAS TO PROVE is the page's whole claim — that this is a
 * SUGGESTION, not an action. So the draft is shown where it actually lives,
 * inside the composer with a Send button nobody has pressed, above the line
 * that says a person always sends. A screenshot of a sent message would have
 * illustrated the opposite of the product.
 *
 * Law 2 (DESIGN-DIRECTION v4): PRODUCT content, so every colour is an APP
 * token and it must be mounted inside <PanelFrame>. Marketing cobalt never
 * appears here.
 *
 * Server component, pure DOM, no interactivity. Reyes Plumbing seed data in
 * the 555-01XX safe fictional range.
 */

import { assistantCopy, type AssistantCopy } from "@/i18n/marketing/assistant";
import type { MarketingLocale } from "@/i18n/marketing/footer";
import { Send, Sparkle } from "lucide-react";

import { cn } from "@/lib/utils";

/** The customer text Lou is answering, so the draft has something to be about. */
function IncomingBubble({ copy }: { copy: AssistantCopy }) {
  return (
    <div className="flex justify-start">
      {/* A border as well as the fill: inside the dark PanelFrame `app-ground`
          sits close enough to the panel that the bubble stopped reading as a
          message at all on the first render check. */}
      <div className="max-w-[80%] rounded-2xl rounded-bl-md border border-app-line bg-app-ground px-3 py-2">
        <p className="text-[13px] leading-[1.5] text-app-ink">
          {copy.visualIncoming}
        </p>
      </div>
    </div>
  );
}

export function AssistantVisual({
  className,
  locale = "en",
}: {
  className?: string;
  locale?: MarketingLocale;
}) {
  const copy = assistantCopy(locale);
  return (
    <div className={cn("space-y-3 p-3 sm:p-4", className)}>
      <IncomingBubble copy={copy} />

      {/* The composer, with Lou's draft in it and nothing sent. */}
      <div className="rounded-app-card border border-app-line bg-app-paper p-[11px]">
        <div className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="grid size-[18px] place-items-center rounded-full bg-app-tint text-app-olive-deep"
          >
            <Sparkle className="size-2.5" strokeWidth={2.5} />
          </span>
          <span className="text-[11px] font-semibold uppercase tracking-[0.07em] text-app-muted-2">
            {copy.visualDraftedBy}
          </span>
          <span className="ml-auto text-[11px] text-app-muted-2">
            {copy.visualEditFirst}
          </span>
        </div>

        <p className="mt-2 text-[13px] leading-[1.55] text-app-ink">
          {copy.visualDraft}
        </p>

        <div className="mt-2.5 flex items-center gap-2">
          <span className="flex-1 text-[11.5px] text-app-muted-2">
            {copy.visualNotSent}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-app-ctrl bg-primary px-3 py-1.5 text-[12.5px] font-semibold text-primary-foreground">
            <Send className="size-3" strokeWidth={2.25} aria-hidden />
            {copy.visualSend}
          </span>
        </div>
      </div>

      {/* The second output, so the page is not read as copy.visualBadge. */}
      <div className="rounded-app-card border border-app-line p-[11px]">
        <p className="text-[11px] font-semibold uppercase tracking-[0.07em] text-app-muted-2">
          {copy.visualTaskLabel}
        </p>
        <p className="mt-1.5 text-[13px] font-medium text-app-ink">
          {copy.visualTaskTitle}
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-[5px]">
          <span className="inline-flex items-center rounded-full border border-app-tint-line bg-app-tint px-2 py-[2.5px] text-[11px] font-semibold leading-none text-app-olive-deep">
            {copy.visualAddressChip}
          </span>
          <span className="inline-flex items-center rounded-full border border-app-line bg-app-ground px-2 py-[2.5px] text-[11px] font-semibold leading-none text-app-muted">
            {copy.visualTaskDue}
          </span>
        </div>
      </div>
    </div>
  );
}
