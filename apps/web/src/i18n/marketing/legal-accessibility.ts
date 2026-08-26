import type { Translated } from "../translated";

import type { MarketingLocale } from "./footer";

export const legalAccessibilityEn = {
  metaTitle: "Accessibility conformance statement",
  metaDescription:
    "What Loonext verifies about accessibility and what it does not: WCAG 2.2 AA criteria enforced by named tests, the gaps stated plainly, and no third-party audit claimed.",
  title: "Accessibility conformance statement",
  breadcrumbLabel: "Accessibility",
  lastUpdated: "August 14, 2026",
  summary:
    "We target WCAG 2.2 Level AA. Everything on this page is either enforced by a named test that fails our build, or listed as not verified — there is no third category, and nothing is claimed here because it is probably true. No third-party audit has been carried out, which is exactly why each claim names the check behind it.",
  sectionAsking: "What a buyer is usually asking",
  sectionVerified: "Verified by a test",
  sectionNotVerified: "Not verified",
  sectionGaps: "Known gaps",
  sectionContact: "Contact",
  askingIntro:
    "\"Is it accessible?\" is four questions, and answering them separately is more useful than a single letter grade:",
  askingOne:
    "Can somebody who cannot see the screen use it? — screen reader support.",
  askingTwo:
    "Can somebody who cannot use a mouse use it? — keyboard and pointer.",
  askingThree:
    "Can somebody who cannot see it *well* use it? — contrast, text size, motion.",
  askingFour: "Can you prove any of it? — the column that is usually empty.",
  askingEnd:
    "The table below is our answer to the fourth. It applies to the Loonext web application, and to the Android and iOS apps where stated.",
  verifiedIntro:
    "Each row fails a build if it stops being true. This is the whole table; there is nothing we count as verified that is not here. Every one of these has been proven by breaking it — the rule removed from the product, the check observed to fail, the removal reverted. A check that has only ever passed is not evidence.",
  tableCaption:
    "WCAG 2.2 criteria Loonext enforces with a named automated check",
  columnCriterion: "Criterion",
  columnHolds: "What holds",
  columnEnforcedBy: "Enforced by",
  notVerifiedOne:
    "**No TalkBack or VoiceOver pass has been performed**, on any flow, on either phone app. Every icon-only control has an accessible name and a build fails if one loses it — but a name is necessary and nowhere near sufficient. Reading order, whether a live region speaks at the right moment, whether a custom control exposes the right role and state, and whether a whole task can be driven by a screen reader all need a person with a phone. None of that is claimed here.",
  notVerifiedTwo:
    "**Text scaling** is enforced as a mechanism on both phones: every font is declared in a unit that carries the reader's font scale. Android's layout at 200% text is rendered on every test run; iOS has no equivalent render, so its matching fix rests on the two apps having had identical measurements rather than on a second picture.",
  gapsIntro:
    "Stated plainly, because a buyer who finds one of these themselves stops believing the rest of the page.",
  gapResize:
    "The thread panel's resize handle offers arrow-key resizing and a double-click reset. The double-click is the single-pointer path but reaches only one width; an arbitrary width without dragging is keyboard-only.",
  gapAudit:
    "**No third-party audit** has been carried out. Everything here is first-party, which is why each claim names the check behind it.",
  gapScreenReader: "Native screen-reader flows are untested end to end, as above.",
  gapIos: "iOS is not rendered at 200% text anywhere.",
  contact:
    "If something here blocks you, or you need this statement in another format, write to {supportEmail} and say what you were trying to do. An accessibility problem that stops somebody working is treated as a broken feature, not as feedback.",
} as const;

