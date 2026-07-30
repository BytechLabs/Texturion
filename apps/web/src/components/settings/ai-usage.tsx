import type { AiFeatureUsage } from "@/lib/api/types";

/**
 * What Lou has done this month, per feature.
 *
 * These caps were enforced server-side and shown nowhere: a crew reached one
 * mid-sentence, got a failure for that one feature, and had no way to have seen
 * it coming or to check afterwards. Every other cost centre on this screen
 * answers "where do I stand"; this one did not.
 *
 * Unlike messages, an AI cap is a HARD stop rather than a fair-use line, so
 * each feature shows a real proportion of a real ceiling. A feature nobody has
 * used still gets a row: an empty section reads as "this does not exist".
 *
 * #431 ask 3 — WHAT IT BOUGHT, under what it cost. The bar was a spend meter
 * with nothing to weigh against it: 400 of 1,500 drafts is cheap or expensive
 * entirely depending on whether they got sent, and that was unknowable. So each
 * row now carries what people did with the output, in that feature's own words.
 * *Applying: Meaningful Highlights & Context — never show a number without the
 * insight it supports.*
 *
 * NO PERCENTAGE, deliberately. The denominators do not match (a draft offered
 * and never read is a request with no outcome), and one blessed ratio here would
 * quietly become the definition of the keep-or-kill threshold that D81 says must
 * be chosen before the data arrives. Counts in order carry the shape without
 * pretending to a precision they do not have.
 */
export function AiUsage({ features }: { features: AiFeatureUsage[] }) {
  if (features.length === 0) return null;

  return (
    <ul className="space-y-3">
      {features.map((feature) => {
        const pct =
          feature.cap > 0
            ? Math.min(100, Math.round((feature.used / feature.cap) * 100))
            : 0;
        // Say the number is spent BEFORE it bites, in the same place the number
        // lives, rather than only at the moment something fails.
        const nearCap = feature.enabled && pct >= 80;
        return (
          <li key={feature.key}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm text-foreground first-letter:uppercase">
                {feature.label}
              </span>
              <span className="shrink-0 text-[13px] tabular-nums text-muted-foreground">
                {feature.enabled ? (
                  <>
                    {feature.used.toLocaleString()} of{" "}
                    {feature.cap.toLocaleString()}
                  </>
                ) : (
                  "Off"
                )}
              </span>
            </div>
            <div
              className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-app-line-soft"
              role="img"
              aria-label={
                feature.enabled
                  ? `${feature.label}: ${feature.used} of ${feature.cap} used this month`
                  : `${feature.label}: turned off`
              }
            >
              <div
                className={
                  nearCap
                    ? "h-full rounded-full bg-app-amber"
                    : "h-full rounded-full bg-app-petrol"
                }
                style={{ width: `${feature.enabled ? pct : 0}%` }}
              />
            </div>
            {nearCap && (
              <p className="mt-1 text-[12px] text-app-amber-ink">
                Close to this month&rsquo;s limit. It resets on the 1st.
              </p>
            )}
            {/* An empty list is NOT three zeroes. A feature used 40 times with
                nothing recorded is an instrumentation gap, and "0 sent as
                written" would report that gap as a verdict on the quality. */}
            {feature.enabled && feature.outcomesRecorded > 0 ? (
              <p className="mt-1 text-[12px] text-muted-foreground">
                {feature.outcomes.map((outcome, index) => (
                  <span key={outcome.label}>
                    {index > 0 && <span aria-hidden> · </span>}
                    <span className="tabular-nums">
                      {outcome.count.toLocaleString()}
                    </span>{" "}
                    {outcome.label}
                  </span>
                ))}
              </p>
            ) : feature.enabled && feature.used > 0 ? (
              <p className="mt-1 text-[12px] text-muted-foreground">
                Nothing recorded yet about whether these got used.
              </p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
