/**
 * Consent-record embed (features crew), /features/compliance + /canada.
 *
 * The app's consent records as they actually live on contacts
 * (components/contact-panel/contact-panel.tsx consentLine, SPEC §5): a
 * customer who texted first is recorded automatically ("Texted you first"),
 * and starting a new outbound conversation stamps the attestation with the
 * sender's name and the date ("Consent recorded by Dale"). Consent isn't a
 * vibe, it's a row with a name and a date.
 *
 * Law 2: PRODUCT content, app tokens only; mount inside <PanelFrame>.
 * Server component, static DOM, 555-01XX safe fictional numbers.
 */

import { MessageSquareText, ShieldCheck } from "lucide-react";

import { cn } from "@/lib/utils";

const RECORDS: {
  name: string;
  phone: string;
  line: string;
  detail: string;
  icon: typeof ShieldCheck;
}[] = [
  {
    name: "Karen M",
    phone: "(416) 555-0187",
    line: "Texted you first · Jun 12",
    detail: "Recorded automatically when her first text arrived.",
    icon: MessageSquareText,
  },
  {
    name: "Nguyen family",
    phone: "(647) 555-0143",
    line: "Consent recorded by Priya · Jul 2",
    detail: "Stamped when Priya started the conversation.",
    icon: ShieldCheck,
  },
];

export function ConsentVisual({ className }: { className?: string }) {
  return (
    <div className={cn("space-y-3 p-4 sm:p-5", className)}>
      {RECORDS.map((record) => {
        const Icon = record.icon;
        return (
          <div
            key={record.name}
            className="rounded-app-card border border-app-line bg-app-white p-4"
          >
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-[14px] font-semibold text-app-ink">
                {record.name}
              </p>
              <p className="text-[12px] tabular-nums text-app-muted-2">
                {record.phone}
              </p>
            </div>
            <div className="mt-2.5 flex items-start gap-2.5">
              <span
                className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-app-tint text-app-petrol-deep"
                aria-hidden
              >
                <Icon className="size-3.5" strokeWidth={1.75} />
              </span>
              <p className="text-[13px] leading-snug text-app-ink">
                {record.line}
                <span className="mt-0.5 block text-[12px] text-app-muted">
                  {record.detail}
                </span>
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
