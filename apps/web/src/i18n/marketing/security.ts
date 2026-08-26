import type { Translated } from "../translated";

import type { MarketingLocale } from "./footer";

export const securityEn = {
  metadataTitle: "Security",
  metadataDescription:
    "How Loonext protects your data, in plain terms: encryption in transit and at rest, message content kept out of analytics and error logs, data stored in the United States, sub-processors listed publicly, and documented 30-day data handling on cancellation.",
  home: "Home",
  breadcrumb: "Security",
  dateline: "ENCRYPTED IN TRANSIT AND AT REST",
  title: "Security, in plain terms.",
  introBefore:
    "Every item on this page is something the product does today. No certifications we don't hold, and questions go to a person:",
  claimEncryptionTitle: "Encrypted in transit and at rest",
  claimEncryptionBody:
    "Traffic to Loonext runs over HTTPS/TLS, and your data, the messages, contacts, and attachments, is encrypted at rest by our infrastructure providers. Message attachments live in a private, per-business storage bucket and are served only through short-lived signed links.",
  claimLogsTitle: "Message content stays out of analytics and error logs",
  claimLogsBody:
    "We keep message content, names, addresses, and phone numbers out of our error monitoring (Sentry) and product analytics (PostHog). Error reports strip request and response bodies and redact phone-number patterns; analytics record events, counts, and IDs only, never message text.",
  claimRegionTitle: "Your data is stored in the United States",
  claimRegionBefore:
    "Loonext processes and stores data in the United States: our database, authentication, and file storage run on Supabase in the AWS",
  claimRegionAfter: "region. How we handle personal information is in our",
  privacyLink: "privacy policy",
  claimSubprocessorsTitle: "Sub-processors listed publicly",
  claimSubprocessorsBefore:
    "Every vendor that processes data on our behalf, what it touches, and the region it operates in is on our",
  subprocessorsLink: "sub-processors page",
  claimSubprocessorsAfter:
    "When a vendor changes, that page and its date change with it.",
  claimDeletionTitle: "30-day data handling on cancellation, as documented",
  claimDeletionBefore:
    "Cancel and your number is held for 30 days, then released. Account and message data is kept afterward only as long as legal, tax, and carrier record-keeping duties require, then deleted or anonymized, exactly as documented in our",
  termsLink: "terms",
  and: "and",
  claimDeletionMiddle:
    "What is erased, what survives and why, and what closing a workspace does not reach are set out in full on",
  deletionLink: "deletion and what we keep",
  mechanicsTitle: "The mechanics behind those claims.",
  tenantTitle: "Every business is an isolated tenant",
  tenantBody:
    "Each database query is scoped to one business by its ID, and that scoping is where the isolation lives: the API authorizes every request itself. Postgres row-level security is enabled deny-by-default on every table underneath it, which stops anything reaching the database outside the API, though it does not second-guess the API's own queries. One business never sees another's conversations, contacts, or numbers. Realtime updates are gated the same way: you only join your own company's channel.",
  webhooksTitle: "Signed webhooks, verified on arrival",
  webhooksBody:
    "Texts and payments reach us through webhooks, and we verify every one cryptographically before acting on it: Ed25519 signatures on carrier events, HMAC signatures on payment events. Anything that doesn't check out is rejected. A signature is the webhook's only way in.",
  keysTitle: "Least-privilege keys and secrets",
  keysBody:
    "Server credentials are stored as encrypted secrets, never in the code or the repo. Payment access uses a restricted key limited to what billing needs; database access uses an independently revocable key. The browser only ever receives the minimal public configuration it needs.",
  abuseTitle: "Abuse defenses built in",
  abuseBody:
    "Outbound texting is restricted to US and Canadian destinations, rate-limited per business, and bounded by a spending cap you control, layered defenses against SMS pumping and runaway bills. Opt-outs are enforced automatically at send time.",
  breachTitle: "If there is ever a breach",
  breachBody:
    "We will tell you. If a breach of security safeguards creates a real risk of significant harm, PIPEDA and Law 25 require us to notify the affected people and the regulators as soon as feasible, and we treat that as a floor rather than a target: our commitment is to notify affected workspaces within 72 hours of confirming a breach, with what we know at that point rather than waiting for a complete picture. Where we are a processor for your data, we notify you and you notify your own customers. The timeline above is when you hear from us.",
  missingTitle: "What we do not have",
  missingBody:
    "No SOC 2, no ISO 27001, and no third-party penetration test. Saying so is the point: those take a company larger than this one, and a page that implied otherwise would be the least trustworthy thing on it. What stands in their place is everything above, specific and checkable and true today, plus a public sub-processor list and a repository anybody can read. If a certification is a hard requirement for you, we are not there yet, and we would rather you learn that here than three weeks into a procurement.",
  certificationsTitle: "Certifications: we hold none",
  certificationsBody:
    "No SOC 2, no ISO 27001, and none in progress. A Type II report is an observation window plus an auditor, and buying one now would describe controls around a product that still changes weekly. We would rather spend that on the things above, which are true today and which you can check.",
  certificationsSignal:
    "If your procurement needs one, tell us. That is the signal we watch for, and it is a better one than a date we picked ourselves.",
  disclosureTitle: "Responsible disclosure",
  disclosureBefore: "Found a vulnerability? We want to hear from you. Email",
  disclosureAfter:
    "with the details and steps to reproduce. Please give us a reasonable chance to fix the issue before disclosing it publicly, and don't access or modify data that isn't yours while testing. We acknowledge every report within two business days and tell you what we intend to do about it; you will hear from a person, not a form. There is no bounty. Saying so up front is fairer than letting you find out after the work.",
} as const;

