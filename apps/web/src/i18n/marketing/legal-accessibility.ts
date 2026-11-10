import type { Translated } from "../translated";

import type { MarketingLocale } from "./footer";

export const legalAccessibilityEn = {
  metaTitle: "Accessibility conformance statement",
  metaDescription:
    "What Loonext verifies about accessibility and what it does not: WCAG 2.2 AA criteria enforced by named tests, the gaps stated plainly, and no third-party audit claimed.",
  title: "Accessibility conformance statement",
  breadcrumbLabel: "Accessibility",
  lastUpdated: "November 10, 2026",
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
    "**No TalkBack or VoiceOver pass has been performed on a physical device**, on any flow, on either phone app, and VoiceOver has not been run at all. On November 10, 2026 TalkBack was driven through most of the Android flows on an emulator; it found eleven defects that the automated audit could not (controls announced without a role, choices that did not say which one was on, a failed send that made no sound) and they are fixed. It did not reach ringing, in-call, sign up, bulk selection or task detail, did not run French or large text, and was not a person using a screen reader. Every icon-only control has an accessible name and a build fails if one loses it, but whether a whole task can be driven by a screen reader on a phone in somebody's hand is not claimed here.",
  notVerifiedTwo:
    "**Text scaling** is enforced as a mechanism on both phones. On Android, every build renders the send-message, answer-call, and complete-task flows at 200% and fails on text cut off or a control pushed off the screen. iOS renders the full For You dashboard in both themes at its largest accessibility text size and checks its flows at that size for hit regions and unreadable elements, but does not render them.",
  gapsIntro:
    "Stated plainly, because a buyer who finds one of these themselves stops believing the rest of the page.",
  gapAudit:
    "**No third-party audit** has been carried out. Everything here is first-party, which is why each claim names the check behind it.",
  gapScreenReader:
    "Native screen-reader flows are untested end to end, as above: Android has one emulator pass that did not reach every flow, and iOS has none.",
  gapIos:
    "Large-text render coverage is complete on Android only: it renders the three primary native flows at 200%. iOS renders the For You dashboard, not the three flows.",
  gapLocale:
    "Both phone apps now attach the resolved in-app language to their native accessibility content: Android adds locale metadata to the text and labels exposed by Compose, and iOS publishes the same choice through SwiftUI's native locale environment. Tests enforce those mechanisms, but no physical-device TalkBack or VoiceOver pass has verified French pronunciation.",
  contact:
    "If something here blocks you, or you need this statement in another format, write to {supportEmail} and say what you were trying to do. An accessibility problem that stops somebody working is treated as a broken feature, not as feedback.",
} as const;

