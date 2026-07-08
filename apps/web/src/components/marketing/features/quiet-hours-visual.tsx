/**
 * Quiet-hours dialog embed (features crew), /features/compliance.
 *
 * The app's real quiet-hours confirm (components/inbox/new-conversation.tsx,
 * driven by the API's 409): when you START a new conversation between 8pm
 * and 8am in the customer's local time, the dialog asks first. Title and
 * buttons match the product verbatim ("It's 9:14 PM for this customer." /
 * "Send anyway?" / Wait / Send). It's a nudge, not a hard block, and it
 * never fires on replies.
 *
 * Law 2: PRODUCT content, app tokens only; mount inside <PanelFrame>.
 * Server component, static DOM.
 */

import { cn } from "@/lib/utils";

export function QuietHoursVisual({ className }: { className?: string }) {
  return (
    <div className={cn("p-4 sm:p-6", className)}>
      <div className="mx-auto max-w-sm rounded-app-card border border-app-line bg-popover p-5 shadow-[var(--app-sh-float)]">
        <p className="text-[15px] font-semibold text-app-ink">
          It&apos;s 9:14 PM for this customer.
        </p>
        <p className="mt-1 text-[13.5px] leading-relaxed text-app-muted">
          Send anyway?
        </p>

        <div className="mt-5 flex justify-end gap-2">
          <span className="rounded-app-ctrl border border-app-line bg-app-white px-4 py-2 text-center text-[13.5px] font-medium text-app-ink">
            Wait
          </span>
          <span className="rounded-app-ctrl bg-primary px-4 py-2 text-center text-[13.5px] font-medium text-primary-foreground">
            Send
          </span>
        </div>
      </div>

      <p className="mx-auto mt-4 max-w-sm text-center text-[12px] leading-relaxed text-app-muted">
        Only when you start a late-night conversation. Replies are never held
        up.
      </p>
    </div>
  );
}
