"use client";

import { useState } from "react";
import { toast } from "sonner";

import { SettingsCard } from "@/components/settings/section";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLocale, useT } from "@/i18n/provider";
import {
  useCompany,
  useRotateWidgetKey,
  useUpdateCompany,
  useWidgetKey,
} from "@/lib/api/companies";
import { useNumbers } from "@/lib/api/numbers";
import { formatPhone } from "@/lib/format/phone";
import { widgetSnippet } from "@/lib/marketing/widget-snippet";

/**
 * #232 — the snippet an owner pastes into their own website.
 *
 * ## What this screen is for, in one sentence
 *
 * Getting one line of markup onto a WordPress site, by somebody who has never
 * opened a code editor. Everything below follows from that.
 *
 * - **The snippet is the hero, and it is READY.** No fields to fill in, no
 *   options to choose before it works: the key is already in it, and the only
 *   action is Copy. *Applying: Smart Defaults — never an empty form — and
 *   Prioritise Intent, which says build the layout around the core action
 *   before anything decorative.*
 *
 * - **The instructions are three steps, not a paragraph.** The brain holds
 *   three or four things; "copy this, paste it before </body>, save" is a
 *   checklist somebody can follow while looking at another browser tab.
 *   *Applying: Chunking.*
 *
 * - **Rotate is deliberately hard to reach and honest about what it does.** It
 *   is behind a confirm because it is destructive in a way nothing else on this
 *   page is: every embed of the old key stops working the moment it lands, and
 *   somebody who has forgotten they installed the widget on two sites would
 *   break one without noticing. *Applying: Ethical Friction — a deliberate
 *   pause on a high-stakes action.*
 *
 * - **It is only fetched when the card is opened.** The key is not on the
 *   company view every member loads at startup; asking for it is the act of
 *   installing a widget.
 *
 * - **The line picker only appears when there is a line to pick.** A workspace
 *   with one number is never asked, because a select with one option is a
 *   decision that does not exist dressed up as one. *Applying: Zen of Clarity
 *   — the primary view stays about the one action this card exists for.*
 */
/**
 * The select's value for "not chosen".
 *
 * A sentinel rather than the empty string, which Radix reads as no selection at
 * all and answers with the placeholder — so the default state would render as a
 * blank box instead of naming the line it is actually using.
 */
const DEFAULT_LINE = "default";

