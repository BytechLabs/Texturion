"use client";

import { useState } from "react";
import { toast } from "sonner";

import { SettingsCard } from "@/components/settings/section";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/provider";
import { useRotateWidgetKey, useWidgetKey } from "@/lib/api/companies";
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
 */
export function WebsiteWidgetCard({ appOrigin }: { appOrigin: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const key = useWidgetKey(open);
  const rotate = useRotateWidgetKey();

  const snippet =
    key.data === undefined ? "" : widgetSnippet(appOrigin, key.data.widget_key);

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
        </div>
      )}
    </SettingsCard>
  );
}
