import type { Locale } from "./locale";
import type { SettingsSectionId } from "./settings-visibility";

/**
 * #719: every setting, findable by what a person would type.
 *
 * One entry per setting card on a settings page. `anchor` is the DOM id on the
 * card, so a result opens the right page and scrolls to the setting. The first
 * word of each list is the label shown in a result; the rest are synonyms
 * ("tz" finds the time zone, "quiet" finds quiet hours). A web guard test
 * fails when an anchor is not an `id` on a settings page, is used twice, or
 * a card on a settings page is missing from this list.
 */
export interface SettingsIndexEntry {
  id: string;
  section: SettingsSectionId;
  anchor: string;
  /** The slug of the page when the section has more than one. */
  page?: string;
  en: readonly string[];
  fr: readonly string[];
}

function entry(
  section: SettingsSectionId,
  anchor: string,
  en: readonly string[],
  fr: readonly string[],
  page?: string,
): SettingsIndexEntry {
  // Both languages are required to build a row, so no setting can ship in one.
  const words: Record<Locale, readonly string[]> = { en, "fr-CA": fr };
  return {
    id: `${section}:${anchor}`,
    section,
    anchor,
    en: words.en,
    fr: words["fr-CA"],
    ...(page ? { page } : {}),
  };
}

export const SETTINGS_INDEX: readonly SettingsIndexEntry[] = [
  // Workspace
  entry("workspace", "workspace-name",
    ["Company name", "business name", "workspace name", "rename", "logo", "brand", "branding", "name"],
    ["Nom de l'entreprise", "nom du commerce", "nom de l'espace", "renommer", "logo", "marque", "image de marque"]),
  entry("workspace", "business-identification",
    ["Business identification", "legal name", "ein", "business number", "address", "website", "registration", "brand"],
    ["Identification de l'entreprise", "nom légal", "numéro d'entreprise", "adresse", "site web", "enregistrement", "marque"]),
  entry("workspace", "time-zone",
    ["Time zone", "timezone", "tz", "clock", "hours", "quiet", "region"],
    ["Fuseau horaire", "heure", "horloge", "heures", "fuseau", "région"]),
  entry("workspace", "signature",
    ["Sign your texts", "signature", "sign off", "company name in texts", "name on texts"],
    ["Signer vos textos", "signature", "nom dans les textos"]),
  entry("workspace", "night-texting",
    ["Texting a new customer at night", "night", "quiet hours", "after hours", "late texts", "overnight"],
    ["Textos aux nouveaux clients la nuit", "nuit", "heures de silence", "après les heures", "tard"]),
  entry("workspace", "language",
    ["Language", "french", "english", "locale", "translate", "francais"],
    ["Langue", "français", "anglais", "traduire", "english"]),
  entry("workspace", "contact-fields",
    ["Contact fields", "custom fields", "extra fields", "customer fields", "properties"],
    ["Champs de contact", "champs personnalisés", "champs", "propriétés"]),
  entry("workspace", "export-data",
    ["Export your data", "download data", "backup", "csv", "export"],
    ["Exporter vos données", "télécharger", "sauvegarde", "csv", "exportation"]),
  entry("workspace", "leave-workspace",
    ["Leave this workspace", "quit", "exit", "leave"],
    ["Quitter cet espace", "partir", "quitter"]),
  entry("workspace", "close-workspace",
    ["Close this workspace", "delete workspace", "cancel everything", "shut down", "close"],
    ["Fermer cet espace", "supprimer l'espace", "tout fermer", "fermeture"]),

  // Team
  entry("team", "team-invites",
    ["Invites", "invite", "add a teammate", "add member", "invitation"],
    ["Invitations", "inviter", "ajouter un coéquipier", "ajouter un membre"]),
  entry("team", "team-members",
    ["Members", "team", "crew", "roles", "admins", "remove member", "permissions", "staff"],
    ["Membres", "équipe", "rôles", "administrateurs", "retirer un membre", "permissions", "personnel"]),
  entry("team", "ownership",
    ["Ownership", "owner", "transfer ownership", "hand over", "succession"],
    ["Propriété", "propriétaire", "transférer la propriété", "céder", "succession"]),
  entry("team", "require-two-factor",
    ["Require two-factor for everyone", "2fa", "mfa", "security", "two step", "authenticator"],
    ["Exiger la double authentification", "2fa", "mfa", "sécurité", "deux étapes"]),

  // Numbers
  entry("numbers", "numbers-list",
    ["Your numbers", "number hours", "hours for a number", "time zone for a number", "number name", "caller id", "buy a number", "phone number", "line"],
    ["Vos numéros", "heures d'un numéro", "fuseau horaire d'un numéro", "nom du numéro", "acheter un numéro", "téléphone", "ligne"]),
  entry("numbers", "lead-sources",
    ["Where customers come from", "lead sources", "source", "referral source", "marketing", "attribution"],
    ["D'où viennent les clients", "sources de clients", "source", "marketing", "attribution"]),
  entry("numbers", "my-access",
    ["What you can reach", "my numbers", "my access", "which numbers", "access"],
    ["Ce que vous pouvez joindre", "mes numéros", "mon accès", "accès"]),
  entry("numbers", "number-transfers",
    ["Number transfers", "port", "transfer a number", "move number", "porting", "carrier"],
    ["Transferts de numéro", "portabilité", "transférer un numéro", "déménager un numéro", "fournisseur"]),
  entry("numbers", "port-number",
    ["Bring your existing number", "port in", "keep my number", "existing number", "switch carrier"],
    ["Apportez votre numéro actuel", "garder mon numéro", "numéro existant", "changer de fournisseur"]),
  entry("numbers", "us-texting",
    ["US texting", "canada to us", "american texting", "texting in the us", "enable us"],
    ["Textos aux États-Unis", "textos américains", "activer les États-Unis"]),
  entry("numbers", "us-registration",
    ["US texting registration", "10dlc", "a2p", "brand registration", "campaign", "carrier approval", "verification"],
    ["Enregistrement des textos américains", "10dlc", "a2p", "approbation", "vérification"]),
  entry("numbers", "hosted-numbers",
    ["Text-enabled numbers", "landline", "text enable", "hosted number", "keep my landline"],
    ["Numéros avec textos", "ligne fixe", "activer les textos", "numéro hébergé"]),
  entry("numbers", "text-enable",
    ["Text-enable your existing landline", "landline texting", "add texting to landline"],
    ["Activer les textos sur votre ligne fixe", "textos sur ligne fixe"]),
  entry("numbers", "website-widget",
    ["Text us button for your website", "website widget", "web chat", "embed", "button", "site"],
    ["Bouton Textez-nous pour votre site", "widget", "clavardage", "intégrer", "bouton", "site web"]),

  // Hours
  entry("hours", "business-hours",
    ["Business hours", "hours", "open", "schedule", "time zone", "timezone", "opening hours", "weekly hours"],
    ["Heures d'ouverture", "heures", "horaire", "fuseau horaire", "heures d'affaires"],
    "away-reply"),
  entry("hours", "away-reply",
    ["Away reply", "auto reply", "after hours reply", "out of office", "vacation", "autoresponder"],
    ["Réponse d'absence", "réponse automatique", "hors des heures", "vacances", "absence"],
    "away-reply"),
  entry("hours", "closed-dates",
    ["Closed dates", "holidays", "days off", "vacation", "time zone", "closure", "stat holiday"],
    ["Dates de fermeture", "jours fériés", "congés", "vacances", "fuseau horaire", "fermeture"],
    "away-reply"),
  entry("hours", "emergency-words",
    ["Emergency words and reply", "urgent", "keywords", "emergency", "flood", "burst pipe"],
    ["Mots d'urgence et réponse", "urgence", "mots-clés", "urgent"],
    "away-reply"),
  entry("hours", "on-call",
    ["On call", "after hours calls", "tonight", "who is on call", "rotation", "duty"],
    ["De garde", "garde", "ce soir", "qui est de garde", "rotation"],
    "away-reply"),
  entry("hours", "appointment-reminders",
    ["Appointment reminders", "reminders", "confirm appointment", "reminder text", "booking"],
    ["Rappels de rendez-vous", "rappels", "confirmer un rendez-vous", "réservation"],
    "away-reply"),
  entry("hours", "auto-text-reply",
    ["If the customer replies first", "automatic texts", "auto text", "first reply", "auto reply"],
    ["Si le client répond en premier", "textos automatiques", "première réponse"],
    "automatic-texts"),
  entry("hours", "auto-text-rating",
    ["Rating question after a job", "review request", "rating", "feedback", "stars", "reviews", "survey"],
    ["Question de notation après un travail", "demande d'avis", "note", "évaluation", "étoiles", "avis", "sondage"],
    "automatic-texts"),
  entry("hours", "auto-text-wait",
    ["How long things wait", "delay", "wait time", "timing", "follow up delay"],
    ["Combien de temps les choses attendent", "délai", "temps d'attente", "relance"],
    "automatic-texts"),

  // Calling
  entry("calling", "missed-call-text-back",
    ["Text back a missed call", "missed call", "text back", "auto text missed", "mctb"],
    ["Texto après un appel manqué", "appel manqué", "texto de rappel", "rappeler"]),
  entry("calling", "voicemail",
    ["Voicemail", "greeting", "transcript", "message box", "answering machine"],
    ["Messagerie vocale", "message d'accueil", "transcription", "boîte vocale", "répondeur"]),
  entry("calling", "call-screening",
    ["Call screening", "spam calls", "robocalls", "block calls", "screen", "unknown callers"],
    ["Filtrage des appels", "appels indésirables", "bloquer les appels", "appelants inconnus"]),
  entry("calling", "caller-id",
    ["Caller ID", "cnam", "outgoing name", "business name on calls", "display name on calls"],
    ["Identification de l'appelant", "cnam", "nom affiché", "nom sur les appels"]),
  entry("calling", "after-hours-calls",
    ["After hours calls", "calls at night", "forward after hours", "closed calls"],
    ["Appels après les heures", "appels la nuit", "transfert après les heures"]),
  entry("calling", "voice-greeting",
    ["Your own voice", "record greeting", "custom greeting", "voicemail greeting", "recording"],
    ["Votre propre voix", "enregistrer un message", "message d'accueil personnalisé", "enregistrement"]),
  entry("calling", "phone-ringing",
    ["How the phones ring", "ring", "ring order", "forward calls", "who answers", "ring group", "simultaneous"],
    ["Comment les téléphones sonnent", "sonnerie", "ordre de sonnerie", "transférer les appels", "qui répond"]),

  // Templates
  entry("templates", "templates-list",
    ["Templates", "quick replies", "canned replies", "snippets", "saved replies", "macros"],
    ["Modèles", "réponses rapides", "réponses préenregistrées", "extraits", "macros"]),
  entry("templates", "tags",
    ["Tags", "labels", "categories", "colors"],
    ["Étiquettes", "libellés", "catégories", "couleurs"]),
  entry("templates", "tag-lock",
    ["Who can create tags", "tag permissions", "lock tags", "restrict tags"],
    ["Qui peut créer des étiquettes", "permissions des étiquettes", "verrouiller les étiquettes"]),

  // AI
  entry("ai", "ai-task",
    ["When you make a task from a message", "ai tasks", "lou tasks", "task address", "due date", "assistant"],
    ["Quand vous créez une tâche depuis un message", "tâches ia", "adresse de la tâche", "date d'échéance", "assistant"]),
  entry("ai", "ai-business",
    ["What Lou knows about your business", "lou", "ai", "business context", "about my business", "knowledge", "services", "assistant"],
    ["Ce que Lou sait de votre entreprise", "lou", "ia", "contexte", "à propos de mon entreprise", "services", "assistant"]),
  entry("ai", "ai-replies",
    ["When you reply to a customer", "reply drafts", "draft replies", "suggested replies", "lou drafts", "ai"],
    ["Quand vous répondez à un client", "brouillons de réponse", "réponses suggérées", "ia"]),
  entry("ai", "ai-voicemail",
    ["When someone leaves a voicemail", "voicemail summary", "transcribe", "ai voicemail"],
    ["Quand quelqu'un laisse un message vocal", "résumé de messagerie", "transcrire", "ia"]),
  entry("ai", "ai-wrapup",
    ["After a call ends", "call summary", "wrap up", "call notes", "ai notes"],
    ["Après la fin d'un appel", "résumé d'appel", "notes d'appel", "conclusion"]),
  entry("ai", "ai-catchup",
    ["When you come back to a long thread", "catch up", "thread summary", "summarize", "recap"],
    ["Quand vous revenez à une longue conversation", "rattrapage", "résumé de conversation", "résumer"]),

  // Usage
  entry("usage", "usage-this-period",
    ["This period", "usage", "messages used", "fair use", "allowance", "how many texts", "minutes"],
    ["Cette période", "utilisation", "messages utilisés", "utilisation équitable", "combien de textos", "minutes"]),
  entry("usage", "usage-lou",
    ["Lou this month", "lou usage", "ai usage"],
    ["Lou ce mois-ci", "utilisation de lou", "utilisation ia"]),
  entry("usage", "usage-history",
    ["Last 6 months", "usage history", "past usage", "chart", "trend"],
    ["6 derniers mois", "historique d'utilisation", "graphique", "tendance"]),
  entry("usage", "usage-counting",
    ["How messages are counted", "segments", "sms length", "mms", "counting", "billing units"],
    ["Comment les messages sont comptés", "segments", "longueur", "mms", "comptage"]),
  entry("usage", "usage-delivery",
    ["Are your texts arriving?", "delivery", "undelivered", "failed texts", "delivery rate", "carrier blocking"],
    ["Vos textos arrivent-ils ?", "livraison", "non livrés", "textos échoués", "taux de livraison"]),
  entry("usage", "spending-cap",
    ["Spending cap", "limit", "budget", "overage", "max spend", "cap"],
    ["Plafond de dépenses", "limite", "budget", "dépassement", "plafond"]),
  entry("usage", "usage-export",
    ["Export usage", "usage csv", "download usage", "report"],
    ["Exporter l'utilisation", "csv d'utilisation", "télécharger", "rapport"]),

  // Billing
  entry("billing", "subscription",
    ["Subscription", "billing", "plan status", "renewal", "renews", "trial", "upgrade", "downgrade"],
    ["Abonnement", "facturation", "statut du forfait", "renouvellement", "essai", "mise à niveau"]),
  entry("billing", "plan",
    ["Plan", "pricing", "seats", "pick a plan", "change plan", "price"],
    ["Forfait", "tarifs", "sièges", "choisir un forfait", "changer de forfait", "prix"]),
  entry("billing", "payment-invoices",
    ["Payment and invoices", "billing", "credit card", "card", "receipts", "invoice", "billing email", "tax", "payment method"],
    ["Paiement et factures", "facturation", "carte de crédit", "carte", "reçus", "facture", "taxes", "mode de paiement"]),
  entry("billing", "cancel-subscription",
    ["Cancel", "cancel subscription", "stop billing", "end plan", "unsubscribe"],
    ["Annuler", "annuler l'abonnement", "arrêter la facturation", "résilier"]),
  entry("billing", "pause-plan",
    ["Pause your plan", "pause", "seasonal", "winter break", "hold"],
    ["Mettre le forfait en pause", "pause", "saisonnier", "suspendre"]),
  entry("billing", "held-numbers",
    ["Held numbers", "kept numbers", "keep my number", "numbers on hold", "reserved numbers"],
    ["Numéros conservés", "garder mon numéro", "numéros en attente", "numéros réservés"]),
  entry("billing", "off-ramp",
    ["Tell your customers where you went", "closing", "going out of business", "forwarding message", "wind down", "leaving"],
    ["Dites à vos clients où vous êtes allé", "fermeture", "cessation", "message de transfert"]),
  entry("billing", "add-ons",
    ["Add-ons", "modules", "extras", "voice", "canada regions", "addon"],
    ["Modules complémentaires", "modules", "extras", "voix", "régions du canada"]),
  entry("billing", "prepaid-year",
    ["Pay for a year", "annual", "yearly", "prepay", "discount", "your year"],
    ["Payer pour un an", "annuel", "prépayer", "rabais", "votre année"]),
  entry("billing", "referral",
    ["Refer another crew", "referral", "invite a friend", "credit", "refer", "share"],
    ["Recommander une autre équipe", "parrainage", "inviter un ami", "crédit", "recommander"]),

  // Payments
  entry("payments", "payments-setup",
    ["Get paid by text", "payments", "stripe", "text to pay", "payment link", "collect money", "bank account", "invoices", "card payments"],
    ["Se faire payer par texto", "paiements", "stripe", "lien de paiement", "encaisser", "compte bancaire", "factures"]),

  // History
  entry("history", "activity-log",
    ["Activity log", "history", "audit", "who changed", "log", "trash", "deleted", "restore"],
    ["Journal d'activité", "historique", "audit", "qui a modifié", "journal", "corbeille", "supprimé", "restaurer"]),

  // Notifications
  entry("notifications", "notification-types",
    ["When something needs you", "notifications", "alerts", "push", "email alerts", "sounds", "mute"],
    ["Quand quelque chose vous concerne", "notifications", "alertes", "push", "courriels", "sons", "sourdine"]),
  entry("notifications", "delivery-modes",
    ["How alerts reach you", "delivery mode", "digest", "instant", "email or push", "notification delivery"],
    ["Comment les alertes vous joignent", "mode de livraison", "résumé", "instantané", "courriel ou push"]),
  entry("notifications", "quiet-hours-row",
    ["Quiet hours", "do not disturb", "dnd", "night", "silent", "time zone", "sleep", "mute at night"],
    ["Heures de silence", "ne pas déranger", "nuit", "silencieux", "fuseau horaire", "sommeil"]),

  // Profile
  entry("profile", "display-name",
    ["Display name", "my name", "name", "avatar", "photo", "picture"],
    ["Nom affiché", "mon nom", "nom", "avatar", "photo"]),
  entry("profile", "theme",
    ["Theme", "dark mode", "light mode", "appearance", "colors", "night mode"],
    ["Thème", "mode sombre", "mode clair", "apparence", "couleurs", "mode nuit"]),
  entry("profile", "shortcuts",
    ["Keyboard shortcuts", "hotkeys", "keys", "command palette", "shortcut"],
    ["Raccourcis clavier", "touches", "palette de commandes", "raccourci"]),
  entry("profile", "sign-out",
    ["Sign out", "log out", "logout", "leave"],
    ["Se déconnecter", "déconnexion", "quitter"]),
  entry("profile", "calendar-sync",
    ["Two-way calendar sync", "google calendar", "outlook", "calendar connection", "calendar", "time zone", "sync tasks"],
    ["Synchronisation bidirectionnelle du calendrier", "google agenda", "outlook", "connexion au calendrier", "calendrier", "fuseau horaire", "agenda"]),
  entry("profile", "calendar-read-only-feed",
    ["Your schedule in your calendar", "calendar feed", "ics", "subscribe calendar", "apple calendar", "read only calendar"],
    ["Votre horaire dans votre calendrier", "flux de calendrier", "ics", "s'abonner au calendrier", "calendrier en lecture seule"]),

  // Account
  entry("account", "sign-in-methods",
    ["Sign-in methods", "login", "google sign in", "apple sign in", "linked accounts", "passkey", "connected accounts"],
    ["Méthodes de connexion", "connexion", "comptes liés", "clé d'accès", "comptes connectés"]),
  entry("account", "change-email",
    ["Email", "change email", "email address", "login email"],
    ["Courriel", "changer le courriel", "adresse courriel", "adresse e-mail"]),
  entry("account", "change-password",
    ["Password", "change password", "reset password", "set password", "forgot"],
    ["Mot de passe", "changer le mot de passe", "réinitialiser", "oublié"]),
  entry("account", "two-factor",
    ["Two-factor authentication", "2fa", "mfa", "authenticator", "security", "recovery codes", "totp"],
    ["Authentification à deux facteurs", "2fa", "mfa", "sécurité", "codes de récupération"]),
  entry("account", "delete-account",
    ["Delete your account", "remove account", "close account", "erase me", "privacy"],
    ["Supprimer votre compte", "effacer mon compte", "fermer le compte", "confidentialité"]),

  // Devices
  entry("devices", "my-devices",
    ["Your devices", "sessions", "signed in", "log out everywhere", "browsers", "phones", "sign out other devices"],
    ["Vos appareils", "sessions", "connecté", "se déconnecter partout", "navigateurs", "téléphones"]),
  entry("devices", "crew-devices",
    ["The crew's devices", "team devices", "member sessions", "lost phone", "revoke"],
    ["Les appareils de l'équipe", "sessions des membres", "téléphone perdu", "révoquer"]),

  // Help
  entry("help", "help-email",
    ["Email us", "contact", "support", "help", "contact us", "talk to a human", "customer service"],
    ["Écrivez-nous", "contact", "soutien", "aide", "nous joindre", "service à la clientèle"]),
  entry("help", "help-no-mail",
    ["If that button doesn't open anything", "mail app", "copy email", "email address for support"],
    ["Si ce bouton n'ouvre rien", "application de courriel", "copier l'adresse"]),
  entry("help", "help-idea",
    ["Got an idea?", "feature request", "suggest", "suggestion", "feedback", "idea"],
    ["Une idée ?", "demande de fonctionnalité", "suggérer", "suggestion", "commentaires", "idée"]),
  entry("help", "help-faq",
    ["Common questions", "faq", "questions", "how do i", "answers"],
    ["Questions courantes", "faq", "questions", "comment faire", "réponses"]),
  entry("help", "help-expect",
    ["What to expect", "response time", "how fast", "support hours"],
    ["À quoi s'attendre", "temps de réponse", "rapidité", "heures du soutien"]),

  // What's new
  entry("whatsNew", "whats-new-feed",
    ["What's new", "changelog", "updates", "release notes", "new features", "news"],
    ["Quoi de neuf", "journal des modifications", "mises à jour", "notes de version", "nouveautés"]),

  // Developers
  entry("webhooks", "webhook-add",
    ["Webhooks", "integrations", "zapier", "connections", "endpoint", "notify my system", "callback", "url"],
    ["Webhooks", "intégrations", "zapier", "connexions", "point de terminaison", "rappel", "url"]),
  entry("apiKeys", "api-key-create",
    ["API keys", "api", "token", "developer", "credentials", "secret", "key"],
    ["Clés d'API", "api", "jeton", "développeur", "identifiants", "secret", "clé"]),
  entry("blockedNumbers", "blocked-list",
    ["Blocked numbers", "block", "spam", "unblock", "robotext", "blacklist", "blocklist"],
    ["Numéros bloqués", "bloquer", "pourriel", "débloquer", "liste noire"]),
];

