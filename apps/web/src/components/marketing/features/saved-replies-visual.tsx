/**
 * Saved-replies picker embed (features crew), /features/templates-and-tags.
 *
 * The app's template picker as the composer opens it (components/thread/
 * template-picker.tsx: a cmdk popover with a search field, name + body rows)
 * plus the two REAL merge variables the editor offers ({first_name},
 * {business_name}, settings/templates/template-dialog.tsx) and the preview
 * line showing what actually ships. The composer below has "/" typed, which
 * is what opened the picker (G5).
 *
 * Law 2: PRODUCT content, app tokens only; mount inside <PanelFrame>.
 * Server component, static DOM.
 */

import { CornerDownLeft, Search, Send } from "lucide-react";

import { cn } from "@/lib/utils";

interface Template {
  name: string;
  body: string;
}

/** The plumbing pack that pre-seeds a new plumbing workspace. */
const TEMPLATES: Template[] = [
  {
    name: "On my way",
    body: "Hi {first_name}, it's {business_name}. On my way, should be with you in about 20 minutes.",
  },
  {
    name: "Photo request",
    body: "Can you text us a photo of the problem, and one of the space around it?",
  },
  {
    name: "Quote follow-up",
    body: "Hi {first_name}, just checking you received our quote. Any questions, text us here.",
  },
  {
    name: "Job done",
    body: "All done. We've cleared the line and tested it. Text us if anything comes up.",
  },
];

export function SavedRepliesVisual({ className }: { className?: string }) {
  return (
    <div className={cn("p-4 sm:p-5", className)}>
      {/* Template picker popover, anchored above the composer. */}
      <div className="overflow-hidden rounded-app-card border border-app-line bg-popover shadow-[var(--app-sh-float)]">
        <div className="flex items-center gap-2 border-b border-app-line px-3 py-2.5 text-[13px] text-app-muted">
          <Search className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
          Search saved replies…
        </div>
        <div className="p-1">
          <p className="px-2 pb-1 pt-1.5 text-[11px] font-semibold text-app-muted-2">
            Saved replies
          </p>
          <ul>
            {TEMPLATES.map((template, i) => (
              <li
                key={template.name}
                className={cn(
                  "flex flex-col gap-0.5 rounded-app-ctrl px-2 py-1.5",
                  i === 0 && "bg-app-tint",
                )}
              >
                <span
                  className={cn(
                    "truncate text-[13.5px] font-medium",
                    i === 0 ? "text-app-petrol-deep" : "text-app-ink",
                  )}
                >
                  {template.name}
                </span>
                <span className="truncate text-[12px] text-app-muted">
                  {template.body}
                </span>
              </li>
            ))}
          </ul>
        </div>
        {/* The merge-variable preview: the saved body stores the raw {token};
            this line shows what actually ships at send time. */}
        <div className="border-t border-app-line-soft bg-app-stone-0 px-3 py-2">
          <p className="text-[11px] font-semibold text-app-muted-2">Preview</p>
          <p className="mt-0.5 text-[12.5px] leading-snug text-app-ink">
            Hi Karen, it&apos;s Reyes Plumbing. On my way, should be with you
            in about 20 minutes.
          </p>
        </div>
      </div>

      {/* Composer with the "/" that opened the picker. */}
      <div className="mt-2.5 flex items-center gap-2 rounded-app-card border border-app-line bg-app-white px-3 py-2.5">
        <span className="flex-1 text-[15px] text-app-ink">
          /
          {/* Static insertion bar: a staged moment, not a pulsing "typing
              now" ornament (Law 11: no fake liveness). */}
          <span
            className="ml-0.5 inline-block h-4 w-px bg-primary align-middle"
            aria-hidden
          />
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-app-ctrl bg-primary px-2.5 py-1.5 text-[12.5px] font-medium text-primary-foreground">
          <Send className="size-3.5" strokeWidth={1.75} aria-hidden />
          Send
          <CornerDownLeft className="size-3" strokeWidth={2} aria-hidden />
        </span>
      </div>
    </div>
  );
}
