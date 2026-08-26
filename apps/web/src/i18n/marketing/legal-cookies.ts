import type { Translated } from "../translated";

import type { MarketingLocale } from "./footer";

export const legalCookiesEn = {
  metaTitle: "Cookie policy",
  metaDescription:
    "The cookies Loonext sets: essential first-party ones to keep you signed in and remember your choices, analytics or ad cookies only if you say yes, nothing more.",
  title: "Cookie policy",
  breadcrumbLabel: "Cookies",
  lastUpdated: "August 1, 2026",
  summary:
    "Loonext sets only a small number of essential, first-party cookies: one keeps you signed in, one remembers which workspace you are viewing, and one remembers your answer to the cookie banner. On the public marketing pages we use Google Tag Manager, and it may set analytics or advertising cookies only if you say yes to that banner; say no, or say nothing, and it sets none. The signed-in app never uses tracking cookies, we do not sell data, and our product analytics is cookieless (it stores anonymous, event-level usage in your browser's local storage, never message content, names, or phone numbers).",

  sectionShort: "The short version",
  sectionEssential: "Essential cookies we set",
  sectionConsent: "Tracking cookies only if you say yes",
  sectionAnalytics: "Analytics, without cookies",
  sectionStorage: "Local storage, which is not a cookie",
  sectionChoices: "Your choices",
  sectionContact: "Contact",
  privacyLink: "privacy policy",
  subprocessorsLink: "sub-processors page",

  short:
    "A cookie is a small piece of text a website stores in your browser. Loonext uses essential cookies for exactly three jobs, all first-party (set by us, not a third party): keeping you signed in, remembering which of your workspaces you are looking at, and remembering how you answered our cookie banner. Beyond those, the public marketing pages ask before setting anything: a banner offers a plain yes or no, and analytics or advertising cookies exist only after a yes. We never sell your data, and the signed-in app never uses tracking cookies at all. Everything else we store in your browser is either cookieless or a plain local-storage convenience, described below. This page sits next to our {privacy}.",
  essentialIntro:
    "Three first-party cookies do necessary jobs. They carry no advertising identifiers and are readable only by Loonext:",
  essentialSession:
    "**Your session.** When you sign in, an authentication cookie keeps you signed in as you move between pages, so you are not asked for your password on every screen. Sign out and it is cleared.",
  essentialWorkspace:
    "**Your workspace.** A single cookie remembers which workspace you last had open, so the app opens on the right one. It holds only that workspace's internal id, no personal details, and expires after a year (sooner if you clear it).",
  essentialChoice:
    "**Your cookie choice.** One cookie (`loonext.consent`) remembers how you answered the banner on our marketing pages, so we do not ask again on every visit, and so a \"no\" stays a no. It holds only the word \"granted\" or \"denied\" and expires after 180 days, after which we simply ask again.",
  essentialEnd:
    "These are strictly necessary: the first two are how staying signed in works, and the third is how we remember not to track you. We set no other cookie without asking first.",
  consentOne:
    "Our public marketing pages load Google Tag Manager, a tool that lets us measure which pages bring people in and, if we run ads, whether those ads are honest about what works. It starts in a denied-by-default state (Google calls this consent mode): until you answer the banner with a yes, tags that would set analytics or advertising cookies set nothing. Say no, or ignore the banner entirely, and no analytics or advertising cookie is ever set. With JavaScript turned off, the tag manager does not load at all. None of this applies to the signed-in app, which loads no tag manager and no advertising code on any screen.",
  consentTwo:
    "We run no ad networks on the site itself, we do not embed social-media trackers, and we never sell or rent your data. The third parties in the product are the sub-processors that make it run (the phone carrier, payments, hosting, email, and error and analytics tooling), each listed on our {subprocessors} and limited to what its job requires.",
  analytics:
    "Separately from the optional measurement above, we track which product features get used so we can improve them. That product analytics is configured to be cookieless: it stores its state in your browser's local storage rather than a cookie, records event-level usage only (page views, feature clicks, counts), and is stripped of message content, names, addresses, and phone numbers before anything is sent. Marketing traffic stays anonymous; a profile exists only once a workspace signs in, and it is keyed to the workspace's internal id, never to you as a person. The tooling is named on our {subprocessors}.",
  storageOne:
    "Some conveniences live in your browser's local storage, which stays on your device and is never sent to us as a cookie: your country choice on the marketing pages, an in-progress signup so a refresh does not lose your place, and the cookieless analytics state above. Clearing your browser's site data removes all of it. None of it contains message content or contact details.",
  storageTwo:
    "One more, only if you arrive through somebody's referral link: we keep the code from that link so the person who introduced you is credited if you sign up. The code identifies their workspace, not you, it is not an advertising identifier, no ad network can read it, and it is forgotten after 30 days or as soon as you create a workspace, whichever comes first.",
  choicesIntro:
    "You are in control, and changing your mind is one tap. Your current choice for the optional cookies, changeable right here any time:",
  choicesNoScript:
    "With JavaScript off there is nothing to switch: the tag manager never loads, so no optional cookie is ever set.",
  choicesBrowser:
    "Your browser can also block or clear cookies and local storage at any time, per site or across the board. Blocking the essential cookies means you will not be able to stay signed in to the app; the public marketing pages work either way.",
  contact:
    "Questions about what we store, or a request about your data? Write to {supportEmail}, and see the {privacy} for how we handle personal data overall.",
} as const;

