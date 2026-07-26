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
          </li>
        );
      })}
    </ul>
  );
}
