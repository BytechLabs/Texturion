"use client";

import {
  ORIENTATION_STEPS,
  orientationProgress,
  shouldShowOrientation,
  type OrientationStep,
} from "@loonext/shared";
import { BellRing, Inbox, NotebookPen, Phone } from "lucide-react";
import { useState, type ComponentType } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  useJoiningNote,
  useMarkOriented,
  useMemberFirsts,
} from "@/lib/api/me-company";
import { useActiveCompany } from "@/lib/company/provider";
import { usePushSubscription } from "@/lib/push/use-push-subscription";
import { cn } from "@/lib/utils";

/**
 * #286 — what a new tech gets instead of nothing.
 *
 * "An invited member sees a short, skippable, member-specific orientation on
 * first sign-in."
 *
 * WHO THIS IS FOR, AND WHY IT IS NOT THE OWNER'S FLOW. The owner walked a
 * five-step wizard and chose this product. The tech had it chosen for them:
 * they are on a job site, on a phone, mildly annoyed, and their opinion in the
 * first ten minutes decides whether the crew adopts the tool or the owner ends
 * up as its only user. Every onboarding investment before this one — the setup
 * checklist, the progress display — was aimed at the other person.
 *
 * WHY FOUR SCREENS AND NOT A TOUR. Each one is a thing that differs from
 * texting off a personal cell, and getting one of them wrong is expensive
 * rather than merely confusing. Nothing here explains the interface; the
 * interface explains itself.
 *
 * *Applying: Chunking — one idea per screen, four screens, which is what a
 * person holds. Outcomes Over Features — every line is about what happens to
 * them, not what the product has.*
 *
 * WHY IT ENDS ON NOTIFICATIONS. #286's other loose Acceptance line is
 * "notification permission is requested with context, not cold", and joining
 * is the moment that context exists: they are walking into a workspace that
 * already has traffic, and the alternative is their phone ringing at 6am about
 * a customer they have never heard of. The browser prompt only ever follows a
 * deliberate tap (G8), so it fires from the button on the last screen — never
 * on mount.
 *
 * WHY SKIP IS ONE TAP, EVERYWHERE. It is skippable per the Acceptance line,
 * and a skip that comes back tomorrow is not one — the server records the
 * skip and the completion with the same call.
 * *Applying: the "No Onboarding" rule, honoured for the people who do not
 * want it — never a signup wall in front of value.*
 */

interface StepCopy {
  title: string;
  body: string;
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
}

/**
 * Web owns the wording; Android and iOS hand-port it, and
 * `packages/shared/src/member-orientation-copy.test.ts` reads all three files
 * so the ports cannot drift (the technique #476 established).
 */
const COPY: Record<OrientationStep, StepCopy> = {
  inbox: {
    title: "One inbox, the whole crew",
    body: "Every text your customers send lands here, and everyone on the crew can see it. Nothing sits unanswered in one person's phone.",
    icon: Inbox,
  },
  number: {
    title: "You answer as the business",
    body: "Your replies go out from the workspace's number, so customers never get your personal one. If a number isn't shared with you, Settings tells you which and why.",
    icon: Phone,
  },
  notes: {
    title: "Notes stay inside",
    body: "Switch the composer to Note and only the crew sees it — the customer never does. Mention a teammate in one and it lands on their For you.",
    icon: NotebookPen,
  },
  notifications: {
    title: "You choose when we buzz you",
    body: "You're joining a workspace that already has traffic. Turn on notifications for the work meant for you, and change them any time in Settings.",
    icon: BellRing,
  },
};

