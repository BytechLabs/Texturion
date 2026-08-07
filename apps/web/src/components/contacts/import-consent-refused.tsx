"use client";

import { ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { triggerBlobDownload } from "@/lib/api/contacts-export";
import type { ImportResult } from "@/lib/api/types";
import {
  CONSENT_REFUSALS_FILENAME,
  consentRefusalsCsv,
  summarizeConsentRefusals,
} from "@/lib/contacts/import-summary";

/**
 * #248 — the rows an import brought in but could not attest for.
 *
 * The server writes a workspace's consent statement onto a contact only where
 * there is no basis yet AND nothing standing forbids it, so a file that says
 * "everyone here agreed" over somebody who has already texted STOP has its
 * attestation refused for that person. They are imported; their block stands;
 * the claim is not recorded against them. Saying nothing about that would make
 * the attestation a record with a hole in it that nobody was told about, which
 * is worse than no record — the reason it exists is to be pointed at later.
 *
 * ONE component with no per-door props, rendered by all three import dialogs.
 * The API answers the CSV route and the .vcf route with the same three fields
 * precisely so no client has to branch on which door it came through; a
 * component that cannot branch is the client-side half of that. The doors have
 * already drifted once — the .vcf route shipped with no consent question at all
 * while the CSV route refused every import for want of one.
 */
export function ImportConsentRefused({ result }: { result: ImportResult }) {
  const refusals = summarizeConsentRefusals(result);
  // Nothing refused is the ordinary case, and it gets no chrome: a callout that
  // renders empty-but-present would teach people to skip the one that matters.
  if (refusals.count === 0) return null;

  return (
    // Warning, not destructive. Nothing failed here — the import did exactly
    // what it should have — and dressing a correct outcome as an error is how a
    // person learns to dismiss the block without reading it. Same amber as the
    // wizard's "Imports, opted out" preview badge, which is this same fact one
    // screen earlier.
    <div className="rounded-lg border border-warning/40 bg-warning/5 px-4 py-3">
      <div className="flex items-start gap-3">
        {/* mt-0.5 optically centres the glyph on the heading's cap-height —
            flush with the line box it reads as sitting high. */}
        <ShieldAlert
          className="mt-0.5 size-5 shrink-0 text-warning"
          strokeWidth={1.75}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          {/* Heading and explanation are one thought, so they sit tight; the
              evidence and the action below are separate ones and are pushed
              away from them rather than every gap being the same. */}
          <div className="space-y-1">
            <p className="text-sm font-medium">
              Consent not recorded for{" "}
              <span className="tabular-nums">
                {refusals.count.toLocaleString()}
              </span>{" "}
              of these contacts
            </p>
            {/* The server's own sentence, printed rather than paraphrased. A
                second wording of a compliance fact is a second thing to keep
                true, and this one is quoted back to carriers. */}
            {refusals.note && (
              <p className="text-sm leading-snug text-muted-foreground">
                {refusals.note}
              </p>
            )}
          </div>
          {/* Rendered for a hidden count with NOTHING visible too. The overflow
              line lives inside this list, so gating the list on `visible` alone
              meant a response carrying the count without the rows printed the
              headline number over silence — the reader is left concluding the
              missing rows are the ones they cannot see. */}
          {(refusals.visible.length > 0 || refusals.hiddenCount > 0) && (
            <ul className="mt-3 max-h-40 space-y-1 overflow-y-auto rounded-md border bg-background/60 p-3 text-xs">
              {refusals.visible.map((refusal) => (
                <li key={`${refusal.row}-${refusal.reason}`}>
                  {refusal.reason}
                </li>
              ))}
              {refusals.hiddenCount > 0 && (
                <li className="text-muted-foreground">
                  …and {refusals.hiddenCount.toLocaleString()} more.
                </li>
              )}
            </ul>
          )}
          {/* The list is capped and the audit row keeps only the count, so this
              is the only complete answer to "which of them?" that outlives the
              tab. Secondary weight: reading the note is the point, the file is
              for the person who needs to act on it.

              Offered only when there is a row to put in it. A button promising
              the refused rows that hands back a header and nothing else is a
              worse answer than not offering the file. */}
          {(result.consent_refusals ?? []).length > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() =>
                triggerBlobDownload(
                  // Every refusal, not `visible` — the cap is a reading aid, and
                  // a download that stopped at fifty would be a quieter version
                  // of the silence this block exists to end.
                  new Blob(
                    [consentRefusalsCsv(result.consent_refusals ?? [])],
                    {
                      type: "text/csv;charset=utf-8",
                    },
                  ),
                  CONSENT_REFUSALS_FILENAME,
                )
              }
            >
              Download the refused rows
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