export const legalAccessibilityFr: Translated<typeof legalAccessibilityEn> = {
  metaTitle: "Déclaration de conformité en matière d'accessibilité",
  metaDescription:
    "Ce que Loonext vérifie en matière d'accessibilité et ce qu'il ne vérifie pas : les critères WCAG 2.2 AA protégés par des tests nommés, les lacunes indiquées clairement et aucune prétention d'audit indépendant.",
  title: "Déclaration de conformité en matière d'accessibilité",
  breadcrumbLabel: "Accessibilité",
  lastUpdated: "14 août 2026",
  summary:
    "Nous visons le niveau AA des WCAG 2.2. Chaque élément de cette page est soit protégé par un test nommé qui fait échouer notre compilation, soit indiqué comme non vérifié; il n'existe aucune troisième catégorie et nous ne prétendons rien simplement parce que c'est probablement vrai. Aucun audit indépendant n'a été effectué, et c'est précisément pourquoi chaque affirmation nomme la vérification qui l'appuie.",
  sectionAsking: "Ce qu'un acheteur cherche habituellement à savoir",
  sectionVerified: "Vérifié par un test",
  sectionNotVerified: "Non vérifié",
  sectionGaps: "Lacunes connues",
  sectionContact: "Nous joindre",
  askingIntro:
    "\"Est-ce accessible?\" cache quatre questions, et y répondre séparément est plus utile qu'une seule note :",
  askingOne:
    "Une personne qui ne voit pas l'écran peut-elle l'utiliser? — prise en charge des lecteurs d'écran.",
  askingTwo:
    "Une personne qui ne peut pas utiliser une souris peut-elle l'utiliser? — clavier et dispositif de pointage.",
  askingThree:
    "Une personne qui voit *moins bien* peut-elle l'utiliser? — contraste, taille du texte et mouvement.",
  askingFour:
    "Pouvez-vous prouver quoi que ce soit? — la colonne qui est habituellement vide.",
  askingEnd:
    "Le tableau ci-dessous répond à la quatrième question. Il s'applique à l'application Web Loonext ainsi qu'aux applications Android et iOS lorsque cela est indiqué.",
  verifiedIntro:
    "Chaque ligne fait échouer une compilation si elle cesse d'être vraie. Voici le tableau complet; rien d'autre n'est considéré comme vérifié. Chacune de ces protections a été prouvée en la brisant : la règle a été retirée du produit, l'échec du test a été observé, puis le retrait a été annulé. Un test qui a seulement réussi ne constitue pas une preuve.",
  tableCaption:
    "Critères WCAG 2.2 que Loonext applique au moyen d'une vérification automatisée nommée",
  columnCriterion: "Critère",
  columnHolds: "Ce qui est assuré",
  columnEnforcedBy: "Appliqué par",
  notVerifiedOne:
    "**Aucun parcours avec TalkBack ou VoiceOver n'a été effectué**, pour aucun flux et dans aucune des applications mobiles. Chaque commande composée uniquement d'une icône a un nom accessible, et une compilation échoue si elle le perd; un nom est toutefois nécessaire et loin d'être suffisant. L'ordre de lecture, l'annonce d'une région dynamique au bon moment, l'exposition du bon rôle et du bon état par une commande personnalisée, et la possibilité d'effectuer une tâche complète avec un lecteur d'écran exigent une personne et un téléphone. Nous ne prétendons rien de tel ici.",
  notVerifiedTwo:
    "**La mise à l'échelle du texte** est imposée comme mécanisme sur les deux téléphones : chaque police est déclarée dans une unité qui respecte le facteur d'agrandissement de la personne. La mise en page Android avec du texte à 200 % est rendue à chaque exécution des tests; iOS n'a aucun rendu équivalent, alors sa correction correspondante repose sur les mesures identiques des deux applications plutôt que sur une deuxième image.",
  gapsIntro:
    "Nous les indiquons clairement, parce qu'un acheteur qui découvre lui-même l'une de ces lacunes cesse de croire le reste de la page.",
  gapResize:
    "La poignée de redimensionnement du panneau de conversation permet un ajustement avec les touches fléchées et une réinitialisation par double-clic. Le double-clic offre le parcours avec un seul dispositif de pointage, mais n'atteint qu'une largeur; une largeur arbitraire sans glisser est possible seulement au clavier.",
  gapAudit:
    "**Aucun audit indépendant** n'a été effectué. Toutes les vérifications sont internes, raison pour laquelle chaque affirmation nomme le test qui l'appuie.",
  gapScreenReader:
    "Les parcours natifs avec un lecteur d'écran n'ont pas été testés de bout en bout, comme indiqué ci-dessus.",
  gapIos: "iOS n'est rendu nulle part avec du texte à 200 %.",
  contact:
    "Si un élément ici vous bloque ou si vous avez besoin de cette déclaration dans un autre format, écrivez à {supportEmail} et indiquez ce que vous tentiez de faire. Un problème d'accessibilité qui empêche une personne de travailler est traité comme une fonction brisée, pas comme un simple commentaire.",
};

export const accessibilityVerifiedFr: Record<
  string,
  { criterion: string; holds: string; sourceHolds: string }
