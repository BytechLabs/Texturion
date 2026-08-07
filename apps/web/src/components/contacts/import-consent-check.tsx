"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

/**
 * The one question every bulk-contact door has to ask (#226 / #248).
 *
 * Three doors open onto the same upsert — the CSV wizard, a .vcf, and the
 * phone's own address book — and the answer they collect is the only record of
 * why a few thousand strangers may be texted by this business. It is written
 * once, here, because the alternative was what shipped: a server gate no client
 * could satisfy on two routes and no gate at all on the third.
 *
 * It is deliberately NOT pre-ticked. Everywhere else in this product an empty
 * control is a defect and a smart default is the fix, but a default answer to
 * "did these people agree?" is not a convenience, it is the product asserting
 * something on the customer's behalf that only they can know. The friction is
 * the feature.
 */

export type ImportConsentSource = "file" | "picked";

/**
 * What the person is putting their name to, phrased for the door they came
 * through — "this file" is a lie in front of the device picker, where there is
 * no file. It echoes the server's own refusal sentence
 * (CONTACT_IMPORT_CONSENT_REQUIRED) so somebody who manages to hit the gate
 * reads the same claim twice rather than two paraphrases of it.
 */
export const IMPORT_CONSENT_LABEL: Record<ImportConsentSource, string> = {
  file: "Everyone in this file agreed to be texted by this business.",
  picked: "Everyone I pick agreed to be texted by this business.",
};

/**
 * The three facts that make ticking the box an informed act rather than a
 * shrug. Each one answers a question people actually ask at this screen, and
 * each is true of the shipped import path — the middle one is carrier truth
 * (an active STOP survives any import), and the last one is what #248 changed:
 * a re-uploaded spreadsheet used to overwrite the recorded basis of contacts
 * who already had a stronger one.
 *
 * Three, not five. The reader is one click from a bulk write and will read a
 * short list; a long one is skipped entirely, which is worse than not printing
 * it.
 */
export const IMPORT_CONSENT_FACTS = [
  "Importing texts nobody.",
  "Anyone who has replied STOP stays blocked.",
  "Contacts who already have a consent record keep the one they have.",
] as const;

export function ImportConsentCheck({
  source,
  checked,
  onCheckedChange,
  disabled = false,
  id = "import-consent",
}: {
  source: ImportConsentSource;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
}) {
  return (
    <div className="rounded-lg border border-dashed bg-muted/40 px-3 py-3">
      <div className="flex items-start gap-3">
        {/* mt-[0.15rem]: the box is optically centred on the cap-height of the
            first line, not on its line box — mathematically flush with the top
            of the text block it reads as sitting slightly high. */}
        <Checkbox
          id={id}
          checked={checked}
          disabled={disabled}
          onCheckedChange={(next) => onCheckedChange(next === true)}
          className="mt-[0.15rem]"
        />
        <div className="space-y-2">
          <Label htmlFor={id} className="block text-sm leading-snug">
            {IMPORT_CONSENT_LABEL[source]}
          </Label>
          <ul className="space-y-1 text-xs leading-snug text-muted-foreground">
            {IMPORT_CONSENT_FACTS.map((fact) => (
              <li key={fact}>{fact}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
