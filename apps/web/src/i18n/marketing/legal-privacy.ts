import type { Translated } from "../translated";

import type { MarketingLocale } from "./footer";

export const legalPrivacyEn = {
  metaTitle: "Privacy policy",
  metaDescription:
    "How Loonext handles your data under PIPEDA and Quebec Law 25: US data processing named plainly, and a firm commitment that mobile numbers and SMS consent data are never sold or shared for third-party marketing.",
  title: "Privacy policy",
  breadcrumbLabel: "Privacy policy",
  lastUpdated: "November 13, 2026",
  summary:
    "We collect only what the service needs to run your inbox: account details, the contacts and messages your business handles, and billing through Stripe. Your data is processed and stored in the United States, and we say so plainly, with one exception we name rather than bury: AI inference runs on Cloudflare’s global network and cannot be confined to a country. Mobile numbers and SMS consent data are never sold or shared with third parties for their own marketing. You can ask to see, correct, or delete your information at any time.",

  sectionScope: "Scope",
  sectionCollect: "What we collect",
  sectionWhy: "Why we use it",
  sectionSmsConsent: "SMS and consent data",
  sectionWhere: "Where your data lives",
  sectionPhone: "What stays on your phone",
  sectionCalendar: "Your calendar, if you connect one",
  sectionSharing: "Who we share with",
  sectionAi: "AI features",
  sectionRetention: "How long we keep it",
  sectionRights: "Your rights",
  sectionLaw25: "Quebec Law 25",
  sectionSecurity: "Security",
  sectionContact: "Privacy contact",

  cookiesLink: "cookie policy",
  subprocessorsLink: "sub-processors page",
  deleteLink: "delete your data",
  securityLink: "security page",
  officerFallback: "our Privacy Officer",

  scope:
    "This policy covers the personal information Loonext handles when a business uses the service to text its customers. It follows Canada's PIPEDA and Quebec's Law 25 and applies in both countries we serve. Two groups of people are involved: the **account users** on a business's crew, and the **contacts** those businesses text. The business is the party that decides who to text and why; Loonext processes that data to run the shared inbox on the business's behalf.",
  collectIntro: "We collect only what the service needs to work:",
  collectAccount:
    "**Account data:** your name, email, and the business details you provide to register with the phone companies (legal business name, address, and a business identifier such as an EIN or BN). For the sole-proprietor path we collect the last four digits of an SSN/SIN and a mobile number for a one-time verification code, we never collect or store a full SSN/SIN.",
  collectContact:
    "**Contact and message data:** the phone numbers, names, notes, and message content that flow through your inbox. This is your business's data; we hold it so your crew can see and reply to it.",
  collectBilling:
    "**Billing data:** handled by Stripe. We store customer and subscription identifiers, not full card numbers.",
  collectDevice:
    "**Sign-in and device data:** for each device signed in to your account we keep which app it is, when it last used the service, and the approximate city the request came from. It is there so you and your workspace owner can see what has access and end it, on the “signed-in devices” screen in Settings. We keep the city, not the IP address, and only for as long as the record is useful (90 days after a device stops being signed in).",
  collectAnalytics:
    "**Product analytics:** cookieless, event-level usage (page views, feature clicks, counts). We do not put message content, names, addresses, or phone numbers into analytics. Our {cookies} lists every cookie and browser-storage item we use.",
  why:
    "To provide the inbox, provision and register your number, send and receive texts, bill your subscription, prevent abuse and fraud, meet our legal and carrier obligations, and answer your support requests. We do not use your message content to train models or to advertise.",
  smsConsentCallout:
    "**Mobile numbers and SMS consent data are never shared with, or sold to, third parties or affiliates for their own marketing.** The consent a customer gives to be texted, and the phone number tied to it, stay inside Loonext and the business that collected them. They are used only to deliver that business's messages and to honor opt-outs.",
  smsConsentBody:
    "When a business starts a conversation with a new contact, Loonext records that consent was attested, a name and a date. When someone texts STOP, the opt-out is recorded and future sends to that number are blocked.",
  whereOne:
    "Loonext processes and stores data in the **United States**. Our database, authentication, and file storage run on Supabase in the AWS {region} region. If you are in Canada, your data is transferred to and processed in the United States, we state this plainly rather than burying it.",
  whereTwo:
    "**One exception, and we would rather name it than have you find it.** {location} It applies only to the features in section 7, only to what those features send, and only while the request is being answered. {retention}",
  whereThree:
    "The full list of the vendors that process data on our behalf, and the region each operates in, is on our {subprocessors}.",
  phoneIntro:
    "Our app is almost certainly on a phone you own rather than one your company issued. So here is what it keeps on the device itself, and what happens to it.",
  phoneSignIn:
    "**Your sign-in.** Held in the phone's own secure storage (the Keychain on iPhone, app-private storage on Android), so no other app can read it.",
  phoneRecent:
    "**Recent conversations, contacts and unread counts,** so the app opens to something rather than a spinner on a weak signal.",
  phoneOffline:
    "**Messages you sent while offline,** with any photos attached, until the phone gets signal and they go.",
  phoneDeleted:
    "**All of it is deleted when your session ends,** whether you sign out yourself or an owner signs your phone out from their team settings. Not marked for later: removed, including the photos.",
  phoneNotifications:
    "**Notifications show the first line of a text unless your workspace turns that off.** By default a notification carries the customer’s name and the first line of their message, so those words can appear on your lock screen. An owner or admin can switch off “{pushSwitch}” in Settings → Notifications; after that a notification carries the name only, and the words are never sent to a push service at all.",
  phoneLock:
    "**You can put a lock on the app,** separate from the phone's own lock, in Settings. It is off by default, and worth turning on if a spare phone gets shared around the crew.",
  phoneHandOver:
    "**Passing the phone to a colleague** is one tap in Settings. It signs you out, clears everything above, and leaves them to sign in as themselves so their replies are theirs.",
  phonePhotos:
    "**Photos arrive without their location.** Phones write the GPS position of wherever a picture was taken into the file itself. We remove it as the photo arrives, on pictures your crew uploads and on pictures your customers text you. A job already has an address; the picture does not need to carry one.",
  phoneAddressBook:
    "**Your phone's address book is never uploaded.** If you give the app permission, it shows your own contacts beside the crew's so you do not have to retype a number. That search happens on the phone, and none of it is sent to us.",
  calendarIntro:
    "A crew member can connect their own Google Calendar or Microsoft 365 calendar in Settings. It is off until you do it, and each person decides for themselves. Once connected, Loonext writes an event into the calendar you choose for each scheduled job assigned to you, and reads back only those events to see whether you moved, renamed or removed one. It does not read the content of your other events, and it never invites a customer.",
  calendarAsk:
    "**What we ask the provider for:** permission to manage events on the calendars you own and to read your calendar list so you can pick one. On Google that is the Calendar events (owned calendars) and Calendar list (read only) permissions; on Microsoft it is Calendars.ReadWrite.",
  calendarWrite:
    "**What we write to an event:** the job's title, notes, start and end time. Whatever your crew types into a job's title or notes therefore appears in the calendar, so keep a customer's phone number out of them if you do not want it there.",
  calendarKeep:
    "**What we keep:** a connection record holding the provider's refresh credential, encrypted, and for each job a copy of the schedule we last agreed with the calendar so that we can tell which side changed it. It is used only to keep your calendar and your jobs in step, and only people in your workspace can see it.",
  calendarSee:
    "**Who else sees it:** no one outside your workspace, and no advertising or analytics service. The calendar provider you chose holds the events, under its own terms.",
  calendarGoogle:
    "**Loonext's use and transfer to any other app of information received from Google APIs will adhere to the Google API Services User Data Policy, including the Limited Use requirements.** We do not use calendar information to train models or to advertise.",
  calendarEnding:
    "**Ending it.** Disconnect in Settings and we revoke our access at the provider, erase the stored credential at once, and remove the events we created, or clear their contents where deleting one would affect other people. If a provider will not confirm that, we tell your workspace owner. You can also remove Loonext in your Google or Microsoft account permissions. When a workspace is closed, every record described here goes with it.",
  sharingOne:
    "We share data only with the sub-processors that make the service run, the phone carrier (Telnyx), payments (Stripe), infrastructure (Supabase/AWS, Cloudflare), email (Resend), push notifications (Google Firebase Cloud Messaging), and error/analytics tooling (PostHog), each limited to what its job requires and listed on our {subprocessors}. We may disclose data if the law requires it. We do not sell personal information.",
  sharingTwo:
    "Your workspace can also send its own data somewhere. If an owner or admin sets up a connection, we post what happens here, including message text and a contact’s name and number, to the web address they enter, until they delete it. If they create an API key, whoever holds that key can read whatever its permissions allow. In both cases the recipient is chosen by your business rather than by us, and it is not covered by our agreements with the services above.",
  sharingThree:
    "Push notifications reach phones through Apple, Google, and the browser’s own push service, so those services carry whatever the notification says. By default that is the contact’s name and the first line of their message, which is what lets a crew tell a lead from a “thanks” without unlocking a phone. An owner or admin can turn message text off for the whole workspace in Settings → Notifications; after that the notification carries the name only, and the words are never sent to a push service at all. This is a workspace decision rather than a per-person one, because the content usually belongs to the customer rather than to the person holding the phone.",
  aiOne:
    "{featureCount} features send content to an AI model: {features}. They all run on Cloudflare Workers AI, inside the same Cloudflare account that already hosts the application. Our {subprocessors} names each feature, exactly what it sends, the model that receives it, and whether it is on by default.",
  aiTwo:
    "Cloudflare’s published Workers AI policy states: {training} We do not use message content or voicemail audio to train anything either. What comes back is stored in your workspace like any other message data and is deleted with it.",
  aiThree:
    "Some of this content belongs to the people your business texts and calls, not to you or to us. A voicemail is somebody’s voice and a conversation is somebody’s words. That is why every one of these features can be switched off for your whole workspace, and why a drafted reply is never sent automatically. A person reads it, edits it, and decides.",
  retentionOne:
    "We keep account and message data while your subscription is active and for a reasonable period afterward to meet legal, tax, and carrier record-keeping duties, then delete or anonymize it. Opt-out records are kept as long as needed to keep honoring the opt-out.",
  retentionTwo:
    "You do not have to ask us. You can delete your own account, or close a whole workspace, from inside Loonext. See {delete} for exactly what each one removes. Closing a workspace erases everything in it 30 days later, which is a window in which a workspace closed by mistake can still be recovered; after that nobody can undo it. Two things outlive it: do-not-text records, which belong to the person who sent the STOP rather than to the business that received it, and a stripped record that consent existed, which Canadian anti-spam law requires us to hold for three years with names and message contents removed.",
  retentionThree:
    "The defaults, by kind of data. Texts, conversations, job photos and call records are kept for **seven years** after the last activity on them, because a contractor in a warranty dispute over a two-year-old job needs those texts, and deleting them sooner would cause the harm the deletion was meant to prevent. Voicemail *recordings* are the exception and are kept for **one year**: the transcript keeps what was said, while the recording is somebody’s actual voice in their home and is worth far less after the first few weeks. The transcript itself stays with the call record for the full seven years, which is what makes deleting the audio safe rather than lossy. Audit logs are kept for 12 months. Do-not-text records are kept indefinitely, because they belong to the person who sent the STOP.",
  retentionFour:
    "Owners and admins can also delete a single message, conversation, call or voicemail. It leaves the inbox, search, exports and integrations at once and waits in a Trash for **30 days**, where it can be restored. After that, or when someone chooses “Delete forever”, the message text, photos, voicemail recordings, transcripts and any summaries made from them are erased for good. A text you already sent stays on the customer’s phone. We keep the counts we bill from (message segments, call minutes) and any do-not-text record, none of which holds message content. Deleting a contact works differently: it hides the contact from your lists without erasing it, its conversations stay, and it comes back if someone adds its number again or that number texts or calls you.",
  retentionFive:
    "If you write to us through the contact form on this site without ever creating an account, we keep your name, email, company and message for up to a year so we can reply and follow up, then delete them. We also record the IP address the form was submitted from, purely to tell a spam flood from a real enquiry, and that is deleted after 30 days, sooner than the rest, because it stops being useful sooner. You can ask us to delete a contact-form submission at any time by emailing {privacyEmail}, and you do not need an account to do it.",
  rights:
    "Under PIPEDA and Law 25 you can access, correct, or delete your personal information, and withdraw consent. Deletion is self-serve and takes effect immediately; {delete} has the steps. For anything else, or if you have lost access to your account, email {privacyEmail} and we'll respond within the timelines the law requires. If a contact of one of our business customers asks us to exercise a right, we'll route the request to that business, which controls the data.",
  law25:
    "For Quebec residents, Law 25 gives you additional rights, including the right to be informed of the use and disclosure of your information and the right to portability. As required by Law 25, Loonext has a designated person responsible for the protection of personal information: **{officer}**, reachable at {privacyEmail}. We disclose above that personal information is transferred to and processed in the United States, that the features in section 7 send message content or voicemail audio to an AI model on Cloudflare’s global network, and that this inference in particular is not confined to any one country.",
  security:
    "Data is encrypted in transit and at rest, each business's data is isolated from every other tenant, and we keep message content out of our analytics and error logs. The details are on our {security}.",
  contact:
    "Questions or requests? Email {privacyEmail}. If you're in Canada and aren't satisfied with our response, you can contact the Office of the Privacy Commissioner of Canada, or the Commission d'accès à l'information du Québec for Quebec residents.",
} as const;