export const securityFr: Translated<typeof securityEn> = {
  metadataTitle: "Sécurité",
  metadataDescription:
    "Comment Loonext protège vos données : chiffrement en transit et au repos, contenu des messages exclu des analyses et journaux d'erreurs, données stockées aux États-Unis, sous-traitants publiés et traitement documenté pendant 30 jours après l'annulation.",
  home: "Accueil",
  breadcrumb: "Sécurité",
  dateline: "CHIFFRÉ EN TRANSIT ET AU REPOS",
  title: "La sécurité, en termes clairs.",
  introBefore:
    "Chaque élément de cette page décrit ce que le produit fait aujourd'hui. Aucune certification que nous ne détenons pas, et vos questions vont à une personne :",
  claimEncryptionTitle: "Chiffré en transit et au repos",
  claimEncryptionBody:
    "Le trafic vers Loonext passe par HTTPS/TLS. Vos données, y compris les messages, contacts et pièces jointes, sont chiffrées au repos par nos fournisseurs d'infrastructure. Les pièces jointes vivent dans un espace de stockage privé propre à chaque entreprise et ne sont servies qu'au moyen de liens signés de courte durée.",
  claimLogsTitle:
    "Le contenu des messages reste hors des analyses et des journaux d'erreurs",
  claimLogsBody:
    "Nous excluons le contenu des messages, les noms, les adresses et les numéros de téléphone de la surveillance des erreurs (Sentry) et de l'analyse du produit (PostHog). Les rapports d'erreur retirent le corps des requêtes et réponses et masquent les formes de numéros; les analyses enregistrent seulement des événements, des comptes et des identifiants, jamais le texte des messages.",
  claimRegionTitle: "Vos données sont stockées aux États-Unis",
  claimRegionBefore:
    "Loonext traite et stocke les données aux États-Unis : la base de données, l'authentification et les fichiers fonctionnent sur Supabase dans la région AWS",
  claimRegionAfter:
    "Notre façon de traiter les renseignements personnels est décrite dans notre",
  privacyLink: "politique de confidentialité (en anglais)",
  claimSubprocessorsTitle: "La liste des sous-traitants est publique",
  claimSubprocessorsBefore:
    "Chaque fournisseur qui traite des données pour nous, les données touchées et sa région d'exploitation figurent sur notre",
  subprocessorsLink: "page des sous-traitants",
  claimSubprocessorsAfter:
    "Lorsqu'un fournisseur change, cette page et sa date changent aussi.",
  claimDeletionTitle:
    "Traitement documenté des données pendant 30 jours après l'annulation",
  claimDeletionBefore:
    "Après l'annulation, votre numéro est conservé 30 jours puis libéré. Les données du compte et des messages ne sont ensuite gardées que pendant la durée exigée par les obligations légales, fiscales et celles des fournisseurs, puis supprimées ou anonymisées, exactement comme le décrivent nos",
  termsLink: "conditions d'utilisation (en anglais)",
  and: "et notre",
  claimDeletionMiddle:
    "Ce qui est effacé, ce qui demeure, pourquoi, et ce que la fermeture d'un espace de travail ne peut pas atteindre sont expliqués sur la page",
  deletionLink: "suppression des données et conservation",
  mechanicsTitle: "Les mécanismes derrière ces affirmations.",
  tenantTitle: "Chaque entreprise est un locataire isolé",
  tenantBody:
    "Chaque requête à la base de données est limitée à l'identifiant d'une seule entreprise, et c'est là que vit l'isolation : l'API autorise elle-même chaque demande. La sécurité au niveau des lignes de Postgres est activée par défaut en mode refus sur toutes les tables, ce qui bloque tout accès à la base hors de l'API, sans toutefois revérifier les propres requêtes de l'API. Une entreprise ne voit jamais les conversations, contacts ou numéros d'une autre. Les mises à jour en temps réel sont protégées de la même façon : vous ne rejoignez que le canal de votre entreprise.",
  webhooksTitle: "Webhooks signés et vérifiés à l'arrivée",
  webhooksBody:
    "Les textos et paiements nous parviennent par webhook, et nous vérifions cryptographiquement chacun d'eux avant d'agir : signatures Ed25519 pour les événements du fournisseur et signatures HMAC pour les paiements. Tout ce qui échoue à la vérification est refusé. Une signature est la seule porte d'entrée d'un webhook.",
  keysTitle: "Clés et secrets au privilège minimal",
  keysBody:
    "Les identifiants du serveur sont conservés comme secrets chiffrés, jamais dans le code ni le dépôt. L'accès aux paiements utilise une clé restreinte à la facturation; l'accès à la base utilise une clé indépendante et révocable. Le navigateur ne reçoit que la configuration publique minimale dont il a besoin.",
  abuseTitle: "Défenses intégrées contre les abus",
  abuseBody:
    "Les textos sortants sont limités aux destinations américaines et canadiennes, soumis à une limite de débit par entreprise et bornés par un plafond de dépenses que vous contrôlez. Ces couches protègent contre le pompage de SMS et les factures incontrôlées. Les désabonnements sont appliqués automatiquement au moment de l'envoi.",
  breachTitle: "S'il y a un jour une atteinte",
  breachBody:
    "Nous vous le dirons. Lorsqu'une atteinte aux mesures de sécurité crée un risque réel de préjudice grave, la LPRPDE et la Loi 25 nous obligent à aviser les personnes touchées et les organismes de réglementation dès que possible. Nous considérons cette exigence comme un minimum : nous nous engageons à prévenir les espaces de travail touchés dans les 72 heures suivant la confirmation d'une atteinte, avec ce que nous savons alors plutôt que d'attendre un portrait complet. Lorsque nous traitons vos données pour vous, nous vous avisons et vous avisez vos propres clients. Le délai ci-dessus est celui dans lequel vous aurez de nos nouvelles.",
  missingTitle: "Ce que nous n'avons pas",
  missingBody:
    "Aucune certification SOC 2 ou ISO 27001 et aucun test d'intrusion par une tierce partie. Le dire est le but : ces démarches demandent une entreprise plus grande, et une page qui laisserait croire le contraire serait la moins digne de confiance. Elles sont remplacées ici par des mesures précises, vérifiables et vraies aujourd'hui, une liste publique de sous-traitants et un dépôt que tout le monde peut lire. Si une certification est obligatoire pour vous, nous n'y sommes pas encore et préférons que vous l'appreniez ici plutôt qu'après trois semaines d'approvisionnement.",
  certificationsTitle: "Certifications : nous n'en détenons aucune",
  certificationsBody:
    "Aucune SOC 2, aucune ISO 27001 et aucune en cours. Un rapport de type II exige une période d'observation et un auditeur; en acheter un maintenant décrirait des contrôles autour d'un produit qui change encore chaque semaine. Nous préférons investir dans les mesures ci-dessus, vraies aujourd'hui et vérifiables.",
  certificationsSignal:
    "Si votre approvisionnement en exige une, dites-le-nous. C'est le signal que nous suivons, et il vaut mieux qu'une date choisie par nous-mêmes.",
  disclosureTitle: "Divulgation responsable",
  disclosureBefore:
    "Vous avez trouvé une vulnérabilité? Nous voulons vous lire. Écrivez à",
  disclosureAfter:
    "avec les détails et les étapes pour la reproduire. Donnez-nous une occasion raisonnable de corriger le problème avant de le rendre public, et n'accédez pas aux données qui ne sont pas les vôtres pendant vos essais. Nous accusons réception de chaque signalement dans les deux jours ouvrables et vous expliquons ce que nous comptons faire; une personne vous répondra, pas un formulaire. Il n'y a pas de prime. Le dire d'avance est plus juste que de vous laisser l'apprendre après le travail.",
};

const COPY = { en: securityEn, "fr-CA": securityFr } as const;

export function securityCopy(locale: MarketingLocale = "en") {
  return COPY[locale] ?? securityEn;
}
