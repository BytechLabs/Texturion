/**
 * Call embed (features crew), the /features/calls product visual: the ringing
 * card the whole crew sees, above the voicemail it becomes when nobody picks
 * up (#491).
 *
 * WHY BOTH HALVES IN ONE VISUAL. The page has to answer one objection — "so it
 * is a texting app that also dials out" — and the answer is the pair. A crew
 * ringing together is the feature; the voicemail written down underneath is
 * what happens on the call they were all on a roof for. Showing only the
 * dialer would have illustrated the thing buyers already assumed.
 *
 * Law 2 (DESIGN-DIRECTION v4): this is PRODUCT content, so every colour is an
 * APP token (bg-primary, app-tint, app-line, app-muted…), and it must be
 * mounted inside <PanelFrame>, which provides the `.app-scope` token region.
 * Marketing cobalt never appears here. D100: a colour is a fill OR a label,
 * never both — the answer pill's green is a fill with its own on-token, and
 * nothing in here spells a hex.
 *
 * Server component, pure DOM, no interactivity. Reyes Plumbing seed data in
 * the 555-01XX safe fictional range.
 */

import { Mic, Phone, PhoneOff, Voicemail } from "lucide-react";

import { cn } from "@/lib/utils";

/** The crew, so "everyone's phone is ringing" is shown rather than claimed. */
const RINGING_WITH = ["PR", "DK", "MO"];

function RingingCard() {
  return (
    <div className="rounded-app-card border border-app-line bg-app-paper p-[13px] shadow-[var(--app-sh-float)]">
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-app-muted-2">
        Incoming call
      </p>

      <div className="mt-2 flex items-center gap-[11px]">
        <span
          aria-hidden
          className="grid size-[38px] shrink-0 place-items-center rounded-xl bg-app-tint text-[13px] font-semibold text-app-olive-deep"
        >
          KM
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-semibold text-app-ink">
            Karen Mullins
          </span>
          {/* Caller ID name is a real feature both directions, so the number
              line names WHICH business line it came in on — the detail that
              makes a second number mean something. */}
          <span className="block truncate text-[12px] tabular-nums text-app-muted">
            (555) 0134 · to your shop line
          </span>
        </span>
      </div>

      {/* The whole point: it is not one person's phone. */}
      <div className="mt-2.5 flex items-center gap-1.5">
        {/* -space-x-1 rather than -1.5: at 19px the tighter overlap clipped
            each pair of initials into an unreadable smear (PR DK MO read as
            "PF DI MO" on the first render check). */}
        <span className="flex -space-x-1" aria-hidden>
          {RINGING_WITH.map((initials) => (
            <span
              key={initials}
              className="grid size-[21px] place-items-center rounded-full border border-app-paper bg-app-ground text-[10px] font-semibold leading-none text-app-muted"
            >
              {initials}
            </span>
          ))}
        </span>
        <span className="text-[11.5px] text-app-muted">
          Ringing all three · whoever answers first takes it
        </span>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <span className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-app-ctrl bg-primary px-3 py-2 text-[13px] font-semibold text-primary-foreground">
          <Phone className="size-3.5" strokeWidth={2.25} aria-hidden />
          Answer
        </span>
        <span className="inline-flex items-center justify-center gap-1.5 rounded-app-ctrl border border-app-line px-3 py-2 text-[13px] font-medium text-app-muted">
          <PhoneOff className="size-3.5" strokeWidth={2} aria-hidden />
          Decline
        </span>
      </div>
    </div>
  );
}

/**
 * The call nobody could take. The transcript is the load-bearing part: a
 * voicemail you can read is a voicemail that gets handled between jobs.
 */
function VoicemailCard() {
  return (
    <div className="rounded-app-card border border-app-line p-[13px]">
      <div className="flex items-center gap-2">
        <Voicemail
          className="size-3.5 shrink-0 text-app-muted-2"
          strokeWidth={1.75}
          aria-hidden
        />
        <span className="text-[12.5px] font-semibold text-app-ink">
          Voicemail from Ray Delgado
        </span>
        <span className="ml-auto shrink-0 text-[11.5px] tabular-nums text-app-muted-2">
          8:52 pm
        </span>
      </div>

      {/* The scrubber, quoted from the real player rather than invented. */}
      <div className="mt-2.5 flex items-center gap-2">
        <span
          aria-hidden
          className="grid size-7 shrink-0 place-items-center rounded-full bg-app-tint text-app-olive-deep"
        >
          <Mic className="size-3.5" strokeWidth={2} />
        </span>
        <span aria-hidden className="h-1 flex-1 rounded-full bg-app-ground">
          <span className="block h-1 w-1/3 rounded-full bg-app-olive-deep" />
        </span>
        <span className="shrink-0 text-[11px] tabular-nums text-app-muted-2">
          0:31
        </span>
      </div>

      <p className="mt-2.5 text-[12.5px] leading-[1.5] text-app-muted">
        &ldquo;Hi, it&rsquo;s Ray over on Bishop Street. My hot water&rsquo;s
        gone completely and I&rsquo;ve got family in Friday. Any chance
        somebody could come out Thursday? Same number back, thanks.&rdquo;
      </p>

      <p className="mt-2.5 text-[11.5px] text-app-muted-2">
        Written down automatically · texted back: &ldquo;Sorry we missed you,
        we&rsquo;ll call first thing.&rdquo;
      </p>
    </div>
  );
}

export function CallVisual({ className }: { className?: string }) {
  return (
    <div className={cn("space-y-2.5 p-3 sm:p-4", className)}>
      <RingingCard />
      <VoicemailCard />
    </div>
  );
}