export const legalPrivacyFr: Translated<typeof legalPrivacyEn> = {
  metaTitle: "Politique de confidentialité",
  metaDescription:
    "Comment Loonext traite vos données en vertu de la LPRPDE et de la Loi 25 du Québec : le traitement aux États-Unis annoncé clairement, et l'engagement ferme que les numéros de mobile et les données de consentement aux SMS ne sont jamais vendus ni transmis à des fins de marketing par des tiers.",
  title: "Politique de confidentialité",
  breadcrumbLabel: "Politique de confidentialité",
  lastUpdated: "13 novembre 2026",
  summary:
    "Nous ne recueillons que ce dont le service a besoin pour faire fonctionner votre boîte de réception : les renseignements du compte, les contacts et les messages que traite votre entreprise, et la facturation par Stripe. Vos données sont traitées et stockées aux États-Unis, et nous le disons clairement, avec une exception que nous nommons plutôt que de la cacher : l'inférence de l'IA s'exécute sur le réseau mondial de Cloudflare et ne peut pas être confinée à un pays. Les numéros de mobile et les données de consentement aux SMS ne sont jamais vendus ni transmis à des tiers pour leur propre marketing. Vous pouvez demander en tout temps à voir, à corriger ou à supprimer vos renseignements.",

  sectionScope: "Portée",
  sectionCollect: "Ce que nous recueillons",
  sectionWhy: "Pourquoi nous les utilisons",
  sectionSmsConsent: "Données de SMS et de consentement",
  sectionWhere: "Où se trouvent vos données",
  sectionPhone: "Ce qui reste sur votre téléphone",
  sectionCalendar: "Votre calendrier, si vous en connectez un",
  sectionSharing: "Avec qui nous les partageons",
  sectionAi: "Fonctions d'IA",
  sectionRetention: "Combien de temps nous les conservons",
  sectionRights: "Vos droits",
  sectionLaw25: "Loi 25 du Québec",
  sectionSecurity: "Sécurité",
  sectionContact: "Responsable de la protection des renseignements personnels",

  cookiesLink: "politique sur les témoins",
  subprocessorsLink: "page des sous-traitants",
  deleteLink: "la page sur la suppression de vos données",
  securityLink: "page sur la sécurité",
  officerFallback: "notre responsable de la protection des renseignements personnels",

  scope:
    "La présente politique couvre les renseignements personnels que Loonext traite lorsqu'une entreprise utilise le service pour écrire à ses clients par texto. Elle respecte la LPRPDE du Canada et la Loi 25 du Québec et s'applique dans les deux pays que nous servons. Deux groupes de personnes sont concernés : les **utilisateurs du compte** qui font partie de l'équipe d'une entreprise, et les **contacts** à qui ces entreprises écrivent. L'entreprise est la partie qui décide à qui écrire et pourquoi; Loonext traite ces données pour exploiter la boîte de réception partagée au nom de l'entreprise.",
  collectIntro: "Nous ne recueillons que ce dont le service a besoin pour fonctionner :",
  collectAccount:
    "**Données du compte :** votre nom, votre courriel et les renseignements sur l'entreprise que vous fournissez pour l'enregistrer auprès des compagnies de téléphone (dénomination sociale, adresse et identifiant d'entreprise comme un EIN ou un NE). Pour le parcours du travailleur autonome, nous recueillons les quatre derniers chiffres d'un SSN ou d'un NAS et un numéro de mobile pour un code de vérification à usage unique; nous ne recueillons ni ne conservons jamais un SSN ou un NAS complet.",
  collectContact:
    "**Données de contacts et de messages :** les numéros de téléphone, les noms, les notes et le contenu des messages qui transitent par votre boîte de réception. Ce sont les données de votre entreprise; nous les conservons pour que votre équipe puisse les consulter et y répondre.",
  collectBilling:
    "**Données de facturation :** traitées par Stripe. Nous conservons des identifiants de client et d'abonnement, pas les numéros de carte complets.",
  collectDevice:
    "**Données de connexion et d'appareil :** pour chaque appareil connecté à votre compte, nous conservons l'application utilisée, la dernière utilisation du service et la ville approximative d'où provenait la requête. Ces données permettent à vous-même et au propriétaire de votre espace de travail de voir ce qui a accès au compte et d'y mettre fin, à l'écran « Appareils connectés » des paramètres. Nous conservons la ville, pas l'adresse IP, et seulement tant que le dossier est utile (90 jours après qu'un appareil n'est plus connecté).",
  collectAnalytics:
    "**Analyses du produit :** utilisation par événement, sans témoins (pages vues, fonctions choisies, quantités). Nous ne mettons ni contenu de messages, ni noms, ni adresses, ni numéros de téléphone dans les analyses. Notre {cookies} énumère chaque témoin et chaque élément de stockage du navigateur que nous utilisons.",
  why:
    "Pour fournir la boîte de réception, attribuer et enregistrer votre numéro, envoyer et recevoir des textos, facturer votre abonnement, prévenir les abus et la fraude, respecter nos obligations légales et celles des fournisseurs, et répondre à vos demandes de soutien. Nous n'utilisons pas le contenu de vos messages pour entraîner des modèles ni pour faire de la publicité.",
  smsConsentCallout:
    "**Les numéros de mobile et les données de consentement aux SMS ne sont jamais partagés avec des tiers ou des sociétés affiliées, ni vendus à ceux-ci, pour leur propre marketing.** Le consentement qu'un client donne pour recevoir des textos, et le numéro de téléphone qui y est associé, restent au sein de Loonext et de l'entreprise qui les a recueillis. Ils servent uniquement à livrer les messages de cette entreprise et à respecter les retraits.",
  smsConsentBody:
    "Lorsqu'une entreprise amorce une conversation avec un nouveau contact, Loonext consigne que le consentement a été attesté, un nom et une date. Lorsqu'une personne répond STOP par texto, le retrait est consigné et les envois futurs vers ce numéro sont bloqués.",
  whereOne:
    "Loonext traite et stocke les données aux **États-Unis**. Notre base de données, notre authentification et notre stockage de fichiers s'exécutent sur Supabase, dans la région AWS {region}. Si vous êtes au Canada, vos données sont transférées et traitées aux États-Unis; nous le disons clairement plutôt que de le cacher.",
  whereTwo:
    "**Une exception, que nous préférons nommer plutôt que de vous laisser la découvrir.** {location} Elle s'applique seulement aux fonctions de la section 7, seulement à ce que ces fonctions envoient, et seulement pendant que la requête est traitée. {retention}",
  whereThree:
    "La liste complète des fournisseurs qui traitent des données en notre nom, et la région où chacun exerce ses activités, se trouve sur notre {subprocessors}.",
  phoneIntro:
    "Notre application se trouve presque certainement sur un téléphone qui vous appartient plutôt que sur un appareil fourni par votre entreprise. Voici donc ce qu'elle conserve sur l'appareil lui-même, et ce qui en advient.",
  phoneSignIn:
    "**Votre connexion.** Conservée dans le stockage sécurisé du téléphone (le trousseau sur iPhone, le stockage privé de l'application sur Android), de sorte qu'aucune autre application ne peut la lire.",
  phoneRecent:
    "**Les conversations récentes, les contacts et les compteurs de messages non lus,** pour que l'application s'ouvre sur du contenu plutôt que sur un indicateur de chargement lorsque le signal est faible.",
  phoneOffline:
    "**Les messages que vous avez envoyés hors ligne,** avec leurs photos jointes, jusqu'à ce que le téléphone capte un signal et qu'ils partent.",
  phoneDeleted:
    "**Tout cela est supprimé à la fin de votre session,** que vous fermiez vous-même la session ou qu'un propriétaire déconnecte votre téléphone depuis les paramètres de son équipe. Pas marqué pour plus tard : supprimé, y compris les photos.",
  phoneNotifications:
    "**Les notifications affichent la première ligne d'un texto, sauf si votre espace de travail le désactive.** Par défaut, une notification contient le nom du client et la première ligne de son message; ces mots peuvent donc apparaître sur votre écran verrouillé. Un propriétaire ou un administrateur peut désactiver « {pushSwitch} » dans Paramètres → Notifications; par la suite, la notification ne contient que le nom, et les mots ne sont jamais envoyés à un service de notifications poussées.",
  phoneLock:
    "**Vous pouvez verrouiller l'application,** séparément du verrouillage du téléphone lui-même, dans les paramètres. Cette option est désactivée par défaut, et vaut la peine d'être activée si un téléphone de rechange circule dans l'équipe.",
  phoneHandOver:
    "**Confier le téléphone à un collègue** se fait d'un seul toucher dans les paramètres. Cela vous déconnecte, efface tout ce qui précède et laisse l'autre personne se connecter sous son propre nom, de sorte que ses réponses sont les siennes.",
  phonePhotos:
    "**Les photos arrivent sans leur emplacement.** Les téléphones inscrivent dans le fichier lui-même la position GPS de l'endroit où une photo a été prise. Nous la retirons à l'arrivée de la photo, sur les photos que téléverse votre équipe comme sur celles que vos clients vous envoient par texto. Un travail a déjà une adresse; la photo n'a pas besoin d'en porter une.",
  phoneAddressBook:
    "**Le carnet d'adresses de votre téléphone n'est jamais téléversé.** Si vous en donnez la permission à l'application, elle affiche vos propres contacts à côté de ceux de l'équipe pour que vous n'ayez pas à ressaisir un numéro. Cette recherche se fait sur le téléphone, et rien ne nous en est transmis.",
  calendarIntro:
    "Un membre de l'équipe peut connecter son propre Google Agenda ou son propre calendrier Microsoft 365 dans les paramètres. Cette fonction est désactivée tant que vous ne l'activez pas, et chaque personne décide pour elle-même. Une fois la connexion établie, Loonext inscrit un événement dans le calendrier que vous choisissez pour chaque travail planifié qui vous est attribué, et ne relit que ces événements pour voir si vous en avez déplacé, renommé ou supprimé un. Il ne lit pas le contenu de vos autres événements, et il n'invite jamais un client.",
  calendarAsk:
    "**Ce que nous demandons au fournisseur :** la permission de gérer les événements des calendriers qui vous appartiennent et de lire la liste de vos calendriers pour que vous puissiez en choisir un. Chez Google, il s'agit des permissions Événements de l'agenda (agendas dont vous êtes propriétaire) et Liste des agendas (lecture seule); chez Microsoft, il s'agit de Calendars.ReadWrite.",
  calendarWrite:
    "**Ce que nous inscrivons dans un événement :** le titre du travail, les notes, l'heure de début et l'heure de fin. Tout ce que votre équipe saisit dans le titre ou les notes d'un travail apparaît donc dans le calendrier; n'y mettez pas le numéro de téléphone d'un client si vous ne voulez pas qu'il s'y trouve.",
  calendarKeep:
    "**Ce que nous conservons :** un dossier de connexion contenant l'identifiant de renouvellement du fournisseur, chiffré, et, pour chaque travail, une copie de l'horaire convenu en dernier avec le calendrier afin que nous puissions déterminer de quel côté il a été modifié. Ces données servent uniquement à garder votre calendrier et vos travaux synchronisés, et seules les personnes de votre espace de travail peuvent les voir.",
  calendarSee:
    "**Qui d'autre les voit :** personne à l'extérieur de votre espace de travail, et aucun service de publicité ou d'analyse. Le fournisseur de calendrier que vous avez choisi conserve les événements, selon ses propres conditions.",
  calendarGoogle:
    "**Loonext's use and transfer to any other app of information received from Google APIs will adhere to the Google API Services User Data Policy, including the Limited Use requirements.** En français : l'utilisation et le transfert à toute autre application, par Loonext, des renseignements reçus des API de Google respecteront la politique sur les données des utilisateurs des services d'API de Google, y compris les exigences d'utilisation limitée. Nous n'utilisons pas les renseignements du calendrier pour entraîner des modèles ni pour faire de la publicité.",
  calendarEnding:
    "**Y mettre fin.** Déconnectez-vous dans les paramètres et nous révoquons notre accès auprès du fournisseur, effaçons immédiatement l'identifiant conservé et supprimons les événements que nous avons créés, ou en vidons le contenu lorsque leur suppression toucherait d'autres personnes. Si un fournisseur ne le confirme pas, nous en avisons le propriétaire de votre espace de travail. Vous pouvez aussi retirer Loonext dans les permissions de votre compte Google ou Microsoft. Lorsqu'un espace de travail est fermé, tous les dossiers décrits ici disparaissent avec lui.",
  sharingOne:
    "Nous ne partageons des données qu'avec les sous-traitants qui font fonctionner le service : le fournisseur de téléphonie (Telnyx), les paiements (Stripe), l'infrastructure (Supabase/AWS, Cloudflare), le courriel (Resend), les notifications poussées (Google Firebase Cloud Messaging) et les outils de surveillance des erreurs et d'analyse (PostHog), chacun limité à ce que son travail exige et inscrit sur notre {subprocessors}. Nous pouvons communiquer des données si la loi l'exige. Nous ne vendons pas de renseignements personnels.",
  sharingTwo:
    "Votre espace de travail peut aussi envoyer ses propres données ailleurs. Si un propriétaire ou un administrateur configure une connexion, nous y transmettons ce qui s'y passe, y compris le texte des messages et le nom et le numéro d'un contact, à l'adresse Web qu'il saisit, jusqu'à ce qu'il la supprime. S'il crée une clé d'API, quiconque détient cette clé peut lire tout ce que ses permissions autorisent. Dans les deux cas, le destinataire est choisi par votre entreprise plutôt que par nous, et il n'est pas couvert par nos ententes avec les services mentionnés ci-dessus.",
  sharingThree:
    "Les notifications poussées parviennent aux téléphones par Apple, Google et le service de notifications du navigateur lui-même; ces services transportent donc tout ce que dit la notification. Par défaut, il s'agit du nom du contact et de la première ligne de son message, ce qui permet à une équipe de distinguer une demande de client d'un « merci » sans déverrouiller un téléphone. Un propriétaire ou un administrateur peut désactiver le texte des messages pour tout l'espace de travail dans Paramètres → Notifications; par la suite, la notification ne contient que le nom, et les mots ne sont jamais envoyés à un service de notifications poussées. C'est une décision d'espace de travail plutôt que personnelle, parce que le contenu appartient généralement au client plutôt qu'à la personne qui tient le téléphone.",
  aiOne:
    "{featureCount} fonctions envoient du contenu à un modèle d'IA : {features}. Elles s'exécutent toutes sur Cloudflare Workers AI, dans le même compte Cloudflare qui héberge déjà l'application. Notre {subprocessors} nomme chaque fonction, ce qu'elle envoie exactement, le modèle qui le reçoit et si elle est activée par défaut.",
  aiTwo:
    "La politique publiée de Cloudflare sur Workers AI affirme, en anglais : {training} En français : Cloudflare n'utilise pas le contenu de ses clients pour entraîner les modèles offerts dans Workers AI ni pour améliorer ses services ou ceux de tiers. Nous n'utilisons pas non plus le contenu des messages ni l'audio des messages vocaux pour entraîner quoi que ce soit. Ce qui revient est conservé dans votre espace de travail comme toute autre donnée de message et est supprimé avec lui.",
  aiThree:
    "Une partie de ce contenu appartient aux personnes à qui votre entreprise écrit et téléphone, pas à vous ni à nous. Un message vocal est la voix de quelqu'un et une conversation, les mots de quelqu'un. C'est pourquoi chacune de ces fonctions peut être désactivée pour tout votre espace de travail, et pourquoi une réponse rédigée n'est jamais envoyée automatiquement. Une personne la lit, la modifie et décide.",
  retentionOne:
    "Nous conservons les données du compte et des messages tant que votre abonnement est actif, puis pendant une période raisonnable par la suite pour respecter les obligations légales, fiscales et de tenue de dossiers exigées par les fournisseurs, avant de les supprimer ou de les anonymiser. Les registres de retrait sont conservés aussi longtemps qu'il le faut pour continuer à respecter le retrait.",
  retentionTwo:
    "Vous n'avez pas à nous le demander. Vous pouvez supprimer votre propre compte, ou fermer tout un espace de travail, depuis Loonext. Consultez {delete} pour savoir exactement ce que chacune de ces opérations supprime. La fermeture d'un espace de travail efface tout son contenu 30 jours plus tard, ce qui laisse un délai pendant lequel un espace fermé par erreur peut encore être récupéré; après ce délai, personne ne peut revenir en arrière. Deux éléments subsistent : les registres d'exclusion des textos, qui appartiennent à la personne qui a envoyé le STOP plutôt qu'à l'entreprise qui l'a reçu, et une preuve dépouillée de l'existence du consentement, que la loi canadienne antipourriel nous oblige à conserver pendant trois ans, sans les noms ni le contenu des messages.",
  retentionThree:
    "Les durées par défaut, selon le type de données. Les textos, les conversations, les photos de travaux et les registres d'appels sont conservés pendant **sept ans** après la dernière activité qui s'y rapporte, parce qu'un entrepreneur dans un différend de garantie au sujet d'un travail vieux de deux ans a besoin de ces textos, et que les supprimer plus tôt causerait le préjudice que la suppression devait éviter. Les *enregistrements* de messages vocaux font exception et sont conservés pendant **un an** : la transcription garde ce qui a été dit, tandis que l'enregistrement est la voix même d'une personne chez elle et vaut bien moins après les premières semaines. La transcription elle-même reste avec le registre d'appel pendant les sept ans complets, ce qui rend la suppression de l'audio sûre plutôt que dommageable. Les journaux d'audit sont conservés pendant 12 mois. Les registres d'exclusion des textos sont conservés indéfiniment, parce qu'ils appartiennent à la personne qui a envoyé le STOP.",
  retentionFour:
    "Les propriétaires et les administrateurs peuvent aussi supprimer un seul message, une conversation, un appel ou un message vocal. L'élément quitte la boîte de réception, la recherche, les exportations et les intégrations immédiatement et attend dans une corbeille pendant **30 jours**, où il peut être restauré. Après ce délai, ou lorsque quelqu'un choisit « Supprimer définitivement », le texte du message, les photos, les enregistrements de messages vocaux, les transcriptions et tous les résumés qui en ont été tirés sont effacés pour de bon. Un texto déjà envoyé reste sur le téléphone du client. Nous conservons les compteurs sur lesquels nous facturons (segments de messages, minutes d'appel) et tout registre d'exclusion des textos, dont aucun ne contient de contenu de message. La suppression d'un contact fonctionne autrement : elle masque le contact dans vos listes sans l'effacer, ses conversations restent, et il revient si quelqu'un ajoute de nouveau son numéro, ou si ce numéro vous texte ou vous appelle.",
  retentionFive:
    "Si vous nous écrivez par le formulaire de contact de ce site sans jamais créer de compte, nous conservons votre nom, votre courriel, votre entreprise et votre message pendant un maximum d'un an pour pouvoir répondre et faire un suivi, puis nous les supprimons. Nous consignons aussi l'adresse IP d'où le formulaire a été soumis, uniquement pour distinguer un déluge de pourriel d'une vraie demande, et elle est supprimée après 30 jours, plus tôt que le reste, parce qu'elle cesse plus tôt d'être utile. Vous pouvez nous demander de supprimer une soumission du formulaire de contact en tout temps en écrivant à {privacyEmail}, et vous n'avez pas besoin de compte pour le faire.",
  rights:
    "En vertu de la LPRPDE et de la Loi 25, vous pouvez accéder à vos renseignements personnels, les corriger ou les supprimer, et retirer votre consentement. La suppression est en libre-service et prend effet immédiatement; {delete} en indique les étapes. Pour toute autre demande, ou si vous avez perdu l'accès à votre compte, écrivez à {privacyEmail} et nous répondrons dans les délais prévus par la loi. Si un contact de l'un de nos clients commerciaux nous demande d'exercer un droit, nous transmettrons la demande à cette entreprise, qui contrôle les données.",
  law25:
    "Pour les résidents du Québec, la Loi 25 vous confère des droits additionnels, notamment le droit d'être informé de l'utilisation et de la communication de vos renseignements et le droit à la portabilité. Comme l'exige la Loi 25, Loonext a désigné une personne responsable de la protection des renseignements personnels : **{officer}**, que vous pouvez joindre à {privacyEmail}. Nous divulguons plus haut que les renseignements personnels sont transférés et traités aux États-Unis, que les fonctions de la section 7 envoient du contenu de messages ou de l'audio de messages vocaux à un modèle d'IA sur le réseau mondial de Cloudflare, et que cette inférence en particulier n'est confinée à aucun pays.",
  security:
    "Les données sont chiffrées en transit et au repos, les données de chaque entreprise sont isolées de celles de tout autre locataire, et nous gardons le contenu des messages hors de nos analyses et de nos journaux d'erreurs. Les détails se trouvent sur notre {security}.",
  contact:
    "Des questions ou des demandes? Écrivez à {privacyEmail}. Si vous êtes au Canada et que notre réponse ne vous satisfait pas, vous pouvez communiquer avec le Commissariat à la protection de la vie privée du Canada, ou avec la Commission d'accès à l'information du Québec si vous résidez au Québec.",
};

const COPY = { en: legalPrivacyEn, "fr-CA": legalPrivacyFr } as const;

export function legalPrivacyCopy(locale: MarketingLocale = "en") {
  return COPY[locale] ?? legalPrivacyEn;
}