> = {
  "1.4.3 Contrast (Minimum)": {
    criterion: "**1.4.3** Contraste (minimum)",
    holds:
      "Les paires de jetons de texte sont recalculées à partir des vraies valeurs hexadécimales de globals.css, dans les deux thèmes",
    sourceHolds:
      "Text token pairs recomputed from the actual hex values in globals.css, in both themes",
  },
  "1.4.3 Contrast, rendered": {
    criterion: "**1.4.3** Contraste du rendu",
    holds:
      "Le texte rendu est mesuré par rapport à son arrière-plan réel sur de vraies pages, dans les deux thèmes",
    sourceHolds:
      "Rendered text measured against its actual background on real pages, both themes",
  },
  "2.3.3 Animation from Interactions": {
    criterion: "**2.3.3** Animation déclenchée par les interactions",
    holds:
      "Une règle de base annule le mouvement avec prefers-reduced-motion; elle ne peut pas être affaiblie ni supprimée",
    sourceHolds:
      "One base rule zeroes motion under prefers-reduced-motion; the rule cannot be weakened or deleted",
  },
  "2.5.7 Dragging Movements": {
    criterion: "**2.5.7** Mouvements de glissement",
    holds:
      "Chaque fichier qui amorce un glissement consigne le code de son autre méthode à pointeur unique, sur les trois clients",
    sourceHolds:
      "Every file that starts a drag records the code implementing its single-pointer alternative — on all three clients",
  },
  "2.4.7 Focus Visible": {
    criterion: "**2.4.7** Mise au point visible",
    holds:
      "Chaque commande atteinte avec Tab a un contour ou un anneau, mesuré sur la page rendue dans les deux thèmes",
    sourceHolds:
      "Every control reached by pressing Tab has an outline or a ring, measured on the rendered page in both themes",
  },
  "1.4.11 Non-text Contrast — focus": {
    criterion: "**1.4.11** Contraste des éléments non textuels — mise au point",
    holds:
      "L'indicateur atteint un rapport de 3:1 sur la surface derrière lui, avec son alpha composé plutôt que présumé",
    sourceHolds:
      "That indicator clears 3:1 against the surface behind it, with its alpha composited rather than assumed away",
  },
  "2.4.11 Focus Not Obscured (Minimum)": {
    criterion: "**2.4.11** Mise au point non masquée (minimum)",
    holds:
      "La commande ciblée n'est pas entièrement cachée par un en-tête fixe ou une superposition, selon le compositeur plutôt que des rectangles calculés",
    sourceHolds:
      "The focused control is not entirely covered by a sticky header or overlay, sampled from the compositor rather than computed from rectangles",
  },
  "2.5.8 Target Size (Minimum)": {
    criterion: "**2.5.8** Taille de la cible (minimum)",
    holds:
      "Les cibles interactives sont mesurées à 375 px selon le seuil de 24 px de 2.5.8; .tap-target (44 px) est reconnu au-dessus",
    sourceHolds:
      "Interactive targets measured at 375px against 2.5.8's 24px floor; .tap-target (44px) credited above it",
  },
  "4.1.2 Name, Role, Value — names": {
    criterion: "**4.1.2** Nom, rôle et valeur — noms",
    holds:
      "Les éléments interactifs ont un nom accessible, calculé comme le ferait une technologie d'assistance",
    sourceHolds:
      "Interactive elements have an accessible name, computed the way an AT computes it",
  },
  "4.1.2 Name, Role, Value — roles": {
    criterion: "**4.1.2** Nom, rôle et valeur — rôles",
    holds:
      "role=tab porte aria-selected; role=tablist contient de vrais onglets; aria-live indique son niveau de courtoisie",
    sourceHolds:
      'role="tab" carries aria-selected; role="tablist" contains real tabs; aria-live states its politeness',
  },
  "4.1.3 Status Messages": {
    criterion: "**4.1.3** Messages d'état",
    holds:
      "Les messages entrants sont annoncés poliment; l'état d'envoi du composeur est annoncé plutôt que seulement stylisé",
    sourceHolds:
      "Incoming messages announce politely; the composer's send state is announced rather than only styled",
  },
  "3.1.1 Language of Page": {
    criterion: "**3.1.1** Langue de la page",
    holds:
      "L'attribut lang du document suit le réglage de la personne plutôt que celui de la compilation, afin qu'un lecteur d'écran lise le français avec une voix française",
    sourceHolds:
      "The document's lang follows the READER's own setting rather than the build's, so a screen reader speaks French with a French voice instead of an English one",
  },
};

const COPY = { en: legalAccessibilityEn, "fr-CA": legalAccessibilityFr } as const;

export function legalAccessibilityCopy(locale: MarketingLocale = "en") {
  return COPY[locale] ?? legalAccessibilityEn;
}
