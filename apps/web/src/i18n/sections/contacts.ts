/**
 * #228 — the words the customer list says, in both languages.
 *
 * One file per surface so the extraction can run in parallel without every
 * change colliding in one catalogue, and so a translator working through a
 * screen sees its strings adjacent rather than sorted by concept.
 *
 * `fr` is typed as `en`'s exact shape: a key added to one and forgotten in the
 * other fails `tsc`. That is the whole reason this is TypeScript rather than
 * the JSON a library would want — a missing key in a JSON message file is a
 * runtime fallback nobody sees until a French reader does.
 *
 * ## What is NOT translated here, on purpose
 *
 * `STOP` and `START` are carrier keywords: a customer texts those exact five
 * and four letters and a carrier matches on them, so a French reader is told to
 * text `START`, not `DÉBUT`. The same goes for the product names (Loonext,
 * Stripe) and the file formats (CSV, vCard) — a person looking for the .vcf
 * their phone exported is looking for a .vcf.
 *
 * The do-not-text FLAG SPELLINGS (`true`, `yes`, `y`, `1`, `x`) are interpolated
 * rather than written into a sentence for the same reason: they are what
 * `readContactFlag` matches in somebody's spreadsheet, and a translated `oui`
 * would be a promise the reader cannot keep.
 *
 * ## The one place a sentence is split
 *
 * `consentNotRecordedLead` / `consentNotRecordedTail` wrap a count that carries
 * its own `tabular-nums` span, so the sentence cannot be a single key without
 * deleting the element. It is safe here only because the count sits in the same
 * position in both languages; anywhere the order would move, the whole sentence
 * is one key with a `{token}` and the translator places it.
 */
import type { Translated } from "../translated";

