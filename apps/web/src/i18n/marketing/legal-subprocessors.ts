import type { Translated } from "../translated";

import type { MarketingLocale } from "./footer";

export const legalSubprocessorsEn = {
  metaTitle: "Sub-processors",
  metaDescription:
    "The third-party vendors Loonext uses to run the service, what each one processes, and the region it operates in, from the SMS carrier to payments, hosting, email, and analytics.",
  title: "Sub-processors",
  breadcrumbLabel: "Sub-processors",
  lastUpdated: "July 30, 2026",
  summary:
    "{vendorCount} vendors process data on our behalf so Loonext can run, from the SMS carrier to payments, hosting, email, and analytics. Each is limited to what its job requires, and message content stays out of our error and analytics tools. {featureCount} features send message content or voicemail audio to an AI model, and they are named in full below. Data lives in the United States, with one named exception: AI inference runs on Cloudflare's global network and cannot be confined to a country. When this list changes, this page and the date above change with it.",
  sectionList: "Current sub-processors",
  sectionAi: "AI features",
  sectionChanges: "Changes",
  sectionContact: "Contact",
  columnVendor: "Vendor",
  columnPurpose: "What it does",
  columnData: "Data it touches",
  columnRegion: "Region",
  telnyxPurpose: "SMS/MMS carriage, phone numbers, 10DLC registration",
  telnyxData:
    "Message content, contact phone numbers, business registration details",
  telnyxRegion: "United States",
  stripePurpose: "Subscription payments, tax calculation, billing portal",
  stripeData:
    "Billing contact, subscription and payment identifiers, tax location",
  stripeRegion: "United States",
  supabasePurpose: "Database, authentication, and file storage",
  supabaseData: "All account, contact, and message data; MMS attachments",
  supabaseRegion: "United States. AWS us-east-1",
  cloudflareNote: "including Workers AI",
  cloudflarePurpose:
    "Application hosting, CDN, network security, and AI features",
  cloudflareData:
    "Request metadata (IP, headers); message content and voicemail audio sent to Workers AI for the features listed below",
  cloudflareRegion:
    "Global edge network. AI inference is not confined to any one country (see below)",
  resendPurpose: "Transactional email (notifications, billing, invites)",
  resendData: "Recipient email address and email content",
  resendRegion: "United States",
  firebasePurpose: "Push notifications to the Android and iPhone apps",
  firebaseData:
    "Device push tokens; the notification preview, which contains the sender name and a short message excerpt",
  firebaseRegion:
    "United States. Relayed on to Apple's push service for iPhones",
  sentryPurpose: "Error monitoring",
  sentryData:
    "Error diagnostics with PII scrubbed, no message bodies or phone numbers",
  sentryRegion: "United States",
  posthogPurpose: "Product analytics (events only)",
  posthogData:
    "Event names, counts, and UUIDs, no message content; cookieless on marketing pages",
  posthogRegion: "United States",
  listNote:
    "Data lives primarily in the United States (Supabase on AWS `us-east-1`). We keep message content out of Sentry and PostHog by design, see our {security} and {privacy}.",
  securityLink: "security page",
  privacyLink: "privacy policy",
  aiIntro:
    "{featureCount} features send content to an AI model. All of them run on Cloudflare Workers AI, inside the same Cloudflare account and network boundary as the rest of the application, which is why Cloudflare appears once above rather than twice. What each one sends, and the model that receives it:",
  columnFeature: "Feature",
  columnSends: "What it sends",
  columnModel: "Model",
  columnDefault: "On by default",
  yes: "Yes",
  no: "No",
  modelVendorPrefix: "Models by publisher:",
  modelVendorAfter:
    "They run on Cloudflare's infrastructure under Cloudflare's terms; we do not send your data to those companies directly. We name them because who wrote the model is something you would reasonably want to know before a customer's voicemail is transcribed by it.",
  whereLabel: "Where this happens.",
  whereAfter:
    "Everything else on the list above stays where its row says: your database, files and backups are in the United States. {source} is the source, read {verifiedDate}.",
  sourceLink: "Cloudflare's compatibility list",
  verifiedDate: "2026-07-30",
  trainingBefore: "On training, Cloudflare's published Workers AI policy states:",
  trainingAfter:
    "We do not use message content or voicemail audio to train anything either. Transcripts and drafts are stored in your workspace like any other message data, and are deleted with it.",
  trainingGloss: "",
  aiControls:
    "Every one of these features can be turned off for your whole workspace in Settings, and each has a monthly ceiling.",
  changes:
    "If we add or replace a sub-processor, we'll update this page and the date above. This list is the authoritative record of who processes data for Loonext.",
  contact:
    "Questions about our sub-processors or data handling? Email {privacyEmail}.",
} as const;

