"use client";

import {
  REFERRAL_SHARE_ACTION,
  REFERRAL_SHARE_COPIED,
  REFERRAL_SHARE_COPY,
  REFERRAL_SHARE_DRAFT_LABEL,
  REFERRAL_SHARE_LINK_NOTE,
  REFERRAL_SHARE_NOTE,
  referralShareText,
} from "@loonext/shared";

import { sayWith, useT } from "@/i18n/provider";
import { Check, Copy, Share2 } from "lucide-react";
import { useEffect, useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

/**
 * #288 — one tap, with a message they can edit.
 *
 * # Evaluation
 *
 * The old card offered exactly one action: Copy. That is not a share mechanism,
 * it is a clipboard — the owner still has to open Messages, pick a person, paste,
 * and then write the covering sentence themselves. #288's words: "Contractors
 * will happily recommend a tool; they will not happily fill in a form."
 *
 * # Violations this fixes
 *
 * *Smart Defaults* — the message was empty, which is to say it did not exist. A
 * default draft is the difference between a favour that takes three seconds and
 * one that takes three minutes of composing something that does not sound like
 * an advert.
 *
 * *Prioritize Intent* — the core action is "send this to somebody", and the
 * interface offered the mechanical half of it.
 *
 * # What it does NOT do, and never will
 *
 * The share sheet is the OS's. It hands the draft to the owner's own Messages,
 * WhatsApp or email, on their own number, and they choose the recipient. Nothing
 * leaves through the carrier and we never learn who it went to. That boundary is
 * why this is not the mass-texting D4 and D11 exclude: the product supplies a
 * draft, the person supplies the distribution.
 *
 * # Why the link is not in the textarea
 *
 * The first owner who rewrites this in their own words would delete it, send it,
 * and get nothing for a referral they actually made. `referralShareText` appends
 * it, so there is no version of this that can go out without it.
 *
 * *Applying: Smart Defaults, Prioritize Intent, and the Zen of Clarity — one
 * primary action, one fallback, no formatting controls on a text message.*
 */
export function ReferralShare({
  link,
  code,
}: {
  link: string | null;
  code: string;
}) {
  const t = useT();
  // #228: the shared referral copy names keys, so this says them in the
  // reader's language.
  const say = sayWith(t);
  /*
   * Resolved LAZILY, and it is the draft rather than a label — seeding the
   * textarea with `domain.referralNote` would hand somebody a catalogue key to
   * send to another business.
   *
   * Not re-resolved when the locale changes: by then it is a draft this person
   * may have edited, and replacing their words because they switched language
   * would lose work. A fresh visit gets the new language.
   */
  const [note, setNote] = useState(() => say(REFERRAL_SHARE_NOTE));
  const [copied, setCopied] = useState(false);
  const [canShare, setCanShare] = useState(false);
  const draftId = useId();

  // After mount, because `navigator` does not exist while this renders on the
  // server — and because rendering Share and then swapping it for Copy would
  // move the button under somebody's thumb.
  useEffect(() => {
    setCanShare(typeof navigator !== "undefined" && typeof navigator.share === "function");
  }, []);

  const text = referralShareText(note, link, code);

  return (
    <div className="space-y-2">
      <label
        htmlFor={draftId}
        className="block text-xs font-medium text-muted-foreground"
      >
        {say(REFERRAL_SHARE_DRAFT_LABEL)}
      </label>
      <Textarea
        id={draftId}
        value={note}
        onChange={(event) => setNote(event.target.value)}
        rows={3}
        className="text-sm"
      />
      <p className="text-xs text-muted-foreground">
        {say(REFERRAL_SHARE_LINK_NOTE)}{" "}
        <span className="break-all font-mono">{link ?? code}</span>
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {canShare && (
          <Button
            onClick={() => {
              // A cancelled share sheet rejects with AbortError. That is the
              // person changing their mind, not a failure, and it must not put
              // an error in front of them.
              void navigator.share({ text }).catch(() => undefined);
            }}
          >
            <Share2 strokeWidth={1.75} aria-hidden />
            {say(REFERRAL_SHARE_ACTION)}
          </Button>
        )}
        <Button
          variant={canShare ? "outline" : "default"}
          onClick={() => {
            void navigator.clipboard.writeText(text).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            });
          }}
        >
          {copied ? (
            <Check strokeWidth={1.75} aria-hidden />
          ) : (
            <Copy strokeWidth={1.75} aria-hidden />
          )}
          {copied ? REFERRAL_SHARE_COPIED : REFERRAL_SHARE_COPY}
        </Button>
      </div>
    </div>
  );
}
