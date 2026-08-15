/**
 * #228 — the words the SHARED modules say, in both languages.
 *
 * Every other section in this directory belongs to a screen. This one belongs
 * to `packages/shared`, and it exists because that package turned out to be the
 * largest untranslated surface in the product: 325 English sentences that no
 * ledger was counting, rendered on all three clients.
 *
 * Both phones already translate them. `DomainStrings.kt` and
 * `DomainStrings.swift` hold 330 keys under `domain.`, hand-ported when each
 * shared module was ported, while the web kept calling the shared function and
 * rendering whatever English came back. So a French reader saw a French app
 * with English underneath it — "Not delivered" under a message bubble, in an
 * app whose every other word had been translated.
 *
 * KEYS MATCH THE PHONES EXACTLY, and `send-failures.parity.test.ts` fails if
 * the three tables ever disagree. That is the whole value of this file: the
 * shared module names a key, and three clients look it up in three catalogues
 * that are checked against each other rather than against a comment asking
 * somebody to keep them identical.
 *
 * It grows one shared module at a time. Send failures first, because they are
 * the ones a person reads while wondering whether to try again.
 */
import type { Translated } from "../translated";

export const domainEn = {
  /*
   * #540 — the dashboard panels a member may put away, and what each one answers. Both phones have said these since #228 reached them; the web imported the shared tables and rendered whatever English came back.
   */
  panelLeadSources: "Where your customers come from",
  panelLeadSourcesNote: "Which channels are actually bringing work in.",
  panelPipeline: "Quotes",
  panelPipelineNote: "What you quoted this month, and how much of it landed.",
  panelRecentCalls: "Recent calls",
  panelRecentCallsNote: "The last few calls, in and out.",
  panelResponseTime: "Response time",
  panelResponseTimeNote: "How fast new customers got an answer this week.",
  panelSatisfaction: "Satisfaction",
  panelSatisfactionNote: "Whether the people you answered were happy.",


  /*
   * #244 — who is on call, and the banner that turns 'somebody should call these people' into 'I have this'. Both phones have said these since #228 reached them. The two assembled lines are TEMPLATE keys rather than concatenations: putting the subject first and the clause after is English word order stated as code.
   */
  onCallBannerClaim: "I have this",
  onCallBannerTaken: "has this",
  onCallBannerWaiting: "Nobody has picked this up yet",
  onCallBannerYours: "You have this. The rest of the crew has been told.",
  onCallEscalation: "If they do not pick it up, everyone else is told a few minutes later.",
  onCallLine: "{name} is on call until {until}",
  onCallNobody: "Nobody is on call, so an after-hours call wakes everyone who can see the number. Put one person on and the rest get a quiet night.",
  onCallPresetTonight: "Tonight",
  onCallPresetTonightDetail: "6pm until 8am tomorrow",
  onCallPresetWeek: "The next 7 days",
  onCallPresetWeekDetail: "Starting now",
  onCallPresetWeekend: "This weekend",
  onCallPresetWeekendDetail: "Friday 6pm until Monday 8am",
  onCallReadOnly: "Only an owner or admin can change who is on call.",
  onCallSilenceCancel: "Leave it on",
  onCallSilenceChannelEmail: "Emails",
  onCallSilenceChannelPush: "Push alerts",
  onCallSilenceConfirm: "Turn it off anyway",
  onCallSilenceWarning: "You're on call right now. {what} are how a new customer nobody has answered reaches you, and with this off those pages go nowhere — no one else is told. Hand the shift over first if you need to be unreachable.",
  onCallTakenLine: "{name} has this",
  onCallUntil: "on call until",


  /*
   * #537 — confirming a handover of the business. Both phones have said these since #228 reached them; the web imported the shared constants and rendered whatever English came back.
   */
  handoverField: "Six-digit code",
  handoverRejected: "That code didn't work. Ask for a new one and try again.",
  handoverResend: "Send it again",
  handoverSubmit: "Confirm",
  handoverTitle: "Confirm it's you",
  handoverWhereAuthenticator: "Open your authenticator app and enter the six-digit code it shows.",
  handoverWhereEmail: "We've emailed a six-digit code to the address on your account. It works once, and expires in ten minutes.",


  /*
   * #293 — how much the app tells you, and about what. Both phones have said these since #228 reached them; the web imported the shared tables and rendered whatever English came back. The digest and daily-summary lines above them stay English: the server composes those into a push body.
   */
  categoryAssignments: "Work handed to me",
  categoryMentions: "When somebody @s me",
  categoryMessagesAll: "Texts on anyone's jobs",
  categoryMessagesMine: "Texts on my jobs",
  categoryMissedCalls: "Missed calls",
  categoryVoicemails: "Voicemails",
  deliveryBatched: "Grouped up",
  deliveryHeading: "How much we tell you",
  deliveryImmediate: "Straight away",
  deliverySummary: "Once a day",
  deliverySummaryDetail: "Held for your daily summary, not discarded.",
  deliveryUrgentAlways: "An emergency, a page while you are on call, or an alert nobody picked up always arrives straight away, whatever you choose here.",


  /*
   * #228 — the referral share sheet and the ask that precedes it. Both phones have said these since #228 reached them. The ask headline's singular and plural are separate keys: French agrees the noun with the count, and "1 client" reads as a form field rather than a sentence about somebody's month.
   */
  referralAction: "Share",
  referralAskAction: "Share your link",
  referralAskBody: "Know another crew still running their business off one person's cell? Send them your link — you both get a free month.",
  referralAskDismiss: "Not now",
  referralAskHeadlineMany: "You replied to {count} customers this month.",
  referralAskHeadlineOne: "You replied to 1 customer this month.",
  referralCodeFallback: "Use my code {code} when you sign up.",
  referralCopied: "Copied",
  referralCopy: "Copy",
  referralDraftLabel: "Your message",
  referralLinkNote: "Your link goes on the end automatically.",
  referralNote: "We run our business line through Loonext — calls and texts land in one inbox and whoever's free answers. Flat price, no per-seat fee. Sign up with my link and we both get a free month.",
  referralRewardLine: "Send this to another business. When they sign up and a customer texts them back, you both get a month free",
  referralStageActive: "Still going after 30 days",
  referralStageInvited: "Signed up, no replies yet",
  referralStageRewarded: "Free month applied",
  referralStageSignedUp: "Up and running",
  referralStageVoided: "Not counted",
  referralTitle: "Refer another crew",


  /*
   * #228 — where a US texting registration has got to. Both phones have said these since #228 reached them; the web imported the shared module and rendered whatever English came back, on the screen somebody opens because they are waiting.
   */
  regStageApprovedNext: "You can text customers now.",
  regStageApprovedTitle: "Your texting is live",
  regStageExpected: "Usually 3–7 business days, sometimes longer",
  regStageNeedsDetailsNext: "Finish the texting registration form and we'll send it on.",
  regStageNeedsDetailsTitle: "We need a few business details",
  regStageRejectedNext: "Check the details on your registration and resubmit.",
  regStageRejectedTitle: "The carriers need something changed",
  regStageSubmittingNext: "The carriers review it next. Nothing needed from you.",
  regStageSubmittingTitle: "Sent to the carriers",
  regStageUnderReviewNext: "We'll text and email you the moment it clears.",
  regStageUnderReviewTitle: "Under review by the carriers",



  /*
   * #286 — who reaches which number, and why.
   *
   * Both phones have said these since #228 reached them. The web imported the
   * shared module and rendered whatever English came back, on the one screen
   * whose job is explaining a security rule.
   *
   * The self note's singular and plural are SEPARATE keys and so is the joiner.
   * The shared module used to build that sentence from
   * `${n} ${n === 1 ? "number is" : "numbers are"}`, which is English grammar
   * written into a module three clients read.
   */
  and: "and",
  numberAccessAdmins: "Admins reach every number",
  numberAccessCanText: "Can text",
  numberAccessHidden: "Hidden",
  numberAccessNoMatchThem: "This number has rules, and none of them include them",
  numberAccessNoMatchYou: "This number has rules, and none of them include you",
  numberAccessNotMemberThem: "No longer in this workspace",
  numberAccessNotMemberYou: "You are no longer in this workspace",
  numberAccessNoteOnly: "Read and notes only",
  numberAccessOwners: "Owners reach every number",
  numberAccessRuleForEveryone: "A rule for everyone",
  numberAccessRuleForRole: "A rule for {role}s",
  numberAccessRuleForTheirRole: "A rule for their role",
  numberAccessRuleForYourRole: "A rule for your role",
  numberAccessRuleNamingThem: "A rule naming them",
  numberAccessRuleNamingYou: "A rule naming you",
  numberAccessSelfHiddenMany: "{count} numbers are hidden from you",
  numberAccessSelfHiddenOne: "{count} number is hidden from you",
  numberAccessSelfNote: "{parts}. That is deliberate — somebody set it up that way, and it is not the app failing. Ask an owner or admin if you need more.",
  numberAccessSelfReadOnlyMany: "{count} are read-only",
  numberAccessSelfReadOnlyOne: "{count} is read-only",
  numberAccessUnruled: "Nobody has restricted this number",



  /*
   * #233 — scheduled sends, and why each one is sitting there.
   *
   * Both phones have said these since #228 reached them; the web imported the
   * shared table and rendered whatever English came back. The keys are the
   * phones' own, so one wording change lands on three clients.
   */
  clockTheirTimeAreaCode: "their time, from their area code",
  clockTheirTimeContact: "their time, set on their contact",
  clockWorkspaceTime: "your workspace's time — we don't know theirs",
  scheduledCancelled: "Cancelled — that text will not go out.",
  scheduledEmptyTitle: "Nothing is waiting to send.",
  scheduledHoldCustomerReplied: "They replied after you scheduled this, so we held it rather than talk over them. Send it anyway, or cancel it.",
  scheduledHoldExpired: "The send window passed before this could go, so it was not sent. A late message is usually worse than none.",
  scheduledHoldInvalidDestination: "We cannot text this number any more, so this was not sent.",
  scheduledHoldJobUnscheduled: "That job is no longer booked, so this reminder was not sent.",
  scheduledHoldOptedOut: "They replied STOP after you scheduled this, so it was not sent. Only they can undo that.",
  scheduledHoldRegistrationPending: "This is waiting on carrier approval for US texting. It will send once that clears.",
  scheduledHoldServiceUnavailable: "Texting is paused while we deal with an issue. This is still queued and nothing was lost.",
  scheduledHoldSubscriptionInactive: "Your subscription has lapsed, so this has not been sent. It will go out when billing is sorted.",
  scheduledHoldWorkspaceClosed: "The workspace was closed before this was due to send.",
  scheduledHoldWorkspacePaused: "Your plan is paused, so this has not been sent. It will go out when you resume.",
  scheduledNothingWaiting: "Nothing is waiting to send. Anything you schedule shows up here.",
  scheduledPickerReassurance: "You can change or cancel it any time before it goes.",
  scheduledPresetTomorrow: "Tomorrow, 8:00am",
  scheduledQuietHoursChoice: "You can send it anyway, or pick a time in their morning.",
  scheduledQuietHoursUnknown: "That time is inside this customer's quiet hours.",


  /*
   * Why a text did not arrive, in words the reader can act on.
   *
   * Deliberately different sentences for the temporary and permanent cases —
   * "Carriers are blocking this right now" invites another try in a minute,
   * "Carriers blocked this as spam" does not, and a person deciding whether to
   * retry needs the difference.
   */
  sendFailureGeneric: "Not delivered",
  sendFailureOptedOut: "This customer opted out",
  sendFailureUnreachable: "That number can't receive texts",
  sendFailureNotTextable: "That number isn't textable",
  sendFailureBlockedNow: "Carriers are blocking this right now",
  sendFailureSpam: "Carriers blocked this as spam",
  sendFailureRateLimited: "Sent too fast for carriers. Try again shortly",
  sendFailureHandsetRejected: "Their phone rejected it",
  sendFailureHandsetUnavailable: "Their phone couldn't receive it",
  sendFailureExpired: "It expired before it could send",
  sendFailureContent: "Carriers wouldn't accept this message",
  sendFailureEmpty: "There was nothing to send",
  sendFailureAttachment: "Carriers wouldn't accept that attachment",
  sendFailureTooLong: "Too long to send",
  sendFailureRegistration: "Your US texting registration isn't approved yet",
  sendFailureNumberNotReady: "This number isn't set up for texting yet",
  sendFailureTextingOff: "Texting is turned off for this number",
  sendFailureNoSms: "This number can't send texts",
  sendFailureNoMms: "This number can't send pictures",

  /*
   * #352 — a carrier rejection, said in words the customer can act on.
   *
   * `what` names the objection, `fix` names the one thing to change, one
   * sentence each (G10). Read by somebody who has already paid, already waited
   * days, and has just been told no — so nothing here runs past two sentences.
   *
   * The MATCH phrases that select these stay in English, in the shared module.
   * They match text a carrier wrote, and a carrier writes
   * BRAND_LEGAL_NAME_MISMATCH in English to everybody.
   */
  rejectRegEinWhat: "The tax ID you gave does not match what the government registry holds for your business.",
  rejectRegEinFix: "Check the EIN or business number on a tax document and enter it exactly, digits only.",
  rejectRegNameWhat: "The business name you gave does not match the one on your government registration.",
  rejectRegNameFix: "Use the exact legal name from your registration paperwork, including any Ltd, Inc or LLC — the name customers see is set separately.",
  rejectRegAddressWhat: "The business address does not match the one on your government registration.",
  rejectRegAddressFix: "Enter the registered business address rather than a mailing or job-site address.",
  rejectRegWebsiteWhat: "The carrier could not confirm your business from the website you gave.",
  rejectRegWebsiteFix: "Give a website that names your business and describes what you do, and make sure it loads publicly.",
  rejectRegConsentWhat: "The carrier was not satisfied that customers agree to be texted before you text them.",
  rejectRegConsentFix: "Describe exactly where a customer gives you their number and what they are told at that moment.",
  rejectRegSampleWhat: "The sample texts did not show the carrier what you actually send.",
  rejectRegSampleFix: "Use real messages you would send a customer, and include your business name in each one.",
  rejectRegUseCaseWhat: "The use case you picked does not match what your samples and website describe.",
  rejectRegUseCaseFix: "Pick the category that matches the texts you actually send to customers.",
  rejectRegDuplicateWhat: "This business is already registered with the carriers, most likely by a provider you used before.",
  rejectRegDuplicateFix: "Reply to us and we will get the existing registration released or transferred — this is not something the form can fix.",
  rejectRegEntityWhat: "The business type you chose does not match how your business is registered.",
  rejectRegEntityFix: "Choose the type that matches your paperwork — a sole trader and a limited company are registered differently.",
  rejectRegContactWhat: "The carrier could not reach the contact details on the registration.",
  rejectRegContactFix: "Give a business email and phone number that reach a person and are not auto-replied.",
  rejectPortAccountWhat: "The account number does not match the one your current provider has on file.",
  rejectPortAccountFix: "Copy it from a recent bill from that provider — it is usually not the phone number itself.",
  rejectPortPinWhat: "The transfer PIN was missing or wrong.",
  rejectPortPinFix: "Ask your current provider for a port-out PIN — most will only give it to the account holder, and it often expires within a few days.",
  rejectPortAuthWhat: "The person named on the request is not authorised on the account.",
  rejectPortAuthFix: "Use the name of the person your current provider has as the account holder, spelled the same way.",
  rejectPortEntityWhat: "The account holder name does not match your current provider's records.",
  rejectPortEntityFix: "Use the name exactly as it appears on the bill, including any Ltd, Inc or LLC.",
  rejectPortAddressWhat: "The service address does not match the one your current provider has on file.",
  rejectPortAddressFix: "Use the address on the bill for this line, even if the business has since moved.",
  rejectPortPendingWhat: "Your current provider has another change in progress on this line.",
  rejectPortPendingFix: "Ask them to cancel or finish it, then tell us and we will resubmit.",
  rejectPortInactiveWhat: "Your current provider says this number is not active on the account we asked about.",
  rejectPortInactiveFix: "Check the number is still in service and on the account you gave us — a number already cancelled cannot be moved.",

  /*
   * How long a resubmission takes, stated because its absence is where people
   * give up. A range, and deliberately vague at the top end: the carriers do
   * not commit to a time, and inventing a precise one would be a worse promise
   * than an honest range.
   */
  resubmitWaitRegistration: "Most resubmissions are decided within a business day or two.",
  resubmitWaitPort: "Most resubmitted transfers are accepted within a few business days.",
} as const;