export const contactsEn = {
  // ── The context panel: who this is ──────────────────────────────────────
  contactLoadFailed: "Couldn't load this contact.",
  contactNameLabel: "Contact name",
  addName: "Add a name",
  contactAddressLabel: "Contact address",
  addAddress: "Add an address",
  copyNumber: "Copy number",
  numberCopied: "Number copied",
  openContactPage: "Open full contact page",
  /** An inline field's accessible name: what it is, then what it says. */
  fieldValueAria: "{label}: {value}",
  notesPlaceholder: "Notes about this customer…",
  notesLabel: "Contact notes",
  saveNameFailed: "Couldn't save the name. Try again.",
  saveAddressFailed: "Couldn't save the address. Try again.",
  saveNotesFailed: "Couldn't save notes. Try again.",

  // ── Consent ─────────────────────────────────────────────────────────────
  consentGroup: "Consent",
  consentTextedFirst: "Texted you first",
  consentTextedFirstOn: "Texted you first · {date}",
  consentRecordedBy: "Consent recorded by {name}",
  consentRecordedByOn: "Consent recorded by {name} · {date}",
  consentNone: "No consent recorded yet",
  aTeammate: "a teammate",
  optedOut: "Opted out",
  carrierOptOutNote:
    "They texted STOP, so their carrier is blocking your texts. Only they can " +
    "undo it, by texting START to your number.",
  markOptedIn: "Mark opted in again",
  working: "Working…",
  optedInAgain: "Marked opted in again.",
  optOutUpdateFailed: "Couldn't update opt-out.",
  optOutAction: "Opt out this contact",
  optOutTitle: "Opt out {name}?",
  optOutConfirmBody:
    "They won't receive texts from you anymore. Use this when a customer asks " +
    "to stop hearing from you in any words.",
  optingOut: "Opting out…",
  optOut: "Opt out",
  contactOptedOut: "Contact opted out.",
  optOutFailed: "Couldn't opt out the contact.",

  // ── The language this customer hears from us in ─────────────────────────
  languageGroup: "Language",
  languageGroupLabel: "Language for this customer",
  languageNote:
    "Automatic texts only. What you type is sent exactly as you type it.",
  sameAsWorkspace: "Same as workspace",
  sameAsWorkspaceNamed: "Same as workspace ({language})",
  languageSaved: "Language saved.",
  languageBackToWorkspace: "Back to the workspace language.",
  languageSaveFailed: "Couldn't save the language. Try again.",

  // ── The conversation's task checklist ───────────────────────────────────
  tasksGroup: "Tasks",
  tasksLoadFailed: "Couldn't load tasks for this conversation.",
  tasksEmpty:
    "No tasks yet. Promote a message from its {menu} menu to track it here.",
  taskFilesTitle: "Open the task to see its files",
  fileOnTask: "file on this task",
  filesOnTask: "files on this task",
  markDone: "Mark done",
  markNotDone: "Mark not done",
  taskMarkedDone: "Task marked done",
  taskUpdateFailed: "Couldn't update this task. Try again.",

  // ── Where this customer came from ───────────────────────────────────────
  leadSourceGroup: "Where they came from",
  sourceFromLine: "· the line they called",
  sourceSaidSo: "· somebody said so",
  askHowTheyHeard: "Ask them: how did you hear about us?",
  dontKnow: "Don't know",
  leadSourceSaveFailed: "That could not be saved.",

  // ── Tags ────────────────────────────────────────────────────────────────
  tagsGroup: "Tags",
  addTag: "Add a tag",
  tagChip: "Tag",
  tagSearchPlaceholder: "Find or create a tag…",
  removeTag: "Remove tag {name}",
  typeToCreateTag: "Type to create a tag.",
  typeToFindTag: "Type to find a tag.",
  noTagAskAdmin: "No tag by that name. Ask an admin to add it.",
  didYouMean: "Did you mean “{name}”?",
  createTag: "Create “{name}”",
  tagRemoveFailed: "Couldn't remove the tag.",
  tagAddFailed: "Couldn't add the tag.",
  tagCreateFailed: "Couldn't create the tag.",

  // ── Prior conversations with this contact ───────────────────────────────
  conversationsGroup: "Conversations",
  priorConversationsFailed: "Couldn't load prior conversations.",
  noPriorConversations: "No other conversations with this contact.",

  // ── Field names, shared by the forms and the tables that show them ──────
  fieldLabel: "Label",
  fieldName: "Name",
  fieldNumber: "Number",
  fieldPhone: "Phone",
  fieldAddress: "Address",
  fieldNotes: "Notes",
  fieldResult: "Result",
  add: "Add",
  done: "Done",
  loading: "Loading…",
  yes: "Yes",
  no: "No",
  notSet: "Not set",
  notAsked: "Not asked",

  // ── The other addresses this customer has ───────────────────────────────
  addressPrimary: "Where the van goes",
  addressMakePrimary: "Make it the main one",
  addressLabelPlaceholder: "Unit 4, Billing, the rooftop…",
  addressPlaceholder: "Where the job is",
  addressAddAnother: "Add another address",
  addressRemove: "Remove {address}",
  addressAddFailed: "Couldn't add that address.",

  // ── The other numbers this customer answers ─────────────────────────────
  phoneLabelPlaceholder: "Landline, the wife, the shop…",
  phonePlaceholder: "Another number they answer",
  phoneAddLabel: "Add another number",
  phoneMatchNote:
    "Texts and calls from this number will show up under this customer, in " +
    "their own thread.",
  phoneRemove: "Remove {number}",
  phoneAddFailed: "Couldn't add that number.",

  // ── The workspace's own fields, filled in on a contact ──────────────────
  customFieldSaveFailed: "Couldn't save {label}.",

  // ── Narrowing the list to one answer ────────────────────────────────────
  filterNarrowBy: "Narrow by",
  filterEveryone: "Everyone",
  filterShowEveryone: "Show everyone again",

  // ── The contacts table ──────────────────────────────────────────────────
  searchPlaceholder: "Search name or number",
  searchLabel: "Search contacts",
  loadingContacts: "Loading contacts",
  noMatchesFor: "No matches for \"{query}\"",
  noMatchesDetail: "Try a name or the last few digits of a number.",
  filteredEmptyTitle: "Nobody matches that yet",
  filteredEmptyDetail:
    "No customer has that answer on file. Clear the filter to see everyone.",
  emptyTitle: "Your customers show up here on their own",
  emptyDetail:
    "Every person who texts your business number is added automatically, or " +
    "bring your list over in one go.",
  fieldLastActivity: "Last activity",
  openContact: "Open {name}",
  noTextingActivity: "No texting activity yet",
  loadMore: "Load more",

  // ── The contacts toolbar ────────────────────────────────────────────────
  newContact: "New contact",
  exporting: "Exporting…",
  exportAction: "Export",
  importAction: "Import",
  importCsv: "CSV file",
  importVcard: "vCard file (.vcf)",
  importFromPhone: "Pick from phone",
  exportFailed: "The export didn't go through. Try again.",

  // ── Adding one contact by hand ──────────────────────────────────────────
  newContactBlurb:
    "A number already on file updates that contact instead of adding a second one.",
  optional: "Optional",
  adding: "Adding…",
  addContact: "Add contact",
  contactAdded: "Contact added",
  phoneInvalid: "Enter a 10-digit US or Canada number.",
  addContactFailed: "Couldn't add that contact. Try again.",

  // ── Duplicates, and merging them ────────────────────────────────────────
  duplicatesOnePair: "These two look like the same customer",
  duplicatesManyPairs: "{count} pairs look like the same customer",
  duplicatesBlurb:
    "Merging keeps every message, task and photo from both, under one record.",
  duplicateAnd: " and ",
  merge: "Merge",
  mergeTitle: "Merge these two customers",
  mergeBlurb:
    "Everything from both — messages, tasks, photos, notes — ends up under the " +
    "record you keep. Both phone numbers keep working.",
  mergeWhichToKeep: "Which one to keep",
  mergeDirection:
    "{folded} stops being a separate customer. Its history moves to {survivor}.",
  merging: "Merging…",
  mergedOptedOut:
    "Merged. This customer is opted out, so nothing sends to either number.",
  merged: "Merged.",
  mergeFailed: "Couldn't merge those. Try again in a moment.",

  // ── This customer's history, as a document ──────────────────────────────
  exportHistoryAction: "Export their messages",
  exportHistoryBlurb:
    "A document of everything said with this customer, for an insurer, a lawyer " +
    "or your own records.",
  exportHistoryNote:
    "Leave the dates empty for the whole history. It is put together in the " +
    "background, and the owner is told an export was taken.",
  exportFrom: "From",
  exportTo: "To",
  exportStart: "Start it",
  exportAlreadyBuilding:
    "One is already being put together. It will appear in Settings › Data export.",
  exportBuilding:
    "Being put together now. It will appear in Settings › Data export.",
  exportStartFailed: "That could not be started.",

  // ── The call history on the contact page ────────────────────────────────
  callHistory: "Call history",
  callHistoryLoading: "Loading call history",
  callsLoadFailed: "Couldn't load their calls.",
  callsLoadFailedDetail: "Check your connection and try again.",
  noCallsYet: "No calls with this contact yet.",
  noCallsYetDetail: "Calls between you and this customer will show up here.",
  showMore: "Show more",

  // ── The whole relationship, in one stream ───────────────────────────────
  historyHeading: "History",
  historyLoading: "Loading their history",
  historyLoadFailed: "Couldn't load their history.",
  historyLoadFailedDetail: "Try again in a moment.",
  historyEmpty: "Nothing yet.",
  historyEmptyDetail:
    "Texts, calls and jobs for this customer will collect here.",
  jumpToDate: "Jump to a date in this history",
  showEarlier: "Show earlier",
  timelineJob: "Job",
  timelineCallAnsweredBy: "Call answered by {name}",
  timelineCallAnswered: "Call answered",
  timelineVoicemail: "Voicemail",
  timelineMissedCall: "Missed call",
  timelineConversation: "Conversation",
  timelineDone: "Done",
  timelineDue: "Due {date}",
  timelineOpen: "Open",
  timelineTalkedFor: "Talked for {duration}",
  timelineNoAnswer: "No answer",
  timelineClosed: "Closed",

  // ── The question every bulk-import door has to ask ──────────────────────
  consentLabelFile: "Everyone in this file agreed to be texted by this business.",
  consentLabelPicked: "Everyone I pick agreed to be texted by this business.",
  consentFactNoTexts: "Importing texts nobody.",
  consentFactStop: "Anyone who has replied STOP stays blocked.",
  consentFactExisting:
    "Contacts who already have a consent record keep the one they have.",

  // ── The rows an import brought in but could not attest for ──────────────
  consentNotRecordedLead: "Consent not recorded for",
  consentNotRecordedTail: "of these contacts",
  consentRefusedNote:
    "Some of these customers have already asked this business to stop texting them. They were imported and their opt-out still stands — your consent statement was not recorded against them.",
  downloadRefusedRows: "Download the refused rows",
  andMore: "…and {count} more.",

  // ── The shared import summary ───────────────────────────────────────────
  importFinished: "Import finished",
  importFailed: "The import didn't go through. Try again.",
  importAnother: "Import another",

  // ── Importing from the phone's own address book ─────────────────────────
  pickerTitle: "Import from your phone",
  pickerBlurb:
    "Choose contacts from your device. We'll import the ones with a valid US or " +
    "Canada number. Existing numbers are updated, not duplicated.",
  pickerErrorsHeading:
    "These couldn't be imported (usually a number that isn't a US or Canada mobile):",
  pickMore: "Pick more",
  pickerUnavailable: "Picking from your phone isn't available on this device.",
  pickerNoNumbers: "None of the contacts you picked had a phone number to import.",
  pickerOpening: "Opening your contacts…",
  importing: "Importing…",
  chooseContacts: "Choose contacts",

  // ── Importing a vCard ───────────────────────────────────────────────────
  vcardTitle: "Import from a vCard",
  vcardBlurb:
    "Upload a .vcf file exported from your phone, Google Contacts, or Apple " +
    "Contacts. We'll add each contact with a valid US or Canada number. " +
    "Existing numbers are updated, not duplicated.",
  vcardErrorsHeading: "These rows couldn't be imported:",
  vcardCardRow: "Card {row}:",
  vcardCardsTitle: "What's on these cards?",
  vcardCardsCount: "{file} · {cards} cards.",
  vcardUnreadOne: "One thing on them isn't a name or a number.",
  vcardUnreadMany: "{count} things on them aren't names or numbers.",
  vcardNoGuess:
    "A card can carry a note saying somebody asked you to stop, so we won't " +
    "guess what these are.",
  vcardParameterNote:
    "A name with a semicolon in it, like TEL;TYPE, is a label written on a line " +
    "rather than a line of its own. Phones write notes in those too, so they get " +
    "the same question.",
  vcardPropertyEmpty: "On {cards} cards, with nothing in it.",
  vcardPropertyOn: "On {cards} of {total} cards. Says",
  vcardPropertyQuestion: "What is {property}?",
  vcardSkipIt: "Skip it",
  vcardNeverText: "Never text these cards",
  vcardUnansweredOne: "One of these still needs an answer.",
  vcardUnansweredMany: "{count} of these still need an answer.",
  vcardUnansweredTail:
    "Skipping something that says do not text means this import texts somebody " +
    "who asked you to stop.",
  vcardIgnoreOne: "It doesn't say who can be texted",
  vcardImportCards: "Import {count} cards",
  vcardChooseFile: "Choose a .vcf file",
  vcardImportingFile: "Importing {file}…",
  vcardUpTo: "Up to {size}",
  vcardFileInput: "vCard file",
  vcardTooBig: "That file is over {size}. Export a smaller batch and retry.",

  // ── Importing a CSV ─────────────────────────────────────────────────────
  answerPhone: "Phone number",
  answerName: "Full name",
  answerFirstName: "First name",
  answerLastName: "Last name",
  answerAddress: "Address",
  answerNotes: "Notes",
  answerOptedOut: "Do not text (opted out)",
  answerIgnore: "Skip this column",
  chooseWhatThisIs: "Choose what this is",
  columnNoHeader: "Column {number} (no header)",
  columnQuoted: "“{header}”",
  columnAllBlank: "Every row leaves this blank.",
  columnSays: "Says",
  columnQuestion: "What is {column}?",
  csvTitle: "Import contacts",
  csvBlurb:
    "Upload a CSV with a header row. You'll say what every column is and see " +
    "exactly what happens before anything is imported.",
  csvChooseFile: "Choose a CSV file",
  csvUpTo: "Up to {rows} rows / {size}",
  csvFileInput: "CSV file",
  csvTooBig: "That file is over {size}. Split it and import in parts.",
  csvNeedsHeader: "That file needs a header row and at least one contact row.",
  csvTooManyRows: "That's over {rows} rows. Split the file and import in parts.",
  csvUnreadable: "Couldn't read that file. Save it as a CSV and retry.",
  csvColumnsTitle: "What's in your columns?",
  csvColumnsBlurb:
    "{file} · {rows} rows · {answered} of {columns} columns answered. Nothing " +
    "gets skipped unless you say so: a do-not-text column we drop by mistake " +
    "texts somebody who asked you to stop.",
  unrecognisedOne: "One column we don't recognise",
  unrecognisedMany: "{count} columns we don't recognise",
  unrecognisedBlurb:
    "We won't guess what these mean. Read what each one says below, then tell " +
    "us. If one of them is a do-not-text column and we skip it, this import " +
    "texts somebody who asked you to stop.",
  ignoreAllOne: "None of this says who can be texted",
  ignoreAllMany: "None of these say who can be texted",
  answeredSome: "Answered. Read what these say, and change anything that's wrong.",
  answeredAll:
    "Every column in your file, and what it says. Read them before you " +
    "continue, and change anything that's wrong.",
  conflictTitle: "Two columns can't be the same thing",
  conflictSetTo: "{columns} are both set to",
  conflictOnePerContact:
    ". A contact has one. Pick a different answer for one of them.",
  joinAnd: " and ",
  splitNameNote:
    "First name and Last name are saved as one name. When a file has those and " +
    "a Full name column, the first and last win: a \"Full name\" column is " +
    "usually the business, not the person.",
  unreadableTitle: "We can't read {column}",
  unreadableLead:
    "You set it to \"Do not text\", and it carries values that aren't yes or no:",
  unreadableOverflow: ", and {count} more",
  unreadableTail:
    ". Reading those as blank would text somebody who asked you to stop. Put " +
    "{trueValues} on the rows to block and {falseValues} or nothing on the " +
    "rest, or set a different column to \"Do not text\".",
  doNotTextNote:
    "About \"Do not text\": rows marked {trueValues} in that column are blocked " +
    "from texting the moment they're imported. Use it for customers who already " +
    "asked not to be texted. {falseValues} or a blank cell leaves texting on, " +
    "and anything else stops the import rather than being guessed at.",
  previewAction: "Preview import",
  gateAnswerEvery: "Answer every column to continue.",
  gateConflict: "Two columns are set to the same thing. Change one to continue.",
  gateUnreadable: "Fix the do-not-text column to continue.",
  gatePhone:
    "Set one column to Phone number to continue. It's the one field every " +
    "contact needs.",
  previewTitle: "Check before importing",
  previewWillImport: "{count} will import",
  previewOptedOut: " ({count} marked opted out)",
  previewSkipped: " · {count} will be skipped",
  previewDedupeNote:
    ". Existing contacts with the same number are updated, not duplicated.",
  resultImportsOptedOut: "Imports, opted out",
  resultImports: "Imports",
  resultSkipped: "Skipped: {reason}",
  previewShowingFirst: "Showing the first {shown} of {total} rows.",
  importCount: "Import {count} contacts",
  importingNow:
    "Importing your contacts. This window stays open until it finishes so the " +
    "summary and skipped rows aren't lost.",
  doneSummary: "{imported} new, {updated} updated, {skipped} skipped.",
  skippedRowsBlurb:
    "Skipped rows kept their reasons. Download them, fix the numbers, and " +
    "import just that file again.",
  downloadSkippedRows: "Download skipped rows",
} as const;