export function MemberOrientation() {
  const { role } = useActiveCompany();
  // The read the first-run card already makes. Asked only of roles the flow
  // could ever be for — "if the answer came back `not oriented`, would this
  // open?" — so the audience rule stays in one place instead of being spelled
  // a second way here, where it could disagree.
  const audience = shouldShowOrientation(role, false);
  const firsts = useMemberFirsts(audience);
  // Whether the four screens can open at all, which is also the only condition
  // under which a note has anywhere to appear. Asked on the role alone, this
  // read would fire on every shell load forever: somebody oriented months ago
  // would keep paying a round trip for a dialog that can no longer open.
  const showing = shouldShowOrientation(role, firsts.data?.oriented);
  const joining = useJoiningNote(showing);
  const markOriented = useMarkOriented();
  const [index, setIndex] = useState(0);
  const [closed, setClosed] = useState(false);

  if (closed || !showing) {
    return null;
  }

  function finish() {
    // Closed first, marked behind it. A failed write costs somebody a repeat
    // on their next sign-in; blocking the close on a network call would cost
    // them the app.
    setClosed(true);
    markOriented.mutate();
  }

  const step = ORIENTATION_STEPS[index];
  const copy = COPY[step];
  const Icon = copy.icon;
  const last = index === ORIENTATION_STEPS.length - 1;

  return (
    <Dialog open onOpenChange={(open) => !open && finish()}>
      <DialogContent
        className="max-w-md gap-0 p-0"
        // Nothing behind this is lost by closing it, so the X is enough of an
        // exit; a confirmation would be friction spent on the wrong thing.
        aria-describedby={undefined}
      >
        <ProgressRail index={index} />
        <div className="space-y-4 px-6 pb-6 pt-5">
          {/* Drawn when it lands, never waited on. Almost nobody has a note, so
              holding the orientation shut behind a request about one would make
              every member pay for the rare case, and a slow or failing call
              would hold it shut through its retries. Screen one only: past
              Next, somebody has moved on from the introduction it belongs to. */}
          {index === 0 && joining.data?.note && (
            <JoiningNote note={joining.data.note} from={joining.data.from} />
          )}
          <div className="flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Icon className="size-5" strokeWidth={1.75} />
          </div>
          <div className="space-y-2">
            <DialogTitle className="text-xl">{copy.title}</DialogTitle>
            <DialogDescription className="text-base leading-relaxed">
              {copy.body}
            </DialogDescription>
          </div>
          {last ? (
            <NotificationStep onDone={finish} />
          ) : (
            <div className="flex items-center justify-between pt-1">
              <Button variant="ghost" onClick={finish}>
                Skip
              </Button>
              <Button onClick={() => setIndex(index + 1)}>Next</Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * #521: the owner's words, before ours.
 *
 * The four screens below explain the PRODUCT. They cannot say what THIS crew
 * expects of this person, which is the thing a new member would otherwise
 * spend their first morning asking a colleague. So whoever added them gets the
 * first word on the first screen, verbatim and unframed: a heading of ours
 * above it would turn somebody's sentence into a product feature.
 *
 * The attribution sits ABOVE the quote and reads "{name} says", or "They said"
 * when the name could not be resolved. Both are the construction
 * `sendExistingAccountInvite` (apps/api/src/routes/team.ts) signs the same note
 * with, so a member who gets the mail and then opens the app reads one sentence
 * twice instead of two attempts at it. Below the quote it would come too late:
 * by then they have already read somebody's words as ours.
 *
 * The quote scrolls past roughly six lines instead of growing. This dialog is
 * centred rather than scrolled, so a long note that pushed the buttons past the
 * bottom of a phone would strand somebody on screen one.
 *
 * *Applying: Relationship Strength. A different voice gets its own surface,
 * not another paragraph in ours, and the byline is bound tight to the words it
 * belongs to. Padding is optically corrected, not symmetrical: the left rule
 * carries visual weight the right edge does not.*
 */
function JoiningNote({ note, from }: { note: string; from: string | null }) {
  return (
    <figure className="space-y-1.5 rounded-lg border-l-2 border-primary bg-muted/50 py-3 pl-4 pr-3">
      <figcaption className="text-sm text-muted-foreground">
        {from ? `${from} says` : "They said"}
      </figcaption>
      <blockquote className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words text-base leading-relaxed">
        {note}
      </blockquote>
    </figure>
  );
}

/**
 * Four segments, the current one filled — and the first one is filled the
 * moment this opens. Somebody on screen one accepted an invite, signed in and
 * opened the app; a bar that starts empty says otherwise.
 *
 * *Applying: Goal Gradient Effect.*
 */
function ProgressRail({ index }: { index: number }) {
  const filled = orientationProgress(index) * ORIENTATION_STEPS.length;
  return (
    <div
      className="flex gap-1 px-6 pt-6"
      role="progressbar"
      aria-valuenow={index + 1}
      aria-valuemin={1}
      aria-valuemax={ORIENTATION_STEPS.length}
      aria-label={`Step ${index + 1} of ${ORIENTATION_STEPS.length}`}
    >
      {ORIENTATION_STEPS.map((step, position) => (
        <span
          key={step}
          className={cn(
            "h-1 flex-1 rounded-full transition-colors",
            position < filled ? "bg-primary" : "bg-muted",
          )}
        />
      ))}
    </div>
  );
}

/**
 * The last screen's actions. The browser permission prompt is triggered here
 * and nowhere near a mount (G8), which is what makes it the opposite of the
 * cold ask #286 objects to: by this point they have read what it is for.
 *
 * A browser that cannot do push, or has already been answered, gets a single
 * button out — asking again is either impossible or rude.
 */
export function NotificationStep({ onDone }: { onDone: () => void }) {
  const push = usePushSubscription();
  const askable =
    push.supported && push.permission === "default" && !push.subscribed;

  async function enable() {
    // Their answer to the browser is theirs. Either way the flow is over —
    // re-asking somebody who just said no is how an app gets muted for good.
    await push.subscribe().catch(() => {});
    onDone();
  }

  return (
    <div className="space-y-3 pt-1">
      {push.error && (
        <p className="text-sm text-destructive" role="alert">
          {push.error}
        </p>
      )}
      <div className="flex items-center justify-between">
        {askable ? (
          <>
            <Button variant="ghost" onClick={onDone}>
              Not now
            </Button>
            <Button onClick={enable} disabled={push.pending}>
              {push.pending ? "Turning on…" : "Turn on notifications"}
            </Button>
          </>
        ) : (
          <Button className="ml-auto" onClick={onDone}>
            Start working
          </Button>
        )}
      </div>
    </div>
  );
}