export const domainFr: Translated<typeof domainEn> = {
  panelLeadSources: "D'où viennent vos clients",
  panelLeadSourcesNote: "Quels canaux amènent réellement du travail.",
  panelPipeline: "Devis",
  panelPipelineNote: "Ce que vous avez proposé en devis ce mois-ci, et quelle part vous avez décrochée.",
  panelRecentCalls: "Appels récents",
  panelRecentCallsNote: "Les derniers appels, entrants et sortants.",
  panelResponseTime: "Temps de réponse",
  panelResponseTimeNote: "À quelle vitesse les nouveaux clients ont eu une réponse cette semaine.",
  panelSatisfaction: "Satisfaction",
  panelSatisfactionNote: "Si les personnes à qui vous avez répondu étaient satisfaites.",


  onCallBannerClaim: "Je m'en occupe",
  onCallBannerTaken: "s'en occupe",
  onCallBannerWaiting: "Personne ne s'en est encore occupé",
  onCallBannerYours: "Vous vous en occupez. Le reste de l'équipe a été prévenu.",
  onCallEscalation: "Si cette personne ne répond pas, tout le monde est prévenu quelques minutes plus tard.",
  onCallLine: "{name} est de garde jusqu'à {until}",
  onCallNobody: "Personne n'est de garde, alors un appel en dehors des heures réveille toutes les personnes qui voient le numéro. Mettez une seule personne de garde et le reste de l'équipe passe une nuit tranquille.",
  onCallPresetTonight: "Ce soir",
  onCallPresetTonightDetail: "De 18 h à 8 h demain",
  onCallPresetWeek: "Les 7 prochains jours",
  onCallPresetWeekDetail: "À partir de maintenant",
  onCallPresetWeekend: "Cette fin de semaine",
  onCallPresetWeekendDetail: "Du vendredi 18 h au lundi 8 h",
  onCallReadOnly: "Seul un propriétaire ou un administrateur peut changer qui est de garde.",
  onCallSilenceCancel: "La laisser activée",
  onCallSilenceChannelEmail: "Les courriels",
  onCallSilenceChannelPush: "Les alertes push",
  onCallSilenceConfirm: "La désactiver quand même",
  onCallSilenceWarning: "Vous êtes de garde en ce moment. {what} sont la façon dont un nouveau client à qui personne n'a répondu vous joint. Avec ce réglage désactivé, ces appels ne mènent nulle part et personne d'autre n'est prévenu. Passez le quart à quelqu'un d'abord si vous devez être injoignable.",
  onCallTakenLine: "{name} s'en occupe",
  onCallUntil: "de garde jusqu'à",


  handoverField: "Code à six chiffres",
  handoverRejected: "Ce code n'a pas fonctionné. Demandez-en un nouveau et réessayez.",
  handoverResend: "Envoyer de nouveau",
  handoverSubmit: "Confirmer",
  handoverTitle: "Confirmez votre identité",
  handoverWhereAuthenticator: "Ouvrez votre application d'authentification et entrez le code à six chiffres qu'elle affiche.",
  handoverWhereEmail: "Nous avons envoyé un code à six chiffres par courriel à l'adresse de votre compte. Il fonctionne une seule fois et expire dans dix minutes.",


  categoryAssignments: "Travail qui m'est confié",
  categoryMentions: "Quand quelqu'un me mentionne avec @",
  categoryMessagesAll: "Textos sur les tâches de tout le monde",
  categoryMessagesMine: "Textos sur mes tâches",
  categoryMissedCalls: "Appels manqués",
  categoryVoicemails: "Messages vocaux",
  deliveryBatched: "Regroupées",
  deliveryHeading: "Ce que nous vous disons",
  deliveryImmediate: "Immédiatement",
  deliverySummary: "Une fois par jour",
  deliverySummaryDetail: "Conservées pour votre résumé quotidien, pas supprimées.",
  deliveryUrgentAlways: "Une urgence, un appel pendant que vous êtes de garde, ou une alerte que personne n'a prise arrive toujours immédiatement, quel que soit votre choix ici.",


  referralAction: "Partager",
  referralAskAction: "Partager votre lien",
  referralAskBody: "Vous connaissez une autre équipe qui fait encore rouler son entreprise sur le cellulaire d'une seule personne ? Envoyez-lui votre lien — vous obtenez tous les deux un mois gratuit.",
  referralAskDismiss: "Pas maintenant",
  referralAskHeadlineMany: "Vous avez répondu à {count} clients ce mois-ci.",
  referralAskHeadlineOne: "Vous avez répondu à 1 client ce mois-ci.",
  referralCodeFallback: "Utilisez mon code {code} à votre inscription.",
  referralCopied: "Copié",
  referralCopy: "Copier",
  referralDraftLabel: "Votre message",
  referralLinkNote: "Votre lien s'ajoute automatiquement à la fin.",
  referralNote: "Nous passons notre ligne d'affaires par Loonext — les appels et les textos arrivent dans une seule boîte de réception et la personne libre répond. Prix fixe, aucuns frais par utilisateur. Inscrivez-vous avec mon lien et nous obtenons tous les deux un mois gratuit.",
  referralRewardLine: "Envoyez ceci à une autre entreprise. Quand elle s'inscrit et qu'un client lui répond par texto, vous obtenez tous les deux un mois gratuit",
  referralStageActive: "Toujours active après 30 jours",
  referralStageInvited: "Inscrite, aucune réponse encore",
  referralStageRewarded: "Mois gratuit appliqué",
  referralStageSignedUp: "En service",
  referralStageVoided: "Non comptabilisée",
  referralTitle: "Recommander une autre équipe",


  regStageApprovedNext: "Vous pouvez texter vos clients dès maintenant.",
  regStageApprovedTitle: "Vos textos sont en service",
  regStageExpected: "Habituellement de 3 à 7 jours ouvrables, parfois plus",
  regStageNeedsDetailsNext: "Remplissez le formulaire d'inscription aux textos et nous l'enverrons.",
  regStageNeedsDetailsTitle: "Il nous faut quelques renseignements sur l'entreprise",
  regStageRejectedNext: "Vérifiez les renseignements de votre inscription et renvoyez-la.",
  regStageRejectedTitle: "Les fournisseurs demandent une correction",
  regStageSubmittingNext: "Les fournisseurs l'examinent ensuite. Rien à faire de votre côté.",
  regStageSubmittingTitle: "Envoyée aux fournisseurs",
  regStageUnderReviewNext: "Nous vous écrirons par texto et par courriel dès que ce sera approuvé.",
  regStageUnderReviewTitle: "En cours d'examen par les fournisseurs",


  and: "et",
  numberAccessAdmins: "Les administrateurs peuvent utiliser tous les numéros",
  numberAccessCanText: "Peut texter",
  numberAccessHidden: "Masqué",
  numberAccessNoMatchThem: "Ce numéro a des règles, et aucune n'inclut cette personne",
  numberAccessNoMatchYou: "Ce numéro a des règles, et aucune ne vous inclut",
  numberAccessNotMemberThem: "Ne fait plus partie de cet espace de travail",
  numberAccessNotMemberYou: "Vous ne faites plus partie de cet espace de travail",
  numberAccessNoteOnly: "Consultation et notes seulement",
  numberAccessOwners: "Les propriétaires peuvent utiliser tous les numéros",
  numberAccessRuleForEveryone: "Une règle pour tout le monde",
  numberAccessRuleForRole: "Une règle pour le rôle {role}",
  numberAccessRuleForTheirRole: "Une règle pour son rôle",
  numberAccessRuleForYourRole: "Une règle pour votre rôle",
  numberAccessRuleNamingThem: "Une règle qui nomme cette personne",
  numberAccessRuleNamingYou: "Une règle qui vous nomme",
  numberAccessSelfHiddenMany: "{count} numéros vous sont masqués",
  numberAccessSelfHiddenOne: "{count} numéro vous est masqué",
  numberAccessSelfNote: "{parts}. C'est voulu — quelqu'un l'a configuré ainsi, et ce n'est pas l'application qui fait défaut. Demandez à un propriétaire ou à un administrateur s'il vous en faut davantage.",
  numberAccessSelfReadOnlyMany: "{count} sont en consultation seulement",
  numberAccessSelfReadOnlyOne: "{count} est en consultation seulement",
  numberAccessUnruled: "Personne n'a restreint ce numéro",


  clockTheirTimeAreaCode: "son heure locale, d'après son indicatif régional",
  clockTheirTimeContact: "son heure locale, définie sur sa fiche",
  clockWorkspaceTime: "l'heure de votre espace de travail — nous ne connaissons pas la sienne",
  scheduledCancelled: "Annulé — ce texto ne partira pas.",
  scheduledEmptyTitle: "Rien n'attend d'être envoyé.",
  scheduledHoldCustomerReplied: "Le client a répondu après votre programmation, alors nous avons retenu le message plutôt que de lui couper la parole. Envoyez-le quand même, ou annulez-le.",
  scheduledHoldExpired: "La fenêtre d'envoi est passée avant que ceci ne parte, alors le message n'a pas été envoyé. Un message en retard vaut habituellement moins que pas de message du tout.",
  scheduledHoldInvalidDestination: "Nous ne pouvons plus texter ce numéro, alors ceci n'a pas été envoyé.",
  scheduledHoldJobUnscheduled: "Cette tâche n'est plus prévue, alors ce rappel n'a pas été envoyé.",
  scheduledHoldOptedOut: "Le client a répondu STOP après votre programmation, alors le message n'a pas été envoyé. Lui seul peut annuler cela.",
  scheduledHoldRegistrationPending: "Ceci attend l'approbation des fournisseurs pour les textos américains. Le message partira dès que ce sera approuvé.",
  scheduledHoldServiceUnavailable: "Les textos sont en pause pendant que nous réglons un problème. Ceci est toujours en file et rien n'a été perdu.",
  scheduledHoldSubscriptionInactive: "Votre abonnement a expiré, alors ceci n'a pas été envoyé. Le message partira une fois la facturation réglée.",
  scheduledHoldWorkspaceClosed: "L'espace de travail a été fermé avant l'heure d'envoi prévue.",
  scheduledHoldWorkspacePaused: "Votre forfait est en pause, alors ceci n'a pas été envoyé. Le message partira à votre reprise.",
  scheduledNothingWaiting: "Rien n'est en attente d'envoi. Tout ce que vous programmez apparaît ici.",
  scheduledPickerReassurance: "Vous pouvez le modifier ou l'annuler à tout moment avant l'envoi.",
  scheduledPresetTomorrow: "Demain, 8 h",
  scheduledQuietHoursChoice: "Vous pouvez l'envoyer quand même, ou choisir une heure le matin chez eux.",
  scheduledQuietHoursUnknown: "Cette heure tombe dans les heures de silence de ce client.",


  sendFailureGeneric: "Non livré",
  sendFailureOptedOut: "Ce client s'est désabonné",
  sendFailureUnreachable: "Ce numéro ne peut pas recevoir de textos",
  sendFailureNotTextable: "Ce numéro n'accepte pas les textos",
  sendFailureBlockedNow: "Les fournisseurs bloquent ce message en ce moment",
  sendFailureSpam: "Les fournisseurs l'ont bloqué comme pourriel",
  sendFailureRateLimited: "Envoyé trop vite pour les fournisseurs. Réessayez sous peu",
  sendFailureHandsetRejected: "Son téléphone l'a refusé",
  sendFailureHandsetUnavailable: "Son téléphone n'a pas pu le recevoir",
  sendFailureExpired: "Il a expiré avant de pouvoir partir",
  sendFailureContent: "Les fournisseurs ont refusé ce message",
  sendFailureEmpty: "Il n'y avait rien à envoyer",
  sendFailureAttachment: "Les fournisseurs ont refusé cette pièce jointe",
  sendFailureTooLong: "Trop long pour être envoyé",
  sendFailureRegistration:
    "Votre inscription pour les textos américains n'est pas encore approuvée",
  sendFailureNumberNotReady: "Ce numéro n'est pas encore configuré pour les textos",
  sendFailureTextingOff: "Les textos sont désactivés pour ce numéro",
  sendFailureNoSms: "Ce numéro ne peut pas envoyer de textos",
  sendFailureNoMms: "Ce numéro ne peut pas envoyer d'images",

  rejectRegEinWhat: "Le numéro d'identification fiscale que vous avez donné ne correspond pas à ce que le registre gouvernemental détient pour votre entreprise.",
  rejectRegEinFix: "Vérifiez l'EIN ou le numéro d'entreprise sur un document fiscal et saisissez-le exactement, chiffres seulement.",
  rejectRegNameWhat: "La dénomination sociale que vous avez donnée ne correspond pas à celle de votre inscription gouvernementale.",
  rejectRegNameFix: "Utilisez la dénomination sociale exacte figurant sur vos documents d'inscription, y compris tout Ltd, Inc ou LLC — le nom que vos clients voient se règle séparément.",
  rejectRegAddressWhat: "L'adresse de l'entreprise ne correspond pas à celle de votre inscription gouvernementale.",
  rejectRegAddressFix: "Entrez l'adresse d'entreprise inscrite plutôt qu'une adresse postale ou de chantier.",
  rejectRegWebsiteWhat: "Le fournisseur n'a pas pu confirmer votre entreprise à partir du site web que vous avez donné.",
  rejectRegWebsiteFix: "Donnez un site web qui nomme votre entreprise et décrit ce que vous faites, et assurez-vous qu'il s'affiche publiquement.",
  rejectRegConsentWhat: "Le fournisseur n'a pas été convaincu que vos clients acceptent de recevoir vos textos avant que vous leur écriviez.",
  rejectRegConsentFix: "Décrivez exactement où un client vous donne son numéro et ce qu'on lui dit à ce moment-là.",
  rejectRegSampleWhat: "Les exemples de textos n'ont pas montré au fournisseur ce que vous envoyez réellement.",
  rejectRegSampleFix: "Utilisez de vrais messages que vous enverriez à un client, et incluez le nom de votre entreprise dans chacun.",
  rejectRegUseCaseWhat: "Le cas d'utilisation que vous avez choisi ne correspond pas à ce que décrivent vos exemples et votre site web.",
  rejectRegUseCaseFix: "Choisissez la catégorie qui correspond aux textos que vous envoyez réellement à vos clients.",
  rejectRegDuplicateWhat: "Cette entreprise est déjà inscrite auprès des fournisseurs, fort probablement par un service que vous utilisiez auparavant.",
  rejectRegDuplicateFix: "Répondez-nous et nous ferons libérer ou transférer l'inscription existante — le formulaire ne peut rien y changer.",
  rejectRegEntityWhat: "Le type d'entreprise que vous avez choisi ne correspond pas à la façon dont votre entreprise est inscrite.",
  rejectRegEntityFix: "Choisissez le type qui correspond à vos documents — une entreprise individuelle et une société par actions ne s'inscrivent pas de la même façon.",
  rejectRegContactWhat: "Le fournisseur n'a pas pu joindre les coordonnées inscrites sur la demande.",
  rejectRegContactFix: "Donnez un courriel et un numéro de téléphone d'entreprise qui joignent une personne et qui ne répondent pas automatiquement.",
  rejectPortAccountWhat: "Le numéro de compte ne correspond pas à celui que votre fournisseur actuel a au dossier.",
  rejectPortAccountFix: "Copiez-le sur une facture récente de ce fournisseur — ce n'est habituellement pas le numéro de téléphone lui-même.",
  rejectPortPinWhat: "Le NIP de transfert était absent ou erroné.",
  rejectPortPinFix: "Demandez un NIP de transfert à votre fournisseur actuel — la plupart ne le donnent qu'au titulaire du compte, et il expire souvent en quelques jours.",
  rejectPortAuthWhat: "La personne nommée sur la demande n'est pas autorisée sur le compte.",
  rejectPortAuthFix: "Utilisez le nom de la personne que votre fournisseur actuel a comme titulaire du compte, écrit de la même façon.",
  rejectPortEntityWhat: "Le nom du titulaire du compte ne correspond pas aux dossiers de votre fournisseur actuel.",
  rejectPortEntityFix: "Utilisez le nom exactement tel qu'il apparaît sur la facture, y compris tout Ltd, Inc ou LLC.",
  rejectPortAddressWhat: "L'adresse de service ne correspond pas à celle que votre fournisseur actuel a au dossier.",
  rejectPortAddressFix: "Utilisez l'adresse figurant sur la facture de cette ligne, même si l'entreprise a déménagé depuis.",
  rejectPortPendingWhat: "Votre fournisseur actuel a un autre changement en cours sur cette ligne.",
  rejectPortPendingFix: "Demandez-lui de l'annuler ou de le terminer, puis dites-le-nous et nous renverrons la demande.",
  rejectPortInactiveWhat: "Votre fournisseur actuel indique que ce numéro n'est pas actif sur le compte que nous avons cité.",
  rejectPortInactiveFix: "Vérifiez que le numéro est encore en service et rattaché au compte que vous nous avez donné — un numéro déjà résilié ne peut pas être transféré.",

  resubmitWaitRegistration:
    "La plupart des renvois sont tranchés en un ou deux jours ouvrables.",
  resubmitWaitPort:
    "La plupart des transferts renvoyés sont acceptés en quelques jours ouvrables.",
};