export const legalSubprocessorsFr: Translated<typeof legalSubprocessorsEn> = {
  metaTitle: "Sous-traitants",
  metaDescription:
    "Les fournisseurs tiers que Loonext utilise pour exploiter le service, les données que chacun traite et la région où il exerce ses activités, du transport des textos aux paiements, à l'hébergement, au courriel et aux analyses.",
  title: "Sous-traitants",
  breadcrumbLabel: "Sous-traitants",
  lastUpdated: "30 juillet 2026",
  summary:
    "{vendorCount} fournisseurs traitent des données en notre nom pour faire fonctionner Loonext, du transport des textos aux paiements, à l'hébergement, au courriel et aux analyses. Chacun est limité à ce que son travail exige, et le contenu des messages reste hors de nos outils d'erreurs et d'analyse. {featureCount} fonctions envoient du contenu de message ou de l'audio de messagerie vocale à un modèle d'IA; elles sont toutes nommées ci-dessous. Les données résident aux États-Unis, à une exception près : l'inférence de l'IA s'exécute sur le réseau mondial de Cloudflare et ne peut pas être confinée à un pays. Lorsque cette liste change, cette page et la date ci-dessus changent aussi.",
  sectionList: "Sous-traitants actuels",
  sectionAi: "Fonctions d'IA",
  sectionChanges: "Modifications",
  sectionContact: "Nous joindre",
  columnVendor: "Fournisseur",
  columnPurpose: "Ce qu'il fait",
  columnData: "Données traitées",
  columnRegion: "Région",
  telnyxPurpose: "Transport des SMS et MMS, numéros de téléphone et inscription 10DLC",
  telnyxData:
    "Contenu des messages, numéros de téléphone des contacts et renseignements d'inscription de l'entreprise",
  telnyxRegion: "États-Unis",
  stripePurpose: "Paiements d'abonnement, calcul des taxes et portail de facturation",
  stripeData:
    "Coordonnées de facturation, identifiants d'abonnement et de paiement, et lieu fiscal",
  stripeRegion: "États-Unis",
  supabasePurpose: "Base de données, authentification et stockage de fichiers",
  supabaseData:
    "Toutes les données de compte, de contact et de message; pièces jointes MMS",
  supabaseRegion: "États-Unis. AWS us-east-1",
  cloudflareNote: "y compris Workers AI",
  cloudflarePurpose:
    "Hébergement de l'application, réseau de diffusion, sécurité réseau et fonctions d'IA",
  cloudflareData:
    "Métadonnées des requêtes (adresse IP et en-têtes); contenu des messages et audio de messagerie vocale envoyés à Workers AI pour les fonctions ci-dessous",
  cloudflareRegion:
    "Réseau périphérique mondial. L'inférence de l'IA n'est confinée à aucun pays (voir ci-dessous)",
  resendPurpose: "Courriels transactionnels (avis, facturation et invitations)",
  resendData: "Adresse du destinataire et contenu du courriel",
  resendRegion: "États-Unis",
  firebasePurpose: "Notifications poussées vers les applications Android et iPhone",
  firebaseData:
    "Jetons de notification des appareils; aperçu de la notification contenant le nom de l'expéditeur et un court extrait du message",
  firebaseRegion:
    "États-Unis. Transmis au service de notifications poussées d'Apple pour les iPhone",
  sentryPurpose: "Surveillance des erreurs",
  sentryData:
    "Diagnostics d'erreur dont les renseignements personnels ont été retirés, sans corps de message ni numéro de téléphone",
  sentryRegion: "États-Unis",
  posthogPurpose: "Analyse du produit (seulement des événements)",
  posthogData:
    "Noms d'événements, quantités et UUID, sans contenu de message; sans témoins sur les pages publiques",
  posthogRegion: "États-Unis",
  listNote:
    "Les données résident principalement aux États-Unis (Supabase sur AWS `us-east-1`). Nous gardons volontairement le contenu des messages hors de Sentry et de PostHog; consultez notre {security} et notre {privacy}.",
  securityLink: "page sur la sécurité",
  privacyLink: "politique de confidentialité",
  aiIntro:
    "{featureCount} fonctions envoient du contenu à un modèle d'IA. Elles s'exécutent toutes sur Cloudflare Workers AI, dans le même compte Cloudflare et la même limite réseau que le reste de l'application; Cloudflare figure donc une seule fois ci-dessus. Voici ce que chaque fonction envoie et le modèle qui le reçoit :",
  columnFeature: "Fonction",
  columnSends: "Ce qu'elle envoie",
  columnModel: "Modèle",
  columnDefault: "Activée par défaut",
  yes: "Oui",
  no: "Non",
  modelVendorPrefix: "Modèles par éditeur :",
  modelVendorAfter:
    "Ces modèles s'exécutent sur l'infrastructure de Cloudflare selon ses conditions; nous n'envoyons pas directement vos données aux entreprises qui les ont publiés. Nous les nommons parce qu'il est raisonnable de vouloir savoir qui a créé le modèle avant qu'il transcrive la messagerie vocale d'un client.",
  whereLabel: "Où cela se produit.",
  whereAfter:
    "Tout le reste de la liste demeure dans la région indiquée à sa ligne : votre base de données, vos fichiers et vos sauvegardes sont aux États-Unis. La {source} est notre source, consultée le {verifiedDate}.",
  sourceLink: "liste de compatibilité de Cloudflare",
  verifiedDate: "30 juillet 2026",
  trainingBefore:
    "Concernant l'entraînement, la politique publiée de Cloudflare sur Workers AI affirme, en anglais :",
  trainingAfter:
    "Nous n'utilisons pas non plus le contenu des messages ni l'audio de messagerie vocale pour entraîner quoi que ce soit. Les transcriptions et les brouillons sont conservés dans votre espace de travail comme les autres données de message, puis supprimés avec lui.",
  trainingGloss:
    "En français : Cloudflare n'utilise pas le contenu de ses clients pour entraîner les modèles offerts dans Workers AI ni pour améliorer ses services ou ceux de tiers.",
  aiControls:
    "Chacune de ces fonctions peut être désactivée pour tout votre espace de travail dans Paramètres, et chacune possède un plafond mensuel.",
  changes:
    "Si nous ajoutons ou remplaçons un sous-traitant, nous mettrons à jour cette page et la date ci-dessus. Cette liste est le registre officiel des organisations qui traitent des données pour Loonext.",
  contact:
    "Des questions sur nos sous-traitants ou le traitement des données? Écrivez à {privacyEmail}.",
};

const COPY = { en: legalSubprocessorsEn, "fr-CA": legalSubprocessorsFr } as const;

export function legalSubprocessorsCopy(locale: MarketingLocale = "en") {
  return COPY[locale] ?? legalSubprocessorsEn;
}