export type SettingsSearchLocale = "en" | "fr";

export interface SettingsSearchResult {
  entry: SettingsIndexEntry;
  /** The text to show: the entry's first word in the viewer's language. */
  label: string;
  /** 0 when the query matched the label, 1 for a synonym. */
  rank: number;
}

/** Lowercase, accents and punctuation removed, one space between words. */
export function normalizeSettingsQuery(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Is `a` within one edit (insert, delete, replace, swap) of `b`? */
function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  const gap = a.length - b.length;
  if (Math.abs(gap) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (gap === 0) {
    if (a.slice(i + 1) === b.slice(i + 1)) return true;
    return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2);
  }
  return gap > 0 ? a.slice(i + 1) === b.slice(i) : b.slice(i + 1) === a.slice(i);
}

/** Does `word` start with `token`, give or take one typo in a long token? */
function wordMatches(token: string, word: string, allowTypo: boolean): boolean {
  if (word.startsWith(token)) return true;
  if (!allowTypo || token.length < 4) return false;
  for (const length of [token.length - 1, token.length, token.length + 1]) {
    if (length > 0 && withinOneEdit(token, word.slice(0, length))) return true;
  }
  return false;
}

function phraseMatches(query: string, phrase: string): boolean {
  const words = phrase.split(" ");
  const tokens = query.split(" ");
  // A typo is forgiven only in a one-word query; across two words it lets
  // "zone" find "one" and the list fills with noise.
  const allowTypo = tokens.length === 1;
  if (tokens.every((token) => words.some((word) => wordMatches(token, word, allowTypo)))) {
    return true;
  }
  // "timezone" typed for "time zone", and the other way round.
  const joined = query.replace(/ /g, "");
  return joined.length >= 3 && phrase.replace(/ /g, "").startsWith(joined);
}

/**
 * The settings that match `query`, label matches first, then synonyms, each
 * group in index order. Only sections `canSee` allows are searched.
 */
export function searchSettings(
  query: string,
  locale: SettingsSearchLocale,
  canSee: (section: SettingsSectionId) => boolean,
): SettingsSearchResult[] {
  const q = normalizeSettingsQuery(query);
  if (!q) return [];
  const results: SettingsSearchResult[] = [];
  for (const item of SETTINGS_INDEX) {
    if (!canSee(item.section)) continue;
    const words = locale === "fr" ? item.fr : item.en;
    const label = words[0];
    if (label === undefined) continue;
    const labelMatch = phraseMatches(q, normalizeSettingsQuery(label));
    const rank = labelMatch
      ? 0
      : words.slice(1).some((word) => phraseMatches(q, normalizeSettingsQuery(word)))
        ? 1
        : -1;
    if (rank >= 0) results.push({ entry: item, label, rank });
  }
  return results
    .map((result, index) => ({ result, index }))
    .sort((a, b) => a.result.rank - b.result.rank || a.index - b.index)
    .map(({ result }) => result);
}
