import type { Metadata } from "next";
import { describe, expect, it } from "vitest";

import { metadata as accessibilityFr } from "@/app/(marketing-fr)/fr/accessibilite/page";
import { metadata as vulnerabilityFr } from "@/app/(marketing-fr)/fr/divulgation-vulnerabilites/page";
import { metadata as messagingFr } from "@/app/(marketing-fr)/fr/messagerie/page";
import { metadata as subprocessorsFr } from "@/app/(marketing-fr)/fr/sous-traitants/page";
import { metadata as deleteMyDataFr } from "@/app/(marketing-fr)/fr/supprimer-mes-donnees/page";
import { metadata as cookiesFr } from "@/app/(marketing-fr)/fr/temoins/page";
import { metadata as fairUseFr } from "@/app/(marketing-fr)/fr/utilisation-equitable/page";
import { metadata as accessibilityEn } from "@/app/(marketing)/legal/accessibility/page";
import { metadata as cookiesEn } from "@/app/(marketing)/legal/cookies/page";
import { metadata as deleteMyDataEn } from "@/app/(marketing)/legal/delete-my-data/page";
import { metadata as fairUseEn } from "@/app/(marketing)/legal/fair-use/page";
import { metadata as messagingEn } from "@/app/(marketing)/legal/messaging/page";
import { metadata as subprocessorsEn } from "@/app/(marketing)/legal/subprocessors/page";
import { metadata as vulnerabilityEn } from "@/app/(marketing)/legal/vulnerability-disclosure/page";

const pairs: { en: string; fr: string; enMeta: Metadata; frMeta: Metadata }[] = [
  {
    en: "/legal/accessibility",
    fr: "/fr/accessibilite",
    enMeta: accessibilityEn,
    frMeta: accessibilityFr,
  },
  {
    en: "/legal/cookies",
    fr: "/fr/temoins",
    enMeta: cookiesEn,
    frMeta: cookiesFr,
  },
  {
    en: "/legal/delete-my-data",
    fr: "/fr/supprimer-mes-donnees",
    enMeta: deleteMyDataEn,
    frMeta: deleteMyDataFr,
  },
  {
    en: "/legal/fair-use",
    fr: "/fr/utilisation-equitable",
    enMeta: fairUseEn,
    frMeta: fairUseFr,
  },
  {
    en: "/legal/messaging",
    fr: "/fr/messagerie",
    enMeta: messagingEn,
    frMeta: messagingFr,
  },
  {
    en: "/legal/subprocessors",
    fr: "/fr/sous-traitants",
    enMeta: subprocessorsEn,
    frMeta: subprocessorsFr,
  },
  {
    en: "/legal/vulnerability-disclosure",
    fr: "/fr/divulgation-vulnerabilites",
    enMeta: vulnerabilityEn,
    frMeta: vulnerabilityFr,
  },
];

describe("#228 translated legal metadata is canonical and reciprocal", () => {
  for (const pair of pairs) {
    it(`${pair.en} and ${pair.fr} publish the same hreflang set`, () => {
      const languages = {
        "en-CA": pair.en,
        "fr-CA": pair.fr,
        "x-default": pair.en,
      };
      expect(pair.enMeta.alternates?.canonical).toBe(`https://loonext.com${pair.en}`);
      expect(pair.frMeta.alternates?.canonical).toBe(`https://loonext.com${pair.fr}`);
      expect(pair.enMeta.alternates?.languages).toEqual(languages);
      expect(pair.frMeta.alternates?.languages).toEqual(languages);
    });
  }
});