/**
 * Quebec French, vouvoiement throughout, accents spelled normally — see
 * `catalog.ts` for why the GSM-7 restriction that governs the automated SMS
 * bodies does not reach a web page.
 *
 * A normal space before `:`, `?`, `!` and `;`, and inside `«  »`.
 */
export const contactsFr: Translated<typeof contactsEn> = {
  // ── La fiche du client ──────────────────────────────────────────────────
  contactLoadFailed: "Impossible de charger ce client.",
  contactNameLabel: "Nom du client",
  addName: "Ajouter un nom",
  contactAddressLabel: "Adresse du client",
  addAddress: "Ajouter une adresse",
  copyNumber: "Copier le numéro",
  numberCopied: "Numéro copié",
  openContactPage: "Ouvrir la fiche complète",
  fieldValueAria: "{label} : {value}",
  notesPlaceholder: "Notes sur ce client…",
  notesLabel: "Notes sur le client",
  saveNameFailed: "Impossible d'enregistrer le nom. Réessayez.",
  saveAddressFailed: "Impossible d'enregistrer l'adresse. Réessayez.",
  saveNotesFailed: "Impossible d'enregistrer les notes. Réessayez.",

  // ── Consentement ────────────────────────────────────────────────────────
  consentGroup: "Consentement",
  consentTextedFirst: "Vous a écrit en premier",
  consentTextedFirstOn: "Vous a écrit en premier · {date}",
  consentRecordedBy: "Consentement enregistré par {name}",
  consentRecordedByOn: "Consentement enregistré par {name} · {date}",
  consentNone: "Aucun consentement enregistré",
  aTeammate: "un membre de l'équipe",
  optedOut: "Désabonné",
  carrierOptOutNote:
    "Ce client a texté STOP : son fournisseur bloque donc vos textos. Lui seul " +
    "peut annuler ce blocage, en textant START à votre numéro.",
  markOptedIn: "Réactiver les envois",
  working: "En cours…",
  optedInAgain: "Envois réactivés.",
  optOutUpdateFailed: "Impossible de modifier le désabonnement.",
  optOutAction: "Désabonner ce client",
  optOutTitle: "Désabonner {name} ?",
  optOutConfirmBody:
    "Ce client ne recevra plus vos textos. Utilisez cette option quand un " +
    "client demande, dans ses mots à lui, de ne plus être contacté.",
  optingOut: "Désabonnement…",
  optOut: "Désabonner",
  contactOptedOut: "Client désabonné.",
  optOutFailed: "Impossible de désabonner ce client.",

  // ── La langue dans laquelle ce client nous lit ──────────────────────────
  languageGroup: "Langue",
  languageGroupLabel: "Langue de ce client",
  languageNote:
    "Textos automatiques seulement. Ce que vous écrivez est envoyé exactement " +
    "tel quel.",
  sameAsWorkspace: "Comme l'espace de travail",
  sameAsWorkspaceNamed: "Comme l'espace de travail ({language})",
  languageSaved: "Langue enregistrée.",
  languageBackToWorkspace: "Retour à la langue de l'espace de travail.",
  languageSaveFailed: "Impossible d'enregistrer la langue. Réessayez.",

  // ── Les tâches de la conversation ───────────────────────────────────────
  tasksGroup: "Tâches",
  tasksLoadFailed: "Impossible de charger les tâches de cette conversation.",
  tasksEmpty:
    "Aucune tâche. Transformez un message en tâche depuis son menu {menu} pour " +
    "la suivre ici.",
  taskFilesTitle: "Ouvrir la tâche pour voir ses fichiers",
  fileOnTask: "fichier sur cette tâche",
  filesOnTask: "fichiers sur cette tâche",
  markDone: "Marquer comme faite",
  markNotDone: "Marquer comme non faite",
  taskMarkedDone: "Tâche marquée comme faite",
  taskUpdateFailed: "Impossible de modifier cette tâche. Réessayez.",

  // ── D'où vient ce client ────────────────────────────────────────────────
  leadSourceGroup: "D'où il vient",
  sourceFromLine: "· la ligne composée",
  sourceSaidSo: "· quelqu'un l'a indiqué",
  askHowTheyHeard: "Demandez-lui : comment avez-vous entendu parler de nous ?",
  dontKnow: "Je ne sais pas",
  leadSourceSaveFailed: "Impossible d'enregistrer.",

  // ── Étiquettes ──────────────────────────────────────────────────────────
  tagsGroup: "Étiquettes",
  addTag: "Ajouter une étiquette",
  tagChip: "Étiquette",
  tagSearchPlaceholder: "Trouver ou créer une étiquette…",
  removeTag: "Retirer l'étiquette {name}",
  typeToCreateTag: "Écrivez pour créer une étiquette.",
  typeToFindTag: "Écrivez pour trouver une étiquette.",
  noTagAskAdmin:
    "Aucune étiquette de ce nom. Demandez à un administrateur de l'ajouter.",
  didYouMean: "Vouliez-vous dire « {name} » ?",
  createTag: "Créer « {name} »",
  tagRemoveFailed: "Impossible de retirer l'étiquette.",
  tagAddFailed: "Impossible d'ajouter l'étiquette.",
  tagCreateFailed: "Impossible de créer l'étiquette.",

  // ── Les conversations précédentes ───────────────────────────────────────
  conversationsGroup: "Conversations",
  priorConversationsFailed:
    "Impossible de charger les conversations précédentes.",
  noPriorConversations: "Aucune autre conversation avec ce client.",

  // ── Noms de champs, partagés par les formulaires et les tableaux ────────
  fieldLabel: "Libellé",
  fieldName: "Nom",
  fieldNumber: "Numéro",
  fieldPhone: "Téléphone",
  fieldAddress: "Adresse",
  fieldNotes: "Notes",
  fieldResult: "Résultat",
  add: "Ajouter",
  done: "Terminé",
  loading: "Chargement…",
  yes: "Oui",
  no: "Non",
  notSet: "Non renseigné",
  notAsked: "Pas demandé",

  // ── Les autres adresses de ce client ────────────────────────────────────
  addressPrimary: "Où le camion se rend",
  addressMakePrimary: "En faire l'adresse principale",
  addressLabelPlaceholder: "Unité 4, Facturation, le toit…",
  addressPlaceholder: "Où se fait la tâche",
  addressAddAnother: "Ajouter une autre adresse",
  addressRemove: "Retirer {address}",
  addressAddFailed: "Impossible d'ajouter cette adresse.",

  // ── Les autres numéros auxquels ce client répond ────────────────────────
  phoneLabelPlaceholder: "Fixe, la conjointe, l'atelier…",
  phonePlaceholder: "Un autre numéro auquel il répond",
  phoneAddLabel: "Ajouter un autre numéro",
  phoneMatchNote:
    "Les textos et les appels provenant de ce numéro apparaîtront sous ce " +
    "client, dans sa propre conversation.",
  phoneRemove: "Retirer {number}",
  phoneAddFailed: "Impossible d'ajouter ce numéro.",

  // ── Les champs propres à l'espace de travail ────────────────────────────
  customFieldSaveFailed: "Impossible d'enregistrer {label}.",

  // ── Restreindre la liste à une seule réponse ────────────────────────────
  filterNarrowBy: "Filtrer par",
  filterEveryone: "Tout le monde",
  filterShowEveryone: "Afficher tout le monde",

  // ── Le tableau des clients ──────────────────────────────────────────────
  searchPlaceholder: "Chercher un nom ou un numéro",
  searchLabel: "Chercher des clients",
  loadingContacts: "Chargement des clients",
  noMatchesFor: "Aucun résultat pour « {query} »",
  noMatchesDetail: "Essayez un nom ou les derniers chiffres d'un numéro.",
  filteredEmptyTitle: "Personne ne correspond pour l'instant",
  filteredEmptyDetail:
    "Aucun client n'a cette réponse au dossier. Retirez le filtre pour voir " +
    "tout le monde.",
  emptyTitle: "Vos clients apparaissent ici d'eux-mêmes",
  emptyDetail:
    "Chaque personne qui texte le numéro de votre entreprise est ajoutée " +
    "automatiquement, ou importez votre liste d'un coup.",
  fieldLastActivity: "Dernière activité",
  openContact: "Ouvrir {name}",
  noTextingActivity: "Aucun échange de textos pour l'instant",
  loadMore: "Afficher plus",

  // ── La barre d'actions ──────────────────────────────────────────────────
  newContact: "Nouveau client",
  exporting: "Exportation…",
  exportAction: "Exporter",
  importAction: "Importer",
  importCsv: "Fichier CSV",
  importVcard: "Fichier vCard (.vcf)",
  importFromPhone: "Depuis le téléphone",
  exportFailed: "L'exportation a échoué. Réessayez.",

  // ── Ajouter un client à la main ─────────────────────────────────────────
  newContactBlurb:
    "Un numéro déjà au dossier met ce client à jour au lieu d'en créer un second.",
  optional: "Facultatif",
  adding: "Ajout…",
  addContact: "Ajouter le client",
  contactAdded: "Client ajouté",
  phoneInvalid: "Entrez un numéro à 10 chiffres des États-Unis ou du Canada.",
  addContactFailed: "Impossible d'ajouter ce client. Réessayez.",

  // ── Les doublons, et leur fusion ────────────────────────────────────────
  duplicatesOnePair: "Ces deux fiches semblent être le même client",
  duplicatesManyPairs: "{count} paires semblent être le même client",
  duplicatesBlurb:
    "La fusion conserve chaque message, tâche et photo des deux fiches, sous " +
    "un seul dossier.",
  duplicateAnd: " et ",
  merge: "Fusionner",
  mergeTitle: "Fusionner ces deux clients",
  mergeBlurb:
    "Tout ce que contiennent les deux fiches — messages, tâches, photos, " +
    "notes — se retrouve sous celle que vous gardez. Les deux numéros " +
    "continuent de fonctionner.",
  mergeWhichToKeep: "Laquelle garder",
  mergeDirection:
    "{folded} ne sera plus un client distinct. Son historique passe à {survivor}.",
  merging: "Fusion…",
  mergedOptedOut:
    "Fusionné. Ce client est désabonné : rien ne sera envoyé à l'un ou l'autre " +
    "numéro.",
  merged: "Fusionné.",
  mergeFailed: "Impossible de fusionner. Réessayez dans un moment.",

  // ── L'historique de ce client, en document ──────────────────────────────
  exportHistoryAction: "Exporter ses messages",
  exportHistoryBlurb:
    "Un document de tout ce qui s'est dit avec ce client, pour un assureur, un " +
    "avocat ou vos propres dossiers.",
  exportHistoryNote:
    "Laissez les dates vides pour tout l'historique. Le document est préparé en " +
    "arrière-plan, et le propriétaire est avisé qu'une exportation a été faite.",
  exportFrom: "Du",
  exportTo: "Au",
  exportStart: "Lancer",
  exportAlreadyBuilding:
    "Une exportation est déjà en préparation. Elle apparaîtra dans Paramètres › " +
    "Exportation de données.",
  exportBuilding:
    "En préparation. Elle apparaîtra dans Paramètres › Exportation de données.",
  exportStartFailed: "Impossible de lancer l'exportation.",

  // ── L'historique d'appels sur la fiche ──────────────────────────────────
  callHistory: "Historique d'appels",
  callHistoryLoading: "Chargement de l'historique d'appels",
  callsLoadFailed: "Impossible de charger ses appels.",
  callsLoadFailedDetail: "Vérifiez votre connexion et réessayez.",
  noCallsYet: "Aucun appel avec ce client pour l'instant.",
  noCallsYetDetail: "Les appels entre vous et ce client apparaîtront ici.",
  showMore: "Afficher plus",

  // ── Toute la relation, en un seul fil ───────────────────────────────────
  historyHeading: "Historique",
  historyLoading: "Chargement de son historique",
  historyLoadFailed: "Impossible de charger son historique.",
  historyLoadFailedDetail: "Réessayez dans un moment.",
  historyEmpty: "Rien pour l'instant.",
  historyEmptyDetail:
    "Les textos, les appels et les tâches de ce client s'accumuleront ici.",
  jumpToDate: "Aller à une date de cet historique",
  showEarlier: "Afficher les plus anciens",
  timelineJob: "Tâche",
  timelineCallAnsweredBy: "Appel pris par {name}",
  timelineCallAnswered: "Appel pris",
  timelineVoicemail: "Message vocal",
  timelineMissedCall: "Appel manqué",
  timelineConversation: "Conversation",
  timelineDone: "Faite",
  timelineDue: "Échéance {date}",
  timelineOpen: "Ouverte",
  timelineTalkedFor: "Durée de l'appel : {duration}",
  timelineNoAnswer: "Sans réponse",
  timelineClosed: "Fermée",

  // ── La question que chaque porte d'importation doit poser ───────────────
  consentLabelFile:
    "Toutes les personnes de ce fichier ont accepté de recevoir des textos de " +
    "cette entreprise.",
  consentLabelPicked:
    "Toutes les personnes que je choisis ont accepté de recevoir des textos de " +
    "cette entreprise.",
  consentFactNoTexts: "L'importation n'envoie aucun texto.",
  consentFactStop: "Toute personne ayant répondu STOP reste bloquée.",
  consentFactExisting:
    "Les clients qui ont déjà un consentement au dossier conservent celui-ci.",

  // ── Les lignes importées sans consentement enregistré ───────────────────
  consentNotRecordedLead: "Consentement non enregistré pour",
  consentNotRecordedTail: "de ces clients",
  consentRefusedNote:
    "Certains de ces clients ont déjà demandé à cette entreprise de cesser de leur envoyer des textos. Ils ont été importés et leur désabonnement demeure en vigueur — votre déclaration de consentement n'a pas été enregistrée pour eux.",
  downloadRefusedRows: "Télécharger les lignes refusées",
  andMore: "…et {count} de plus.",

  // ── Le sommaire d'importation partagé ───────────────────────────────────
  importFinished: "Importation terminée",
  importFailed: "L'importation a échoué. Réessayez.",
  importAnother: "Importer un autre fichier",

  // ── Importer depuis le carnet d'adresses du téléphone ───────────────────
  pickerTitle: "Importer depuis votre téléphone",
  pickerBlurb:
    "Choisissez des contacts sur votre appareil. Nous importerons ceux qui ont " +
    "un numéro valide des États-Unis ou du Canada. Les numéros existants sont " +
    "mis à jour, pas dupliqués.",
  pickerErrorsHeading:
    "Ces lignes n'ont pas pu être importées (habituellement un numéro qui n'est " +
    "pas un mobile des États-Unis ou du Canada) :",
  pickMore: "Choisir d'autres contacts",
  pickerUnavailable:
    "La sélection depuis votre téléphone n'est pas offerte sur cet appareil.",
  pickerNoNumbers:
    "Aucun des contacts choisis n'avait de numéro de téléphone à importer.",
  pickerOpening: "Ouverture de vos contacts…",
  importing: "Importation…",
  chooseContacts: "Choisir des contacts",

  // ── Importer une vCard ──────────────────────────────────────────────────
  vcardTitle: "Importer depuis une vCard",
  vcardBlurb:
    "Téléversez un fichier .vcf exporté depuis votre téléphone, Google Contacts " +
    "ou Apple Contacts. Nous ajouterons chaque client ayant un numéro valide " +
    "des États-Unis ou du Canada. Les numéros existants sont mis à jour, pas " +
    "dupliqués.",
  vcardErrorsHeading: "Ces lignes n'ont pas pu être importées :",
  vcardCardRow: "Fiche {row} :",
  vcardCardsTitle: "Qu'y a-t-il sur ces fiches ?",
  vcardCardsCount: "{file} · {cards} fiches.",
  vcardUnreadOne: "Un élément n'est ni un nom ni un numéro.",
  vcardUnreadMany: "{count} éléments ne sont ni des noms ni des numéros.",
  vcardNoGuess:
    "Une fiche peut contenir une note indiquant qu'une personne a demandé " +
    "d'arrêter : nous ne devinerons donc pas ce que ces éléments signifient.",
  vcardParameterNote:
    "Un nom contenant un point-virgule, comme TEL;TYPE, est un libellé écrit " +
    "sur une ligne plutôt qu'une ligne à part. Les téléphones y écrivent aussi " +
    "des notes, d'où la même question.",
  vcardPropertyEmpty: "Sur {cards} fiches, sans contenu.",
  vcardPropertyOn: "Sur {cards} fiches sur {total}. Contient",
  vcardPropertyQuestion: "Qu'est-ce que {property} ?",
  vcardSkipIt: "Ignorer",
  vcardNeverText: "Ne jamais texter ces fiches",
  vcardUnansweredOne: "Un de ces éléments attend encore une réponse.",
  vcardUnansweredMany: "{count} de ces éléments attendent encore une réponse.",
  vcardUnansweredTail:
    "Ignorer un élément qui dit de ne pas texter, c'est texter quelqu'un qui " +
    "vous a demandé d'arrêter.",
  vcardIgnoreOne: "Cet élément n'indique pas qui peut être texté",
  vcardImportCards: "Importer {count} fiches",
  vcardChooseFile: "Choisir un fichier .vcf",
  vcardImportingFile: "Importation de {file}…",
  vcardUpTo: "Jusqu'à {size}",
  vcardFileInput: "Fichier vCard",
  vcardTooBig:
    "Ce fichier dépasse {size}. Exportez un lot plus petit et réessayez.",

  // ── Importer un CSV ─────────────────────────────────────────────────────
  answerPhone: "Numéro de téléphone",
  answerName: "Nom complet",
  answerFirstName: "Prénom",
  answerLastName: "Nom de famille",
  answerAddress: "Adresse",
  answerNotes: "Notes",
  answerOptedOut: "Ne pas texter (désabonné)",
  answerIgnore: "Ignorer cette colonne",
  chooseWhatThisIs: "Choisissez ce que c'est",
  columnNoHeader: "Colonne {number} (sans en-tête)",
  columnQuoted: "« {header} »",
  columnAllBlank: "Toutes les lignes la laissent vide.",
  columnSays: "Contient",
  columnQuestion: "Qu'est-ce que {column} ?",
  csvTitle: "Importer des clients",
  csvBlurb:
    "Téléversez un CSV avec une ligne d'en-tête. Vous indiquerez ce qu'est " +
    "chaque colonne et verrez exactement ce qui se passera avant toute " +
    "importation.",
  csvChooseFile: "Choisir un fichier CSV",
  csvUpTo: "Jusqu'à {rows} lignes / {size}",
  csvFileInput: "Fichier CSV",
  csvTooBig: "Ce fichier dépasse {size}. Divisez-le et importez-le en parties.",
  csvNeedsHeader:
    "Ce fichier a besoin d'une ligne d'en-tête et d'au moins une ligne de client.",
  csvTooManyRows:
    "Cela dépasse {rows} lignes. Divisez le fichier et importez-le en parties.",
  csvUnreadable:
    "Impossible de lire ce fichier. Enregistrez-le en CSV et réessayez.",
  csvColumnsTitle: "Qu'y a-t-il dans vos colonnes ?",
  csvColumnsBlurb:
    "{file} · {rows} lignes · {answered} colonnes sur {columns} répondues. Rien " +
    "n'est ignoré sans que vous le disiez : une colonne « ne pas texter » que " +
    "nous écartons par erreur, c'est un texto à quelqu'un qui vous a demandé " +
    "d'arrêter.",
  unrecognisedOne: "Une colonne que nous ne reconnaissons pas",
  unrecognisedMany: "{count} colonnes que nous ne reconnaissons pas",
  unrecognisedBlurb:
    "Nous ne devinerons pas ce qu'elles signifient. Lisez ce que chacune " +
    "contient ci-dessous, puis dites-le-nous. Si l'une d'elles est une colonne " +
    "« ne pas texter » et que nous l'écartons, cette importation textera " +
    "quelqu'un qui vous a demandé d'arrêter.",
  ignoreAllOne: "Celle-ci n'indique pas qui peut être texté",
  ignoreAllMany: "Aucune de celles-ci n'indique qui peut être texté",
  answeredSome:
    "Répondues. Lisez ce qu'elles contiennent et corrigez ce qui cloche.",
  answeredAll:
    "Toutes les colonnes de votre fichier, et ce qu'elles contiennent. Lisez-les " +
    "avant de continuer et corrigez ce qui cloche.",
  conflictTitle: "Deux colonnes ne peuvent pas être la même chose",
  conflictSetTo: "{columns} sont toutes deux réglées sur",
  conflictOnePerContact:
    ". Un client n'en a qu'un. Choisissez une autre réponse pour l'une des deux.",
  joinAnd: " et ",
  splitNameNote:
    "Le prénom et le nom de famille sont enregistrés comme un seul nom. Quand " +
    "un fichier contient ces deux colonnes et une colonne « nom complet », le " +
    "prénom et le nom l'emportent : une colonne « nom complet » désigne " +
    "habituellement l'entreprise, pas la personne.",
  unreadableTitle: "Nous ne pouvons pas lire {column}",
  unreadableLead:
    "Vous l'avez réglée sur « ne pas texter », et elle contient des valeurs qui " +
    "ne sont ni oui ni non :",
  unreadableOverflow: ", et {count} de plus",
  unreadableTail:
    ". Les lire comme vides, c'est texter quelqu'un qui vous a demandé " +
    "d'arrêter. Inscrivez {trueValues} sur les lignes à bloquer et " +
    "{falseValues} ou rien sur les autres, ou réglez une autre colonne sur " +
    "« ne pas texter ».",
  doNotTextNote:
    "À propos de « ne pas texter » : les lignes marquées {trueValues} dans " +
    "cette colonne sont bloquées dès leur importation. Utilisez-la pour les " +
    "clients qui ont déjà demandé de ne plus être textés. {falseValues} ou une " +
    "cellule vide laisse les textos actifs, et toute autre valeur arrête " +
    "l'importation au lieu d'être devinée.",
  previewAction: "Aperçu de l'importation",
  gateAnswerEvery: "Répondez pour chaque colonne pour continuer.",
  gateConflict:
    "Deux colonnes sont réglées sur la même chose. Changez-en une pour continuer.",
  gateUnreadable: "Corrigez la colonne « ne pas texter » pour continuer.",
  gatePhone:
    "Réglez une colonne sur Numéro de téléphone pour continuer. C'est le seul " +
    "champ dont chaque client a besoin.",
  previewTitle: "Vérifiez avant d'importer",
  previewWillImport: "{count} seront importés",
  previewOptedOut: " ({count} marqués désabonnés)",
  previewSkipped: " · {count} seront ignorés",
  previewDedupeNote:
    ". Les clients existants ayant le même numéro sont mis à jour, pas dupliqués.",
  resultImportsOptedOut: "Importé, désabonné",
  resultImports: "Importé",
  resultSkipped: "Ignoré : {reason}",
  previewShowingFirst: "Affichage des {shown} premières lignes sur {total}.",
  importCount: "Importer {count} clients",
  importingNow:
    "Importation de vos clients. Cette fenêtre reste ouverte jusqu'à la fin " +
    "pour ne pas perdre le sommaire ni les lignes ignorées.",
  doneSummary: "{imported} nouveaux, {updated} mis à jour, {skipped} ignorés.",
  skippedRowsBlurb:
    "Les lignes ignorées ont conservé leurs raisons. Téléchargez-les, corrigez " +
    "les numéros, et réimportez seulement ce fichier.",
  downloadSkippedRows: "Télécharger les lignes ignorées",
};