export function WebsiteWidgetCard({ appOrigin }: { appOrigin: string }) {
  const t = useT();
  const { locale } = useLocale();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const key = useWidgetKey(open);
  const rotate = useRotateWidgetKey();
  const company = useCompany();
  const numbers = useNumbers();
  const updateCompany = useUpdateCompany();

  // Only the lines that can actually receive. A suspended or released number in
  // this list would be an offer to point the website at something that cannot
  // answer — and the server falls back past it anyway, so the picker would be
  // showing a choice that silently does not hold.
  // `number_e164` is nullable on a row still being provisioned, and a select
  // option with no label is an option nobody can choose on purpose.
  const routable = (numbers.data?.data ?? []).filter(
    (n) => n.status === "active" && n.number_e164,
  );
  const chosen = company.data?.widget_number_id ?? DEFAULT_LINE;

  const snippet =
    key.data === undefined ? "" : widgetSnippet(appOrigin, key.data.widget_key, company.data?.locale ?? undefined);

  async function copy() {
    try {
      await navigator.clipboard.writeText(snippet);
      toast.success(t("settings.widgetCopied"));
    } catch {
      // A clipboard write can be refused by permission or by a browser that
      // will not do it outside a user gesture it recognises. The snippet is
      // on screen and selectable, so the honest answer is to say the copy did
      // not happen rather than to claim it did.
      toast.error(t("settings.widgetCopyFailed"));
    }
  }

  return (
    <SettingsCard
      title={t("settings.widgetTitle")}
      description={t("settings.widgetBlurb")}
    >
      {!open ? (
        <Button variant="outline" onClick={() => setOpen(true)}>
          {t("settings.widgetShow")}
        </Button>
      ) : key.isPending ? (
        <p className="text-sm text-muted-foreground">{t("shell.loading")}</p>
      ) : key.isError ? (
        <p className="text-sm text-destructive">{t("settings.widgetLoadFailed")}</p>
      ) : (
        <div className="space-y-4">
          {/* #232 build item 1: "copy-paste from Settings with a LIVE
              preview". It loads the same widget.js that is about to be pasted,
              so this is the thing itself rather than a picture of it that goes
              stale the first time somebody changes a colour.

              ABOVE the instructions, because seeing what you are about to
              install is what makes the three steps worth reading. *Applying:
              Outcomes Over Features — show the result before the procedure.*

              `loading="lazy"` so a card nobody opens costs nothing, and a
              title because an unlabelled frame is a landmark a screen reader
              announces as nothing at all. */}
          <iframe
            // The reader's language, so a French settings page does not
            // frame an English preview.
            src={`/widget-preview?lang=${locale}`}
            title={t("settings.widgetPreviewTitle")}
            loading="lazy"
            // Tall enough for the panel, not just the button. Somebody looking
            // at a preview of a button WILL press it, and at 256px the opened
            // panel was cut off at the top — which reads as "the widget is
            // broken" about the thing they are deciding whether to install.
            className="h-[33rem] w-full rounded-app-card border border-app-line bg-app-inset"
          />

          <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
            <li>{t("settings.widgetStepCopy")}</li>
            <li>{t("settings.widgetStepPaste")}</li>
            <li>{t("settings.widgetStepSave")}</li>
          </ol>

          {/* Selectable, wrapping, and readable: somebody whose clipboard
              permission is refused still has to be able to take this by hand. */}
          <pre className="overflow-x-auto rounded-app-card border border-app-line bg-app-inset p-3 text-xs leading-relaxed">
            {/* `break-all` split the line MID-TOKEN — "defer" rendered as
                "defe" / "r>" across two lines. Found by looking at it. The
                attributes are space-separated, so ordinary wrapping breaks at
                the spaces; the two long tokens (the URL and the key) overflow
                instead, which the parent scrolls. Somebody copying this by hand
                because their clipboard was refused has to be able to read it. */}
            <code className="whitespace-pre-wrap">{snippet}</code>
          </pre>

          <div className="flex flex-wrap gap-2">
            <Button onClick={copy}>{t("settings.widgetCopy")}</Button>
            {!confirming ? (
              <Button variant="ghost" onClick={() => setConfirming(true)}>
                {t("settings.widgetRotate")}
              </Button>
            ) : (
              <div className="flex w-full flex-col gap-2 rounded-app-card border border-app-line p-3">
                {/* Loss Aversion, stated plainly: what they stand to LOSE is
                    the widget on every site carrying the old snippet. */}
                <p className="text-sm">{t("settings.widgetRotateWarning")}</p>
                <div className="flex gap-2">
                  <Button
                    variant="destructive"
                    disabled={rotate.isPending}
                    onClick={() => {
                      rotate.mutate(undefined, {
                        onSuccess: () => {
                          setConfirming(false);
                          toast.success(t("settings.widgetRotated"));
                        },
                        onError: () => toast.error(t("settings.widgetRotateFailed")),
                      });
                    }}
                  >
                    {t("settings.widgetRotateConfirm")}
                  </Button>
                  <Button variant="ghost" onClick={() => setConfirming(false)}>
                    {t("common.cancel")}
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* #232 phase 3: which line the website rings.
              LAST, under the actions. The card exists to get one line of markup
              onto a WordPress site, so a routing question in front of that is a
              decision demanded before the thing it decides about even works.
              And it must not sit BETWEEN the snippet and Copy — I put it there
              first and the screenshot showed a Copy button that looked like it
              belonged to the picker. *Applying: Prioritise Intent, and
              Relationship Strength — the snippet and its button are one thing
              and nothing goes between them.* */}
          {routable.length > 1 && (
            <div className="space-y-1.5 border-t border-app-line pt-4">
              <label
                htmlFor="widget-line"
                className="block text-sm font-medium"
              >
                {t("settings.widgetLineLabel")}
              </label>
              <p className="text-xs text-muted-foreground">
                {t("settings.widgetLineHelp")}
              </p>
              <Select
                value={chosen}
                disabled={updateCompany.isPending}
                onValueChange={(value) => {
                  updateCompany.mutate(
                    {
                      widget_number_id: value === DEFAULT_LINE ? null : value,
                    },
                    {
                      onSuccess: () => toast.success(t("settings.widgetLineSaved")),
                      onError: () => toast.error(t("settings.widgetLineFailed")),
                    },
                  );
                }}
              >
                <SelectTrigger id="widget-line" className="w-full sm:w-80">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {/* Named, not blank. "Your first number" is what the server
                      actually does with an unset choice, and a default that
                      does not say what it resolves to is a setting somebody
                      has to test to understand. *Applying: Smart Defaults.* */}
                  <SelectItem value={DEFAULT_LINE}>
                    {t("settings.widgetLineDefault")}
                  </SelectItem>
                  {routable.map((number) => (
                    <SelectItem key={number.id} value={number.id}>
                      {formatPhone(number.number_e164 ?? "")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      )}
    </SettingsCard>
  );
}
