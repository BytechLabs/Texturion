/**
 * Registration-stepper embed (features crew), the /features/compliance hero
 * visual: the app's registration state machine (SPEC §4.4, brand → campaign
 * → approved) in its real "In review" state, so the honest US timeline is a
 * designed object: what's already done, what the carriers are reviewing, and
 * what turns on at the end.
 *
 * Law 2: PRODUCT content, app tokens only (bg-primary done nodes, the app's
 * calm amber for the in-review state, app-line/app-muted structure). Mount
 * inside <PanelFrame> for the `.app-scope` token region. Never cobalt.
 *
 * Server component, pure DOM. Wording per Law 6: "3 to 7 business days".
 */

import { Check, Clock } from "lucide-react";

import { cn } from "@/lib/utils";

type StepState = "done" | "active" | "upcoming";

interface Step {
  title: string;
  detail: string;
  state: StepState;
}

const STEPS: Step[] = [
  {
    title: "Business registered with the phone companies",
    detail: "Legal name, address, and EIN submitted the minute you paid.",
    state: "done",
  },
  {
    title: "Carrier review, in progress",
    detail: "Typically 3 to 7 business days. Nothing for you to do.",
    state: "active",
  },
  {
    title: "US texting turns on",
    detail: "We email you the moment it's approved.",
    state: "upcoming",
  },
];

function StepDot({ state }: { state: StepState }) {
  if (state === "done") {
    return (
      <span
        className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"
        aria-hidden
      >
        <Check className="size-4" strokeWidth={2.5} />
      </span>
    );
  }
  if (state === "active") {
    return (
      <span
        className="flex size-7 shrink-0 items-center justify-center rounded-full border border-app-amber-line bg-app-amber-bg text-app-amber-ink"
        aria-hidden
      >
        <Clock className="size-4" strokeWidth={2} />
      </span>
    );
  }
  return (
    <span
      className="flex size-7 shrink-0 items-center justify-center rounded-full border border-app-line bg-app-stone-1 text-app-muted-2"
      aria-hidden
    >
      <span className="size-1.5 rounded-full bg-current" />
    </span>
  );
}

export function RegistrationStepperVisual({
  className,
}: {
  className?: string;
}) {
  return (
    <div className={cn("p-4 sm:p-5", className)}>
      <div className="rounded-app-card border border-app-line bg-app-white p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[14px] font-semibold text-app-ink">
            US texting registration
          </p>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-app-amber-line bg-app-amber-bg px-2.5 py-1 text-[12px] font-medium text-app-amber-ink">
            <Clock className="size-3.5" strokeWidth={1.75} aria-hidden />
            In review
          </span>
        </div>

        <ol className="mt-5 space-y-0">
          {STEPS.map((step, i) => (
            <li key={step.title} className="flex gap-3.5">
              <div className="flex flex-col items-center">
                <StepDot state={step.state} />
                {i < STEPS.length - 1 && (
                  <span
                    className={cn(
                      "my-1 w-px flex-1",
                      step.state === "done"
                        ? "bg-app-tint-line"
                        : "bg-app-line",
                    )}
                    aria-hidden
                  />
                )}
              </div>
              <div className={cn(i < STEPS.length - 1 && "pb-4")}>
                <p
                  className={cn(
                    "text-[14px] font-semibold",
                    step.state === "upcoming" ? "text-app-muted" : "text-app-ink",
                  )}
                >
                  {step.title}
                </p>
                <p className="mt-0.5 text-[13px] leading-relaxed text-app-muted">
                  {step.detail}
                </p>
              </div>
            </li>
          ))}
        </ol>

        <p className="mt-2 rounded-app-ctrl bg-app-stone-1 px-3 py-2 text-[13px] leading-relaxed text-app-muted">
          Receiving texts already works while you wait. Approval gates only
          your outbound texting.
        </p>
      </div>
    </div>
  );
}