export const legalCookiesFr: Translated<typeof legalCookiesEn> = {
  metaTitle: "Politique sur les témoins",
  metaDescription:
    "Les témoins utilisés par Loonext : des témoins internes essentiels pour garder votre session ouverte et mémoriser vos choix, puis des témoins d'analyse ou de publicité seulement si vous acceptez, rien de plus.",
  title: "Politique sur les témoins",
  breadcrumbLabel: "Témoins",
  lastUpdated: "1er août 2026",
  summary:
    "Loonext n'utilise qu'un petit nombre de témoins internes essentiels : un garde votre session ouverte, un mémorise l'espace de travail affiché et un conserve votre réponse à la bannière sur les témoins. Sur les pages publiques, nous utilisons Google Tag Manager, qui peut placer des témoins d'analyse ou de publicité uniquement si vous acceptez dans la bannière; si vous refusez ou ne répondez pas, il n'en place aucun. L'application avec ouverture de session n'utilise jamais de témoins de suivi, nous ne vendons pas de données et nos analyses du produit sont sans témoins : elles conservent dans le stockage local de votre navigateur des événements d'utilisation anonymes, jamais le contenu des messages, les noms ni les numéros de téléphone.",

  sectionShort: "En bref",
  sectionEssential: "Les témoins essentiels que nous utilisons",
  sectionConsent: "Des témoins de suivi seulement si vous acceptez",
  sectionAnalytics: "Des analyses sans témoins",
  sectionStorage: "Le stockage local, qui n'est pas un témoin",
  sectionChoices: "Vos choix",
  sectionContact: "Nous joindre",
  privacyLink: "politique de confidentialité",
  subprocessorsLink: "page des sous-traitants",

  short:
    "Un témoin est un petit texte qu'un site Web conserve dans votre navigateur. Loonext utilise des témoins essentiels pour exactement trois fonctions, tous internes et placés par nous : garder votre session ouverte, mémoriser l'espace de travail consulté et conserver votre réponse à notre bannière. Pour tout le reste, les pages publiques demandent votre permission avant de placer quoi que ce soit : la bannière offre un simple oui ou non, et les témoins d'analyse ou de publicité n'existent qu'après un oui. Nous ne vendons jamais vos données et l'application avec ouverture de session n'utilise aucun témoin de suivi. Tout autre renseignement conservé dans votre navigateur est sans témoin ou constitue une commodité dans le stockage local, comme nous l'expliquons ci-dessous. Cette page accompagne notre {privacy}.",
  essentialIntro:
    "Trois témoins internes remplissent des fonctions nécessaires. Ils ne contiennent aucun identifiant publicitaire et seul Loonext peut les lire :",
  essentialSession:
    "**Votre session.** Lorsque vous ouvrez une session, un témoin d'authentification la garde ouverte pendant que vous passez d'une page à l'autre; vous n'avez donc pas à saisir votre mot de passe à chaque écran. Il est supprimé à la fermeture de la session.",
  essentialWorkspace:
    "**Votre espace de travail.** Un seul témoin mémorise le dernier espace de travail ouvert afin que l'application affiche le bon. Il contient seulement l'identifiant interne de cet espace, aucun renseignement personnel, et expire après un an ou plus tôt si vous le supprimez.",
  essentialChoice:
    "**Votre choix concernant les témoins.** Un témoin (`loonext.consent`) mémorise votre réponse à la bannière de nos pages publiques. Nous ne vous reposons donc pas la question à chaque visite et un \"non\" reste un non. Il contient seulement le mot \"granted\" ou \"denied\" et expire après 180 jours; nous vous demandons alors de nouveau.",
  essentialEnd:
    "Ces témoins sont strictement nécessaires : les deux premiers permettent de garder votre session ouverte et le troisième mémorise que nous ne devons pas vous suivre. Nous ne plaçons aucun autre témoin sans demander votre permission.",
  consentOne:
    "Nos pages publiques chargent Google Tag Manager, un outil qui nous aide à mesurer quelles pages attirent des visiteurs et, si nous faisons de la publicité, si ces publicités représentent honnêtement ce qui fonctionne. Il commence dans un état refusé par défaut, que Google appelle le mode consentement : tant que vous n'acceptez pas dans la bannière, les balises qui placeraient des témoins d'analyse ou de publicité ne placent rien. Si vous refusez ou ignorez la bannière, aucun de ces témoins n'est placé. Si JavaScript est désactivé, le gestionnaire ne se charge pas. Rien de tout cela ne s'applique à l'application avec ouverture de session, qui ne charge aucun gestionnaire de balises ni code publicitaire.",
  consentTwo:
    "Nous n'exploitons aucun réseau publicitaire sur le site, n'intégrons aucun dispositif de suivi des médias sociaux et ne vendons ni ne louons jamais vos données. Les tiers du produit sont les sous-traitants qui le font fonctionner, notamment le fournisseur téléphonique, les paiements, l'hébergement, le courriel, la surveillance des erreurs et les analyses. Chacun figure sur notre {subprocessors} et est limité à ce que son travail exige.",
  analytics:
    "Indépendamment des mesures facultatives ci-dessus, nous observons quelles fonctions du produit sont utilisées afin de les améliorer. Ces analyses sont configurées sans témoins : elles conservent leur état dans le stockage local du navigateur, enregistrent seulement des événements d'utilisation comme les pages vues, les fonctions choisies et les quantités, puis retirent le contenu des messages, les noms, les adresses et les numéros de téléphone avant tout envoi. Le trafic public demeure anonyme; un profil existe seulement après l'ouverture de session d'un espace de travail, et il est lié à l'identifiant interne de cet espace, jamais à vous personnellement. L'outil est nommé sur notre {subprocessors}.",
  storageOne:
    "Certaines commodités se trouvent dans le stockage local de votre navigateur, qui reste sur votre appareil et ne nous est jamais envoyé comme un témoin : votre choix de pays sur les pages publiques, une inscription en cours afin qu'une actualisation ne vous fasse pas perdre votre place et l'état des analyses sans témoins ci-dessus. La suppression des données du site dans votre navigateur efface tout cela. Aucun de ces éléments ne contient de message ni de coordonnées.",
  storageTwo:
    "Un autre élément existe seulement si vous arrivez par le lien de recommandation de quelqu'un : nous conservons le code du lien afin de reconnaître la personne qui vous a présenté Loonext si vous vous inscrivez. Ce code identifie son espace de travail, pas vous. Il ne s'agit pas d'un identifiant publicitaire, aucun réseau publicitaire ne peut le lire, et il est oublié après 30 jours ou dès la création de votre espace de travail, selon la première éventualité.",
  choicesIntro:
    "Vous gardez le contrôle et pouvez changer d'avis en un seul geste. Voici votre choix actuel concernant les témoins facultatifs, que vous pouvez modifier ici en tout temps :",
  choicesNoScript:
    "Lorsque JavaScript est désactivé, il n'y a rien à changer : le gestionnaire de balises ne se charge jamais et aucun témoin facultatif n'est placé.",
  choicesBrowser:
    "Votre navigateur peut aussi bloquer ou supprimer les témoins et le stockage local en tout temps, pour un seul site ou pour tous. Si vous bloquez les témoins essentiels, l'application ne pourra pas garder votre session ouverte; les pages publiques fonctionnent dans tous les cas.",
  contact:
    "Des questions sur ce que nous conservons ou une demande concernant vos données? Écrivez à {supportEmail} et consultez la {privacy} pour savoir comment nous traitons l'ensemble des renseignements personnels.",
};

const COPY = { en: legalCookiesEn, "fr-CA": legalCookiesFr } as const;

export function legalCookiesCopy(locale: MarketingLocale = "en") {
  return COPY[locale] ?? legalCookiesEn;
}