export const legalAccessibilityFr: Translated<typeof legalAccessibilityEn> = {
  metaTitle: "Déclaration de conformité en matière d'accessibilité",
  metaDescription:
    "Ce que Loonext vérifie en matière d'accessibilité et ce qu'il ne vérifie pas : les critères WCAG 2.2 AA protégés par des tests nommés, les lacunes indiquées clairement et aucune prétention d'audit indépendant.",
  title: "Déclaration de conformité en matière d'accessibilité",
  breadcrumbLabel: "Accessibilité",
  lastUpdated: "10 novembre 2026",
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
    "**Aucun parcours avec TalkBack ou VoiceOver n'a été effectué sur un appareil physique**, pour aucun flux et dans aucune des applications mobiles, et VoiceOver n'a pas été utilisé du tout. Le 10 novembre 2026, TalkBack a parcouru la plupart des flux Android sur un émulateur; il a relevé onze défauts que l'audit automatisé ne pouvait pas voir (des commandes annoncées sans rôle, des choix qui ne disaient pas lequel était actif, un envoi échoué sans aucun son), et ils sont corrigés. Il n'a pas atteint la sonnerie, l'appel en cours, la création de compte, la sélection multiple ni le détail d'une tâche, n'a pas couvert le français ni le texte agrandi, et ce n'était pas une personne utilisant un lecteur d'écran. Chaque commande composée uniquement d'une icône a un nom accessible, et une compilation échoue si elle le perd; mais la possibilité d'effectuer une tâche complète avec un lecteur d'écran sur un téléphone, entre les mains de quelqu'un, n'est pas affirmée ici.",
  notVerifiedTwo:
    "**La mise à l'échelle du texte** est imposée comme mécanisme sur les deux téléphones. Sur Android, chaque compilation rend les parcours d'envoi d'un message, de réponse à un appel et d'achèvement d'une tâche à 200 % et échoue si un texte est coupé ou si une commande sort de l'écran. iOS rend le tableau de bord Pour vous complet, dans les deux thèmes, à sa plus grande taille de texte d'accessibilité et vérifie ses parcours à cette taille pour les zones de toucher et les éléments illisibles, sans les rendre.",
  gapsIntro:
    "Nous les indiquons clairement, parce qu'un acheteur qui découvre lui-même l'une de ces lacunes cesse de croire le reste de la page.",
  gapAudit:
    "**Aucun audit indépendant** n'a été effectué. Toutes les vérifications sont internes, raison pour laquelle chaque affirmation nomme le test qui l'appuie.",
  gapScreenReader:
    "Les parcours natifs avec un lecteur d'écran n'ont pas été testés de bout en bout, comme indiqué ci-dessus : Android a un seul parcours sur émulateur qui n'a pas atteint tous les flux, et iOS n'en a aucun.",
  gapIos:
    "La couverture du rendu avec du texte agrandi n'est complète que sur Android : il rend les trois principaux parcours natifs à 200 %. iOS rend le tableau de bord Pour vous, pas les trois parcours.",
  gapLocale:
    "Les deux applications mobiles associent maintenant la langue résolue dans l'application à leur contenu d'accessibilité natif : Android ajoute les métadonnées de langue au texte et aux libellés exposés par Compose, et iOS publie le même choix dans l'environnement de langue natif de SwiftUI. Des tests protègent ces mécanismes, mais aucun parcours sur un appareil physique avec TalkBack ou VoiceOver n'a vérifié la prononciation du français.",
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
  "2.5.3 Label in Name": {
    criterion: "**2.5.3** Étiquette dans le nom",
    holds:
      "Le nom accessible de chaque commande contient les mots qu'elle affiche, dans l'ordre, pour qu'une personne qui utilise la commande vocale puisse dire ce qu'elle voit. Chaque rangée en forme de carte est un lien sur son titre étendu à toute la carte, et les initiales sont dessinées en CSS comme une photo",
    sourceHolds:
      "Every control's accessible name contains the words it shows, in order, so a voice-control user can say what they see. Card rows are a link on their title stretched over the card, and initials are drawn by CSS like a photo",
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
  "1.3.5 Identify Input Purpose": {
    criterion: "**1.3.5** Identifier la finalité de la saisie",
    holds:
      "Chaque champ de la connexion, de l'inscription, de l'intégration, de l'enregistrement de la marque et du profil qui recueille les renseignements de la personne nomme sa finalité avec une valeur autocomplete reconnue, ou indique off de façon délibérée",
    sourceHolds:
      "Every field in sign-in, sign-up, onboarding, brand registration and profile that collects the person's own details names its autocomplete purpose with a registered token, or says off on purpose",
  },
  "3.3.8 Accessible Authentication (Minimum)": {
    criterion: "**3.3.8** Authentification accessible (minimum)",
    holds:
      "Rien sur la surface de connexion ne bloque le collage, la copie ou le glisser-déposer; chaque champ de mot de passe indique s'il est nouveau ou existant et chaque champ de code est one-time-code, de sorte qu'un gestionnaire de mots de passe ou le téléphone se charge de la mémorisation",
    sourceHolds:
      "Nothing on the sign-in surface blocks paste, copy or drop; every password field says whether it is new or existing and every code field is one-time-code, so a password manager or the phone does the remembering",
  },
  "3.2.6 Consistent Help": {
    criterion: "**3.2.6** Aide cohérente",
    holds:
      "Chaque écran sans session affiche le même lien d'aide au même endroit, parce qu'il est rendu par la mise en page d'authentification et non par chaque page; les routes d'aide de l'application et du site sont fixées là où leurs écrans les attendent",
    sourceHolds:
      "Every signed-out screen shows the same help link in the same slot, because it is rendered by the auth layout and not by each page; the signed-in and marketing help routes are pinned where their screens expect them",
  },
  "2.1.4 Character Key Shortcuts": {
    criterion: "**2.1.4** Raccourcis clavier à touche unique",
    holds:
      "Les raccourcis à touche unique de la liste de la boîte de réception (j, k, e et les autres) peuvent être désactivés avec Raccourcis à touche unique dans Paramètres, Profil. Ils ne s'activent jamais lorsque le focus est dans un champ, le compositeur, un menu ou une boîte de dialogue, et ils ignorent toute touche pressée avec Ctrl, Alt ou Cmd",
    sourceHolds:
      "The inbox list's single-key shortcuts (j, k, e and the rest) can be turned off with Single-key shortcuts in Settings, Profile. They never fire while focus is in a field, the composer, a menu or a dialog, and they ignore any key pressed with Ctrl, Alt or Cmd",
  },
  "1.4.10 Reflow": {
    criterion: "**1.4.10** Redimensionnement du contenu",
    holds:
      "Chaque page publique, en anglais comme en français, tient dans une fenêtre de 320 px sans défilement horizontal de la page; les champs de texte font 16 px sur téléphone pour que Mobile Safari ne zoome pas à la mise en focus",
    sourceHolds:
      "Every public page, in English and in French, fits a 320px viewport without the page scrolling sideways; text fields are 16px at phone widths so Mobile Safari does not zoom on focus",
  },
};

const COPY = { en: legalAccessibilityEn, "fr-CA": legalAccessibilityFr } as const;

export function legalAccessibilityCopy(locale: MarketingLocale = "en") {
  return COPY[locale] ?? legalAccessibilityEn;
}
