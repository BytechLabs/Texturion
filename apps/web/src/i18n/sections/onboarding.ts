/**
 * #228 — the words signup and onboarding says, in both languages.
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
 * ## What is deliberately NOT here
 *
 * - The carrier-registration DEFAULTS on the texting step are catalogue keys,
 *   but deliberately have the same English values in both locales. They are
 *   not chrome: they are the payload a US carrier reviews under TCR, they are
 *   pre-filled into editable fields, and SPEC §4.1 pins the wording verbatim.
 *   Translating what we submit to an American regulator would be a behaviour
 *   change wearing a copy change's clothes.
 * - Product names (Loonext, Stripe, Telnyx) and anything a machine matches on.
 */
import type { Translated } from "../translated";

export const onboardingEn = {
  /* #228 — how big the crew is. People rather than "seats" or "users":
     a plumber has a crew and a licence count is our word, not theirs. */
  crewSizeSolo: "Just me",
  crewSize2to3: "2 to 3 of us",
  crewSize4to10: "4 to 10",
  crewSize11Plus: "More than 10",
  /* #228 — the signup question. Web-only: there is no signup flow on
     either phone, so these six have no Kotlin or Swift twin. */
  signupSourceAnotherBusiness: "Another business told me",
  signupSourceSearch: "Google or another search",
  signupSourceSocial: "Social media",
  signupSourceOther: "Somewhere else",
  signupSourcePrompt: "How did you hear about us?",
  signupSourceHint: "Optional. It helps us know what is working.",
  // ── Shared across the wizard ──────────────────────────────────────────────
  continue: "Continue",
  saveAndContinue: "Save and continue",
  optional: "(optional)",
  edit: "Edit",
  change: "Change",
  checking: "Checking…",
  genericError: "Something went wrong on our end. Try again in a moment.",

  // ── The step frame (step-shell.tsx) ───────────────────────────────────────
  resuming: "Picking up where you left off…",
  loadProgressFailed:
    "We couldn't load your setup progress. Check your connection and try again.",

  // ── Step: company name ────────────────────────────────────────────────────
  nameTitle: "What's your company called?",
  nameSubtitle: "This is the name your customers see.",
  companyNameLabel: "Company name",
  companyNamePlaceholder: "Mike's Plumbing",
  companyNameHint:
    "It signs your first text to each customer. You can change it later in Settings.",
  crewSizeLabel: "How many of you are there?",

  // ── Step: the business number ─────────────────────────────────────────────
  numberTitle: "How do you want your business number?",
  numberSubtitlePort:
    "Bring the number your customers already know. It keeps working until the switch completes.",
  numberSubtitleNew:
    "Get a fresh local number, or bring the one that's on your trucks and your listing.",
  numberTypeLegend: "Number type",
  modeNewLabel: "Get a new number",
  modeNewHint: "We set up a fresh local number for your area.",
  modePortLabel: "Bring my existing number",
  modePortHint: "Transfer the number you already use. It's free.",
  landlineNote:
    "Have a landline you'd rather keep with its current carrier? After signup " +
    "you can add texting to it from Settings → Numbers. Calls don't change, " +
    "and the carrier review takes a few business days.",
  countryLegend: "Country",
  countryUs: "United States",
  countryCa: "Canada",
  pickNumberLabel: "Pick your number",
  pickNumberError: "Pick a number to continue.",
  usTextingLegend: "Do you also text customers with US numbers?",
  usTextingYes: "Yes, some of our customers are in the US",
  usTextingNo: "No, Canadian customers only",
  usTextingFeeNote:
    "US texting needs a one-time {fee} carrier registration. You can turn it " +
    "on later in Settings.",
  settingUpWorkspace: "Setting up your workspace…",

  // ── Step: business identity (10DLC brand) ─────────────────────────────────
  businessTitle: "Tell us about your business",
  businessSubtitle:
    "Carriers require this before a business can text customers. We file " +
    "everything for you. It takes about 2 minutes.",
  businessLocked:
    "Your business details were already submitted to carriers. Nothing more to do on this step.",
  hasEinLabel: "Do you have an {idName}?",
  einNameUs: "EIN",
  einNameCa: "Business Number",
  einQuestionCa: "EIN / Business Number",
  /*
   * The government programme, by the name the reader's government uses for it.
   * "SSN" stays "SSN" in French because it is a US programme; Canada's SIN is
   * "NAS" in French and calling it "SIN" to a Quebec reader would send them
   * looking for a card they do not have.
   */
  sinNameUs: "SSN",
  sinNameCa: "SIN",
  yes: "Yes",
  no: "No",
  einHintUs: "An EIN is the 9-digit tax ID the IRS gave your business.",
  einHintCa: "The 9-digit number the CRA gave your business.",
  solePropLead: "No problem. We'll register you as a sole proprietor.",
  solePropDetail:
    "Same texting features. Carriers verify you with the last 4 digits of " +
    "your {idName} and a code texted to your phone. One thing to know: sole " +
    "proprietor registrations are limited to one phone number.",
  legalFirstName: "Legal first name",
  legalLastName: "Legal last name",
  last4Label: "Last 4 digits of your {idName}",
  last4Hint:
    "Carriers use it to confirm you're you. We only ever ask for, and store, the last 4.",
  mobileLabel: "Your mobile number",
  mobileHint:
    "We'll text a 6-digit verification code to this number after payment.",
  legalBusinessName: "Legal business name",
  legalBusinessNameHint:
    "Carriers check this against government business records.",
  legalBusinessPlaceholderUs: "Mike's Plumbing LLC",
  legalBusinessPlaceholderCa: "Mike's Plumbing Inc.",
  einHint: "Proves your business to carriers. It's never shown to customers.",
  streetLabel: "Street address",
  streetHint:
    "Carriers require a physical address on file. It's never shown to customers.",
  cityLabel: "City",
  stateLabel: "State",
  provinceLabel: "Province",
  zipLabel: "ZIP code",
  postalLabel: "Postal code",
  websiteLabel: "Website (optional)",
  websiteHint:
    "Carriers look for a real web presence. A Facebook or Google Business page counts.",
  contactEmailLabel: "Contact email",
  contactEmailHint: "Where registration updates land.",
  contactPhoneLabel: "Contact phone",
  contactPhoneHint: "A number carriers can reach you at. Your cell is fine.",
  verticalLabel: "What kind of work do you do?",
  verticalHint: "Tells carriers the kind of texts you'll send.",

  // ── Step: how customers hear from you (campaign) ──────────────────────────
  textingTitle: "How customers hear from you",
  textingSubtitle:
    "Carriers review these before approving business texting. We've written " +
    "honest defaults. Edit them if they don't fit.",
  textingLocked:
    "These details were already submitted to carriers. Nothing more to do on this step.",
  messageFlowLabel: "How do customers say yes to texts?",
  messageFlowHint:
    "Plain truth works best. Carriers reject marketing-blast language.",
  sample1Label: "A text you'd actually send",
  sample2Label: "One more example",
  sample2Hint: "Carriers just want to see everyday customer conversations.",
  textingDefaultMessageFlow:
    "Customers text our business number first, or ask us in person / by phone to text them. We never send marketing blasts.",
  textingDefaultSample1:
    "Hi, it's {name}. We can fit you in tomorrow between 9 and 11am. Does that still work for you?",
  textingDefaultSample2:
    "{name} here. Your quote is ready: $180 for the full job. Reply YES to book it, or text us any questions.",

  // ── Step: plan + checkout ─────────────────────────────────────────────────
  planTitle: "Pick your plan",
  planSubtitle:
    "One flat price for your whole crew. No contracts. Cancel any time.",
  planGroupAria: "Plan",
  perMonth: "/month",
  checkoutCanceled:
    "Checkout was canceled. You haven't been charged. Pick a plan whenever you're ready.",
  soleProp1Number:
    "Sole proprietor registrations are limited to 1 number by carriers. Pro " +
    "still adds teammates and texts.",
  addOnsTitle: "Add-ons",
  addOnsHint:
    "Optional. Turn on only what you need. Add or remove them any time.",
  registrationFeeLine: "+ {fee} one-time carrier registration (US texting)",
  registrationFeeAria: "Why the registration fee?",
  registrationFeeTooltip:
    "US carriers require every business to register before texting customers. " +
    "This covers their registration and vetting fees, charged once, ever. We " +
    "file the paperwork for you.",
  portingTimelineTitle: "Bringing your number over",
  afterYouPayTitle: "What happens after you pay",
  sendingToCheckout: "Sending you to checkout…",
  continueToCheckout: "Continue to checkout",
  textDefinition:
    "A “text” is one 160-character message segment. Long texts and " +
    "emoji use more than one. Incoming texts never count.",
  checkoutOpenFailed:
    "We couldn't open checkout. This is usually a brief connection hiccup. " +
    "Check your connection and try again.",

  // ── The editable pre-checkout summary ─────────────────────────────────────
  workspaceTitle: "Your workspace",
  workspaceHint:
    "You can still change these before you pay. They lock once your number is set up.",
  workspaceNameLabel: "Workspace name",
  workspaceNameRequired: "Your workspace needs a name.",
  businessNumberLabel: "Your business number",
  alsoTextsUs: "· also texts US",
  alsoTextUsLabel: "Also text customers with US numbers",
  usTextingFeeShort:
    "US texting needs a one-time {fee} carrier registration.",
  saveNumber: "Save number",
  saveChangeFailed: "Couldn't save that change. Try again in a moment.",

  // ── Port sub-wizard: the number ───────────────────────────────────────────
  portNumberTitle: "Which number do you want to bring?",
  portNumberSubtitle:
    "Enter the number your customers already text. We'll check it can move to " +
    "Loonext. No commitment yet.",
  portCurrentNumberLabel: "Your current business number",
  portTollFreeNote:
    "US or Canadian local numbers only. Toll-free numbers can't be transferred here.",
  portGetNewInstead: "Get a new number instead",
  portChecking: "Checking your number…",
  portCheckAction: "Check this number",
  portEnterNumberError: "Enter your 10-digit US or Canadian number.",
  portCheckFailed:
    "We couldn't check this number just now. Try again in a moment.",

  // ── Port sub-wizard: the losing carrier's account ─────────────────────────
  portCarrierTitle: "Your current carrier account",
  portCarrierSubtitle:
    "These come from your current provider. Matching them to your latest bill " +
    "is the surest way to a smooth transfer.",
  portEntityNameLabel: "Account holder name",
  portEntityNamePlaceholder: "The business or person on the bill",
  portEntityNameHint: "Exactly as it appears on your current carrier bill.",
  portAuthPersonLabel: "Authorized person",
  portAuthPersonPlaceholder: "Who's allowed to make account changes",
  portAccountNumberLabel: "Account number",
  portAccountNumberPlaceholder: "Your current carrier account number",
  portBillingPhoneLabel: "Billing phone number",
  ifDifferent: "(if different)",
  portBillingPhoneHint:
    "The main number on the account, if it isn't the one you're transferring.",
  portWirelessNote:
    "This is a mobile number, so your carrier needs two extra details to " +
    "release it. We only ever store the last 4 digits of the {idName}, never " +
    "the full number.",
  portPinLabel: "Transfer PIN / passcode",
  portPinPlaceholder: "Your carrier can give you this",
  portLast4Label: "Last 4 of the account holder's {idName}",
  portLast4Aria: "Why we ask for the {idName} last 4",
  portLast4Tooltip:
    "Mobile carriers verify the account holder's identity before releasing a " +
    "number. We pass only the last 4 digits to the carrier and store only " +
    "those 4, never the full {idName}.",
  portCarrierMissing:
    "Fill in the account holder, authorized person, and account number.",
  portLast4Error: "Enter the last 4 digits of the account holder's {idName}.",
  portPinError: "Enter the transfer PIN from your current carrier.",

  // ── Port sub-wizard: the service address ──────────────────────────────────
  portAddressTitle: "Service address on file",
  portAddressSubtitle:
    "The address your current carrier has for this number. A mismatch here is " +
    "the most common reason a transfer gets held up. Copy it from your latest bill.",
  streetPlaceholder: "1 Main St",
  suiteLabel: "Suite / unit",
  suitePlaceholder: "Unit 4",
  portAddressMissing: "Fill in the street, city, {region}, and {postal}.",

  // ── Port sub-wizard: timing ───────────────────────────────────────────────
  portTimingTitle: "When should the switch happen?",
  portTimingSubtitle:
    "Pick a target date if you have one, or leave it to us to move it as soon " +
    "as your carrier confirms.",
  portFocDateLabel: "Preferred switch-over date",
  portHowItWorks: "How the transfer works",
  portDocumentsNote:
    "After you pay, you'll upload a signed authorization and a recent bill. " +
    "Then we send the transfer to your carrier. We'll walk you through it.",
  portBridgeAria: "Give me a temporary number while my number transfers",
  portBridgeLabel: "Give me a temporary number to text from now",
  portBridgeHint:
    "Text customers today while {number} transfers. You can release it once " +
    "your number arrives.",
  portSavingTransfer: "Saving your transfer…",
  portWorkspaceError:
    "Something went wrong setting up your workspace. Go back a step and try again.",
  portDetailsMissing:
    "Some transfer details are missing. Go back and complete them.",
  portSaveFailed:
    "We couldn't save your transfer just now. Try again in a moment.",
  yourNumberFallback: "your number",

  // ── The setting-up checklist ──────────────────────────────────────────────
  settingUpTitle: "Setting up your number",
  numberReadyTitle: "Your number is ready!",
  rowDone: ", done",
  rowNeedsAttention: ", needs your attention",
  rowInProgress: ", in progress",
  rowCreatingNumber: "Creating your number",
  rowRegistering: "Registering your business with carriers",
  rowInboxReady: "Inbox ready",
  confirmingPayment: "Confirming your payment. A few seconds.",
  chooseYourNumber: "Choose your number",
  registrationNotNeeded: "Not needed. Canadian texting works right away.",
  fixAndResubmit: "Fix and resubmit",
  fixMemberNote:
    "Ask an owner or admin to fix the flagged details and resubmit.",
  inboxReadyHint: "Text your new number from your phone and watch it land.",
  inboxWaitingHint:
    "You can start using Loonext now. Your inbox fills in the moment your " +
    "number is ready, and we'll keep you posted at the top of every screen.",
  openInbox: "Open your inbox",
  rejectionFallback: "the carrier flagged a detail",
  yourMobileFallback: "your mobile",
  switchDateFallback: "your switch-over date",
  otpCodeError: "Enter the 6-digit code from the text.",
  otpResent: "We sent a new code. It's good for 24 hours.",
  otpAria: "Verification code",
  otpVerify: "Verify",
  otpResend: "Resend code",
  otpResendIn: "Resend code ({seconds}s)",
  otpOwnerOnly: "Your account owner or an admin enters the code here.",

  // ── Sign in ───────────────────────────────────────────────────────────────
  logIn: "Log in",
  loggingIn: "Logging in…",
  loginSubtitle: "Your team's texts are waiting.",
  emailLabel: "Email",
  passwordLabel: "Password",
  forgotPassword: "Forgot your password?",
  newToLoonext: "New to Loonext?",
  createAccount: "Create an account",
  useDifferentAccount: "Use a different account",
  oauthFailed:
    "We couldn't finish signing you in with that provider. Try again, or use " +
    "your email and password below.",
  continueWithGoogle: "Continue with Google",
  openingGoogle: "Opening Google…",
  or: "or",
  lastUsed: "Last used",

  // The two fields the front door refuses to submit without. Read under the
  // field by the person filling it in, so they are copy like any other.
  emailRequired: "Enter your email address.",
  passwordRequired: "Enter your password.",
  nameRequired: "Enter your name.",
  passwordTooShort: "Use at least 8 characters.",
  passwordMismatch: "The passwords don't match.",

  /*
   * TAB TITLES for the gate and the onboarding wizard.
   *
   * Read off `EN` in a server `metadata` export rather than through
   * `makeTranslate` — see the header of `app/not-found.tsx`. `i18n/provider.tsx`
   * is `"use client"`, so calling any export of it while Next collects a route's
   * metadata is a BUILD failure, not a fallback. The keys still belong here: a
   * translator can see them, and the day a locale can be resolved on the server
   * this becomes a change of argument rather than a re-extraction.
   */
  tabSignUp: "Create your account",
  tabResetPassword: "Reset your password",
  tabSetNewPassword: "Set a new password",
  tabAcceptInvitation: "Accept your invitation",
  tabGetStarted: "Get started · Loonext",
  tabBusinessName: "Your business name",
  tabBusinessDetails: "About your business",
  tabHowYoullText: "How you'll text",
  tabChoosePlan: "Choose your plan",
  tabYourNumber: "Your business number",
  tabPortYourNumber: "Port your number",

  /*
   * The TCR business verticals, as the wizard asks for them (verticals.ts).
   *
   * ANOTHER COPY OF THIS ENUM'S LABELS LIVES AT `settingsMore.vertical*`, read
   * by `components/settings/registration-fix-form.tsx`. That one is a
   * title-cased token per value ("Real estate", "Ngo"); these are the wizard's
   * richer copy, and they are the ones somebody picks their own trade out of.
   * Two vocabularies for one enum is drift waiting to happen and the two should
   * be merged onto these — recorded here rather than done in passing, because
   * the other set is read by a screen this change does not own.
   */
  verticalProfessional: "Professional & home services",
  verticalConstruction: "Construction & trades",
  verticalAgriculture: "Agriculture & landscaping",
  verticalRetail: "Retail",
  verticalHospitality: "Hospitality, food & travel",
  verticalRealEstate: "Real estate & property",
  verticalHealthcare: "Healthcare & wellness",
  verticalTransportation: "Transportation & moving",
  verticalEducation: "Education",
  verticalFinancial: "Financial services",
  verticalInsurance: "Insurance",
  verticalLegal: "Legal",
  verticalTechnology: "Technology",
  verticalManufacturing: "Manufacturing",
  verticalEnergy: "Energy & utilities",
  verticalCommunication: "Communications & media",
  verticalEntertainment: "Entertainment & events",
  verticalHumanResources: "Staffing & HR",
  verticalPostal: "Postal & delivery",
  verticalNgo: "Nonprofit",
  verticalGovernment: "Government",
  verticalPolitical: "Political",
  verticalGambling: "Gambling",

  /*
   * What the business-identity form refuses to submit without (§4.4).
   *
   * `bizStateRequired` / `bizPostalRequired` come in a US and a Canadian
   * wording because the two countries call the field different things, and a
   * form that asks a Quebecker for a ZIP code has already told them it was not
   * built for them.
   */
  bizStreetRequired: "Enter your street address.",
  bizCityRequired: "Enter your city.",
  bizStateRequiredUs: "Pick your state.",
  bizStateRequiredCa: "Pick your province.",
  bizPostalRequiredUs: "Enter your ZIP code.",
  bizPostalRequiredCa: "Enter your postal code.",
  bizPostalTooLong: "Keep it under 10 characters.",
  bizWebsiteTooLong: "Keep it under 255 characters.",
  bizEmailInvalid: "Enter a real email address.",
  bizPhoneInvalid: "Enter a phone number carriers can reach you at.",
  bizLegalNameRequired: "Enter your legal business name.",
  /** `id` is EIN or Business Number — a registry's name, never translated. */
  bizTaxIdRequired: "Enter your {id} (numbers and dashes are fine).",
  bizFirstNameRequired: "Enter your legal first name.",
  bizLastNameRequired: "Enter your legal last name.",
  /** `id` is SSN or SIN, for the same reason. */
  bizLast4Required: "Enter the last 4 digits of your {id}.",
  bizMobileInvalid: "Enter a US or Canadian mobile number.",
  bizWebsiteInvalid: "That doesn't look like a web address.",

  // The company-name step (§4.1).
  companyNameRequired: "Enter your company name.",
  companyNameTooLong: "Keep it under 200 characters.",

  /*
   * The texting-details step's floors (§4.4), mirrored from the API's
   * campaignDraftSchema. The FIELD VALUES live beside the step's visible copy
   * above, with the same English carrier-review payload in both locales.
   */
  textingFlowTooShort:
    "Give carriers at least a sentence or two (40+ characters).",
  textingFlowTooLong: "Keep it under 2,048 characters.",
  textingSampleTooShort: "Make it a realistic text, at least 20 characters.",
  textingSampleTooLong: "Keep it under 1,024 characters.",

  /*
   * #370 — what picking a crew size says back (crew-copy.ts).
   *
   * `seats` and `amount` are DERIVED from PLAN_PRICING by the caller and
   * interpolated; a hand-written figure on a paying-customer surface is a claim
   * that silently stops being true the day pricing moves. No en or em dashes on
   * this surface (Law 6), in either language — `crew-copy.test.ts` checks.
   */
  crewFitPrompt:
    "Everyone answers on the same number, so this only decides which plan " +
    "fits. Skip it if you'd rather.",
  crewFitBeyond:
    "Our biggest plan covers {seats} people. Past that, tell us how your crew " +
    "works and we'll be straight with you about the fit.",
  crewFitPlan:
    "{plan} covers up to {seats} people at {amount} a month, however many " +
    "customers you text.",

  /*
   * The plan cards on the wizard's plan step (plan/plans.ts).
   *
   * Every figure is DERIVED from PLAN_PRICING and interpolated; only the words
   * are here. `planLineNumbersOne` / `-Many` are two keys because the catalogue
   * has no plural rules on purpose (catalog.ts), and no en or em dashes on this
   * surface in either language (Law 6) — `plan/plan.test.tsx` checks.
   */
  planCardTextingIncluded: "Texting included, bound by fair use",
  planCardIncomingFree: "Incoming texts & photos free, always",
  planCardOverage: "Busy month? Extra texts bill under fair use, capped by you",
  planCardNumbersOne: "{count} business number",
  planCardNumbersMany: "{count} business numbers",
  planCardCrewStarter: "Your whole crew, {seats} teammates",
  planCardCrewPro: "{seats} teammates",
  /** #381: the monthly figure said again in a unit people spend in. */
  planCardDaily: "about {amount} a day",

  // The status line under the setting-up heading (setting-up/headline.ts).
  setupNeedsYou: "One step below needs you. The rest updates itself.",
  setupAllLive: "Everything below is live. Text your new number to see it land.",
  setupNumberReady:
    "Text your new number to see it land. One step below is still finishing.",
  setupUpdatesItself: "This screen updates itself. No refreshing needed.",

  /*
   * The port branch of the same checklist (setting-up/port-item.ts).
   *
   * Tone per PORTING.md §9: plain, honest, never "instant". The in-flight
   * states reuse `PORT_STATE_COPY` from components/porting/copy.ts; only the
   * strings unique to this checklist are here.
   */
  portChecklistTitle: "Transferring your number to Loonext",
  portChecklistNeedsDocuments:
    "Upload your signed authorization (LOA) and a recent phone bill to start " +
    "the transfer. Your number can't move until we have both.",
  portChecklistNeedsDocumentsCta: "Upload your documents",
  portChecklistNeedsSubmit:
    "Your documents are in. Send the transfer to your carrier when you're " +
    "ready.",
  portChecklistNeedsSubmitCta: "Review and submit the transfer",
  /** Shown to members, who can't upload — mirrors the OTP row's member line. */
  portChecklistMemberDocuments:
    "Your account owner or an admin uploads the signed authorization (LOA) " +
    "and a recent phone bill to start the transfer.",
  portChecklistInReviewWindow:
    "The whole transfer usually takes a few business days to about two weeks " +
    "(US), often faster in Canada.",
  portChecklistTrackLink: "Track it in Settings → Numbers",

  // ── Sign up ───────────────────────────────────────────────────────────────
  createYourAccount: "Create your account",
  signupSubtitle: "A business number for your whole crew. Set up in minutes.",
  yourNameLabel: "Your name",
  yourNamePlaceholder: "Sam Rivera",
  creatingAccount: "Creating your account…",
  createAccountAction: "Create account",
  alreadyHaveAccount: "Already have an account?",
  checkYourEmail: "Check your email",
  confirmationSentPrefix: "We sent a confirmation link to",
  confirmationSentSuffix: ". Open it to finish creating your account.",
  wrongAddress: "Wrong address?",
  startOver: "Start over",

  // ── Password reset ────────────────────────────────────────────────────────
  resetTitle: "Reset your password",
  resetSubtitle:
    "Enter your email and we'll send you a link to set a new one.",
  resetSentPrefix: "If an account exists for",
  resetSentSuffix: ", we sent it a link to set a new password.",
  sending: "Sending…",
  sendResetLink: "Send reset link",
  rememberedIt: "Remembered it?",
  backToLogin: "Back to log in",
  checkingLink: "Checking your link…",
  linkExpiredTitle: "This link has expired",
  linkExpiredBody:
    "Password links only work once and expire after a while. Request a new " +
    "one and try again.",
  requestNewLink: "Request a new link",
  setNewPasswordTitle: "Set a new password",
  setNewPasswordSubtitle: "You'll stay logged in on this device.",
  newPasswordLabel: "New password",
  confirmPasswordLabel: "Confirm password",
  savePassword: "Save password",
  passwordUpdated: "Password updated.",

  // ── Two-factor at the door ────────────────────────────────────────────────
  mfaCodeTitle: "Enter your code",
  mfaRecoveryTitle: "Use a recovery code",
  mfaCodeBody: "Open your authenticator app and type the six digits it shows.",
  mfaRecoveryBody:
    "One of the ten codes you saved when you set two-factor up. Using one " +
    "turns two-factor OFF so you can get in and set it up again.",
  mfaCodeAria: "Six-digit code",
  mfaRecoveryAria: "Recovery code",
  mfaUseThisCode: "Use this code",
  mfaNoAuthenticator: "I don't have my authenticator",
  mfaHaveAuthenticator: "I have my authenticator after all",
  mfaNoFactor:
    "We couldn't find an authenticator on this account. Sign out and back in.",
  mfaCodeMismatch: "That code didn't match. Check your app and try the next one.",
  mfaRateLimited: "Too many wrong codes. Try again in an hour.",
  mfaCodeInvalid: "That code is not valid.",
  mfaNetwork: "We couldn't reach the server. Check your connection.",

  // ── The front door's captcha ──────────────────────────────────────────────
  securityCheckAria: "Security check",
  securityCheckFailed:
    "We couldn't load the security check. Refresh the page and try again.",
  captchaNotConfigured: "Captcha isn't configured in this environment.",

  // ── Invites ───────────────────────────────────────────────────────────────
  aLoonextWorkspace: "a Loonext workspace",
  inviteBannerText: "You've been invited to join",
  inviteBannerAria: "You've been invited to join {company}",
  join: "Join",
  dismissInvite: "Dismiss invite",
  openingInvite: "Opening your invite…",
  invitedTitle: "You're invited",
  invitedBody:
    "Log in to join your team's shared inbox. Use the email address this " +
    "invite was sent to.",
  loginToAccept: "Log in to accept",
  noPasswordYet: "No password yet?",
  setOneHere: "Set one here",
  whatsYourName: "What's your name?",
  nameForTeammates: "Your teammates will see this on messages, notes, and tasks.",
  inviteNamePlaceholder: "Alex Rivera",
  joining: "Joining…",
  joiningTeam: "Joining your team…",
  saveNameFailed: "Couldn't save your name. Try again.",
  loginDifferentEmail: "Log in with a different email",
  inviteWrongEmailTitle: "This invite belongs to another email",
  inviteWrongEmailBody:
    "Log in with the email address the invite was sent to, then open the link again.",
  inviteConflictTitle: "This invite can't be used",
  inviteNotFoundTitle: "This invite link doesn't work",
  inviteNotFoundBody:
    "It may have been revoked. Ask your team to send a new one.",
  inviteErrorTitle: "Something went wrong",
  inviteErrorBody:
    "We couldn't accept the invite. Check your connection and try again.",

  /*
   * ── The joining member's orientation ──────────────────────────────────────
   *
   * These four screens are ALSO hand-ported to Android and iOS, and
   * `packages/shared/src/member-orientation-copy.test.ts` reads all three
   * sources so the ports cannot drift. That guard now reads this file for the
   * web's half — the words moved here, so the guard followed them.
   */
  orientationInboxTitle: "One inbox, the whole crew",
  orientationInboxBody:
    "Every text your customers send lands here, and everyone on the crew can " +
    "see it. Nothing sits unanswered in one person's phone.",
  orientationNumberTitle: "You answer as the business",
  orientationNumberBody:
    "Your replies go out from the workspace's number, so customers never get " +
    "your personal one. If a number isn't shared with you, Settings tells you " +
    "which and why.",
  orientationNotesTitle: "Notes stay inside",
  orientationNotesBody:
    "Switch the composer to Note and only the crew sees it — the customer " +
    "never does. Mention a teammate in one and it lands on their For you.",
  orientationNotificationsTitle: "You choose when we buzz you",
  orientationNotificationsBody:
    "You're joining a workspace that already has traffic. Turn on " +
    "notifications for the work meant for you, and change them any time in Settings.",
  saysAttribution: "{name} says",
  theySaid: "They said",
  stepXofY: "Step {current} of {total}",
  skip: "Skip",
  next: "Next",
  notNow: "Not now",
  turnOnNotifications: "Turn on notifications",
  turningOn: "Turning on…",
  startWorking: "Start working",

  /* ── Supabase Auth failures, in words (lib/auth/messages.ts) ──────────────
     Read on every screen that signs somebody in or changes their credentials:
     login, signup, reset, update-password, the OAuth buttons and the two
     Settings cards. One sentence each — what happened, then what to do — and
     never the provider's own code.

     What is NOT here: the fallback for a code this list does not name. That
     sentence is Supabase's own `error.message`, and it is shown rather than
     replaced, because a wrong guess about an unknown failure is worse than an
     English one. */
  authInvalidCredentials: "That email or password isn't right. Try again.",
  authEmailNotConfirmed:
    "Confirm your email first. We sent you a link when you signed up.",
  authEmailExists: "You already have an account with this email. Log in instead.",
  authWeakPassword:
    "That password is too easy to guess. Use at least 8 characters.",
  authSamePassword: "That's already your password. Pick a new one.",
  authLinkExpired: "That link has expired. Request a new one.",
  authTooManyAttempts: "Too many attempts. Wait a minute and try again.",
  authUserNotFound: "We couldn't find an account with that email.",
  authSessionEnded: "Your session ended. Log in again.",
  authCaptchaFailed:
    "We couldn't confirm you're human. Refresh the page and try again.",
  authFailed: "Something went wrong. Try again in a moment.",
} as const;

/**
 * Quebec French. Vouvoiement throughout, accents spelled normally (the GSM-7
 * restriction in `packages/shared/src/locale.ts` governs SMS bodies, and
 * nothing on a web page is billed by the segment).
 *
 * Vocabulary held steady across this whole surface: **opérateur** for a
 * telecom carrier, **texto** for a text message, **espace de travail** for the
 * workspace, **forfait** for a plan, **paramètres** for settings.
 */
export const onboardingFr: Translated<typeof onboardingEn> = {
  crewSizeSolo: "Juste moi",
  crewSize2to3: "2 ou 3 personnes",
  crewSize4to10: "4 à 10",
  crewSize11Plus: "Plus de 10",
  signupSourceAnotherBusiness: "Une autre entreprise m'en a parlé",
  signupSourceSearch: "Google ou un autre moteur de recherche",
  signupSourceSocial: "Les réseaux sociaux",
  signupSourceOther: "Ailleurs",
  signupSourcePrompt: "Comment avez-vous entendu parler de nous ?",
  signupSourceHint: "Facultatif. Cela nous aide à savoir ce qui fonctionne.",
  // ── Shared across the wizard ──────────────────────────────────────────────
  continue: "Continuer",
  saveAndContinue: "Enregistrer et continuer",
  optional: "(facultatif)",
  edit: "Modifier",
  change: "Changer",
  checking: "Vérification…",
  genericError:
    "Une erreur s'est produite de notre côté. Réessayez dans un moment.",

  // ── The step frame ────────────────────────────────────────────────────────
  resuming: "Reprise là où vous en étiez…",
  loadProgressFailed:
    "Impossible de charger votre progression. Vérifiez votre connexion et réessayez.",

  // ── Step: company name ────────────────────────────────────────────────────
  nameTitle: "Quel est le nom de votre entreprise ?",
  nameSubtitle: "C'est le nom que vos clients voient.",
  companyNameLabel: "Nom de l'entreprise",
  companyNamePlaceholder: "Plomberie Mike",
  companyNameHint:
    "Il signe votre premier texto à chaque client. Vous pourrez le changer plus tard dans les paramètres.",
  crewSizeLabel: "Combien êtes-vous dans l'équipe ?",

  // ── Step: the business number ─────────────────────────────────────────────
  numberTitle: "Comment voulez-vous obtenir votre numéro d'affaires ?",
  numberSubtitlePort:
    "Gardez le numéro que vos clients connaissent déjà. Il continue de fonctionner jusqu'à la fin du transfert.",
  numberSubtitleNew:
    "Obtenez un nouveau numéro local, ou gardez celui qui est sur vos camions et dans votre fiche.",
  numberTypeLegend: "Type de numéro",
  modeNewLabel: "Obtenir un nouveau numéro",
  modeNewHint: "Nous créons un nouveau numéro local pour votre région.",
  modePortLabel: "Transférer mon numéro actuel",
  modePortHint: "Transférez le numéro que vous utilisez déjà. C'est gratuit.",
  landlineNote:
    "Vous avez une ligne fixe que vous préférez garder chez votre opérateur " +
    "actuel ? Après l'inscription, vous pourrez y ajouter les textos depuis " +
    "Paramètres → Numéros. Les appels ne changent pas, et l'examen par " +
    "l'opérateur prend quelques jours ouvrables.",
  countryLegend: "Pays",
  countryUs: "États-Unis",
  countryCa: "Canada",
  pickNumberLabel: "Choisissez votre numéro",
  pickNumberError: "Choisissez un numéro pour continuer.",
  usTextingLegend:
    "Textez-vous aussi des clients avec des numéros américains ?",
  usTextingYes: "Oui, certains de nos clients sont aux États-Unis",
  usTextingNo: "Non, seulement des clients canadiens",
  usTextingFeeNote:
    "Les textos vers les États-Unis exigent une inscription unique de {fee} " +
    "auprès des opérateurs. Vous pourrez l'activer plus tard dans les paramètres.",
  settingUpWorkspace: "Création de votre espace de travail…",

  // ── Step: business identity ───────────────────────────────────────────────
  businessTitle: "Parlez-nous de votre entreprise",
  businessSubtitle:
    "Les opérateurs l'exigent avant qu'une entreprise puisse texter des " +
    "clients. Nous remplissons tout pour vous. Ça prend environ 2 minutes.",
  businessLocked:
    "Les renseignements sur votre entreprise ont déjà été transmis aux opérateurs. Rien de plus à faire à cette étape.",
  hasEinLabel: "Avez-vous un {idName} ?",
  einNameUs: "EIN",
  einNameCa: "numéro d'entreprise",
  einQuestionCa: "EIN / numéro d'entreprise",
  sinNameUs: "SSN",
  sinNameCa: "NAS",
  yes: "Oui",
  no: "Non",
  einHintUs:
    "L'EIN est le numéro fiscal à 9 chiffres que l'IRS a donné à votre entreprise.",
  einHintCa: "Le numéro à 9 chiffres que l'ARC a donné à votre entreprise.",
  solePropLead:
    "Aucun problème. Nous vous inscrirons comme travailleur autonome.",
  solePropDetail:
    "Les mêmes fonctions de texto. Les opérateurs vous vérifient avec les 4 " +
    "derniers chiffres de votre {idName} et un code envoyé par texto à votre " +
    "téléphone. Une chose à savoir : les inscriptions de travailleurs " +
    "autonomes sont limitées à un seul numéro de téléphone.",
  legalFirstName: "Prénom légal",
  legalLastName: "Nom légal",
  last4Label: "4 derniers chiffres de votre {idName}",
  last4Hint:
    "Les opérateurs s'en servent pour confirmer votre identité. Nous ne demandons et ne conservons que les 4 derniers.",
  mobileLabel: "Votre numéro de cellulaire",
  mobileHint:
    "Nous texterons un code de vérification à 6 chiffres à ce numéro après le paiement.",
  legalBusinessName: "Nom légal de l'entreprise",
  legalBusinessNameHint:
    "Les opérateurs le comparent aux registres gouvernementaux des entreprises.",
  legalBusinessPlaceholderUs: "Plomberie Mike LLC",
  legalBusinessPlaceholderCa: "Plomberie Mike inc.",
  einHint:
    "Prouve l'existence de votre entreprise aux opérateurs. Ce n'est jamais montré aux clients.",
  streetLabel: "Adresse municipale",
  streetHint:
    "Les opérateurs exigent une adresse physique au dossier. Elle n'est jamais montrée aux clients.",
  cityLabel: "Ville",
  stateLabel: "État",
  provinceLabel: "Province",
  zipLabel: "Code ZIP",
  postalLabel: "Code postal",
  websiteLabel: "Site Web (facultatif)",
  websiteHint:
    "Les opérateurs cherchent une véritable présence en ligne. Une page Facebook ou Google Business compte.",
  contactEmailLabel: "Courriel de contact",
  contactEmailHint: "Où arrivent les nouvelles de l'inscription.",
  contactPhoneLabel: "Téléphone de contact",
  contactPhoneHint:
    "Un numéro où les opérateurs peuvent vous joindre. Votre cellulaire fait l'affaire.",
  verticalLabel: "Quel genre de travail faites-vous ?",
  verticalHint: "Indique aux opérateurs le genre de textos que vous enverrez.",

  // ── Step: how customers hear from you ─────────────────────────────────────
  textingTitle: "Comment vos clients reçoivent de vos nouvelles",
  textingSubtitle:
    "Les opérateurs examinent ces renseignements avant d'autoriser les textos " +
    "d'affaires. Nous avons rédigé des réponses honnêtes par défaut. " +
    "Modifiez-les si elles ne vous conviennent pas.",
  textingLocked:
    "Ces renseignements ont déjà été transmis aux opérateurs. Rien de plus à faire à cette étape.",
  messageFlowLabel: "Comment vos clients acceptent-ils de recevoir des textos ?",
  messageFlowHint:
    "La vérité toute simple fonctionne le mieux. Les opérateurs refusent le langage de publipostage.",
  sample1Label: "Un texto que vous enverriez vraiment",
  sample2Label: "Un autre exemple",
  sample2Hint:
    "Les opérateurs veulent simplement voir des conversations courantes avec des clients.",
  // Submitted verbatim to the US carrier registry; see the catalogue header.
  textingDefaultMessageFlow:
    "Customers text our business number first, or ask us in person / by phone to text them. We never send marketing blasts.",
  textingDefaultSample1:
    "Hi, it's {name}. We can fit you in tomorrow between 9 and 11am. Does that still work for you?",
  textingDefaultSample2:
    "{name} here. Your quote is ready: $180 for the full job. Reply YES to book it, or text us any questions.",

  // ── Step: plan + checkout ─────────────────────────────────────────────────
  planTitle: "Choisissez votre forfait",
  planSubtitle:
    "Un prix fixe pour toute votre équipe. Sans contrat. Annulez quand vous voulez.",
  planGroupAria: "Forfait",
  perMonth: "/mois",
  checkoutCanceled:
    "Le paiement a été annulé. Rien ne vous a été facturé. Choisissez un forfait quand vous serez prêt.",
  soleProp1Number:
    "Les opérateurs limitent les inscriptions de travailleurs autonomes à 1 " +
    "numéro. Pro ajoute quand même des coéquipiers et des textos.",
  addOnsTitle: "Modules complémentaires",
  addOnsHint:
    "Facultatif. Activez seulement ce dont vous avez besoin. Ajoutez-les ou retirez-les quand vous voulez.",
  registrationFeeLine:
    "+ {fee} d'inscription unique auprès des opérateurs (textos vers les États-Unis)",
  registrationFeeAria: "Pourquoi ces frais d'inscription ?",
  registrationFeeTooltip:
    "Les opérateurs américains exigent que chaque entreprise s'inscrive avant " +
    "de texter des clients. Ces frais couvrent leur inscription et leur " +
    "vérification, facturés une seule fois, à vie. Nous remplissons les " +
    "formulaires pour vous.",
  portingTimelineTitle: "Transfert de votre numéro",
  afterYouPayTitle: "Ce qui se passe après le paiement",
  sendingToCheckout: "Redirection vers le paiement…",
  continueToCheckout: "Continuer vers le paiement",
  textDefinition:
    "Un « texto » correspond à un segment de message de 160 caractères. Les " +
    "longs textos et les émojis en utilisent plus d'un. Les textos entrants ne comptent jamais.",
  checkoutOpenFailed:
    "Impossible d'ouvrir le paiement. C'est habituellement un bref pépin de " +
    "connexion. Vérifiez votre connexion et réessayez.",

  // ── The editable pre-checkout summary ─────────────────────────────────────
  workspaceTitle: "Votre espace de travail",
  workspaceHint:
    "Vous pouvez encore modifier ces éléments avant de payer. Ils se verrouillent une fois votre numéro configuré.",
  workspaceNameLabel: "Nom de l'espace de travail",
  workspaceNameRequired: "Votre espace de travail a besoin d'un nom.",
  businessNumberLabel: "Votre numéro d'affaires",
  alsoTextsUs: "· texte aussi vers les États-Unis",
  alsoTextUsLabel: "Texter aussi des clients avec des numéros américains",
  usTextingFeeShort:
    "Les textos vers les États-Unis exigent une inscription unique de {fee} auprès des opérateurs.",
  saveNumber: "Enregistrer le numéro",
  saveChangeFailed:
    "Impossible d'enregistrer ce changement. Réessayez dans un moment.",

  // ── Port sub-wizard: the number ───────────────────────────────────────────
  portNumberTitle: "Quel numéro voulez-vous transférer ?",
  portNumberSubtitle:
    "Entrez le numéro que vos clients textent déjà. Nous vérifierons qu'il " +
    "peut être transféré vers Loonext. Aucun engagement pour l'instant.",
  portCurrentNumberLabel: "Votre numéro d'affaires actuel",
  portTollFreeNote:
    "Numéros locaux américains ou canadiens seulement. Les numéros sans frais ne peuvent pas être transférés ici.",
  portGetNewInstead: "Obtenir un nouveau numéro à la place",
  portChecking: "Vérification de votre numéro…",
  portCheckAction: "Vérifier ce numéro",
  portEnterNumberError:
    "Entrez votre numéro américain ou canadien à 10 chiffres.",
  portCheckFailed:
    "Impossible de vérifier ce numéro pour l'instant. Réessayez dans un moment.",

  // ── Port sub-wizard: the losing carrier's account ─────────────────────────
  portCarrierTitle: "Votre compte chez l'opérateur actuel",
  portCarrierSubtitle:
    "Ces renseignements viennent de votre fournisseur actuel. Les faire " +
    "correspondre à votre dernière facture est le moyen le plus sûr d'obtenir " +
    "un transfert sans accroc.",
  portEntityNameLabel: "Nom du titulaire du compte",
  portEntityNamePlaceholder: "L'entreprise ou la personne inscrite sur la facture",
  portEntityNameHint: "Exactement comme sur votre facture actuelle.",
  portAuthPersonLabel: "Personne autorisée",
  portAuthPersonPlaceholder: "Qui a le droit de modifier le compte",
  portAccountNumberLabel: "Numéro de compte",
  portAccountNumberPlaceholder: "Le numéro de votre compte actuel",
  portBillingPhoneLabel: "Numéro de téléphone de facturation",
  ifDifferent: "(s'il est différent)",
  portBillingPhoneHint:
    "Le numéro principal du compte, s'il n'est pas celui que vous transférez.",
  portWirelessNote:
    "C'est un numéro mobile, alors votre opérateur exige deux renseignements " +
    "de plus pour le libérer. Nous ne conservons que les 4 derniers chiffres " +
    "du {idName}, jamais le numéro complet.",
  portPinLabel: "NIP / mot de passe de transfert",
  portPinPlaceholder: "Votre opérateur peut vous le fournir",
  portLast4Label: "4 derniers chiffres du {idName} du titulaire",
  portLast4Aria:
    "Pourquoi nous demandons les 4 derniers chiffres du {idName}",
  portLast4Tooltip:
    "Les opérateurs mobiles vérifient l'identité du titulaire avant de " +
    "libérer un numéro. Nous transmettons seulement les 4 derniers chiffres à " +
    "l'opérateur et ne conservons que ces 4 chiffres, jamais le {idName} complet.",
  portCarrierMissing:
    "Remplissez le titulaire du compte, la personne autorisée et le numéro de compte.",
  portLast4Error:
    "Entrez les 4 derniers chiffres du {idName} du titulaire du compte.",
  portPinError: "Entrez le NIP de transfert fourni par votre opérateur actuel.",

  // ── Port sub-wizard: the service address ──────────────────────────────────
  portAddressTitle: "Adresse de service au dossier",
  portAddressSubtitle:
    "L'adresse que votre opérateur actuel a pour ce numéro. Un écart ici est " +
    "la cause la plus fréquente de retard d'un transfert. Copiez-la de votre " +
    "dernière facture.",
  streetPlaceholder: "1, rue Principale",
  suiteLabel: "Bureau / unité",
  suitePlaceholder: "Unité 4",
  portAddressMissing:
    "Remplissez ces champs : rue, ville, {region} et {postal}.",

  // ── Port sub-wizard: timing ───────────────────────────────────────────────
  portTimingTitle: "Quand le transfert doit-il avoir lieu ?",
  portTimingSubtitle:
    "Choisissez une date cible si vous en avez une, ou laissez-nous le faire " +
    "dès que votre opérateur confirme.",
  portFocDateLabel: "Date de transfert souhaitée",
  portHowItWorks: "Comment se déroule le transfert",
  portDocumentsNote:
    "Après le paiement, vous téléverserez une autorisation signée et une " +
    "facture récente. Nous enverrons ensuite le transfert à votre opérateur. " +
    "Nous vous guiderons.",
  portBridgeAria:
    "Donnez-moi un numéro temporaire pendant le transfert de mon numéro",
  portBridgeLabel: "Donnez-moi un numéro temporaire pour texter dès maintenant",
  portBridgeHint:
    "Textez vos clients dès aujourd'hui pendant le transfert de {number}. " +
    "Vous pourrez le libérer une fois votre numéro arrivé.",
  portSavingTransfer: "Enregistrement de votre transfert…",
  portWorkspaceError:
    "Une erreur s'est produite pendant la création de votre espace de travail. Revenez à l'étape précédente et réessayez.",
  portDetailsMissing:
    "Certains renseignements du transfert sont manquants. Revenez en arrière et complétez-les.",
  portSaveFailed:
    "Impossible d'enregistrer votre transfert pour l'instant. Réessayez dans un moment.",
  yourNumberFallback: "votre numéro",

  // ── The setting-up checklist ──────────────────────────────────────────────
  settingUpTitle: "Configuration de votre numéro",
  numberReadyTitle: "Votre numéro est prêt !",
  rowDone: ", terminé",
  rowNeedsAttention: ", nécessite votre attention",
  rowInProgress: ", en cours",
  rowCreatingNumber: "Création de votre numéro",
  rowRegistering: "Inscription de votre entreprise auprès des opérateurs",
  rowInboxReady: "Boîte de réception prête",
  confirmingPayment: "Confirmation de votre paiement. Quelques secondes.",
  chooseYourNumber: "Choisir votre numéro",
  registrationNotNeeded:
    "Pas nécessaire. Les textos au Canada fonctionnent tout de suite.",
  fixAndResubmit: "Corriger et renvoyer",
  fixMemberNote:
    "Demandez au propriétaire ou à un administrateur de corriger les renseignements signalés et de renvoyer le tout.",
  inboxReadyHint:
    "Textez votre nouveau numéro depuis votre téléphone et regardez le message arriver.",
  inboxWaitingHint:
    "Vous pouvez commencer à utiliser Loonext dès maintenant. Votre boîte de " +
    "réception se remplit dès que votre numéro est prêt, et nous vous " +
    "tiendrons au courant en haut de chaque écran.",
  openInbox: "Ouvrir votre boîte de réception",
  rejectionFallback: "l'opérateur a signalé un détail",
  yourMobileFallback: "votre cellulaire",
  switchDateFallback: "votre date de transfert",
  otpCodeError: "Entrez le code à 6 chiffres reçu par texto.",
  otpResent: "Nous avons envoyé un nouveau code. Il est valide 24 heures.",
  otpAria: "Code de vérification",
  otpVerify: "Vérifier",
  otpResend: "Renvoyer le code",
  otpResendIn: "Renvoyer le code ({seconds} s)",
  otpOwnerOnly:
    "Le propriétaire du compte ou un administrateur entre le code ici.",

  // ── Sign in ───────────────────────────────────────────────────────────────
  logIn: "Se connecter",
  loggingIn: "Connexion…",
  loginSubtitle: "Les textos de votre équipe vous attendent.",
  emailLabel: "Courriel",
  passwordLabel: "Mot de passe",
  forgotPassword: "Mot de passe oublié ?",
  newToLoonext: "Nouveau sur Loonext ?",
  createAccount: "Créer un compte",
  useDifferentAccount: "Utiliser un autre compte",
  oauthFailed:
    "Nous n'avons pas pu terminer votre connexion avec ce fournisseur. " +
    "Réessayez, ou utilisez votre courriel et votre mot de passe ci-dessous.",
  continueWithGoogle: "Continuer avec Google",
  openingGoogle: "Ouverture de Google…",
  or: "ou",
  lastUsed: "Dernière utilisation",

  emailRequired: "Entrez votre adresse courriel.",
  passwordRequired: "Entrez votre mot de passe.",
  nameRequired: "Entrez votre nom.",
  passwordTooShort: "Utilisez au moins 8 caractères.",
  passwordMismatch: "Les mots de passe ne correspondent pas.",

  tabSignUp: "Créez votre compte",
  tabResetPassword: "Réinitialisez votre mot de passe",
  tabSetNewPassword: "Définissez un nouveau mot de passe",
  tabAcceptInvitation: "Acceptez votre invitation",
  tabGetStarted: "Commencer · Loonext",
  tabBusinessName: "Le nom de votre entreprise",
  tabBusinessDetails: "À propos de votre entreprise",
  tabHowYoullText: "Comment vous texterez",
  tabChoosePlan: "Choisissez votre forfait",
  tabYourNumber: "Votre numéro d'affaires",
  tabPortYourNumber: "Transférez votre numéro",

  verticalProfessional: "Services professionnels et à domicile",
  verticalConstruction: "Construction et métiers",
  verticalAgriculture: "Agriculture et aménagement paysager",
  verticalRetail: "Commerce de détail",
  verticalHospitality: "Hôtellerie, restauration et voyage",
  verticalRealEstate: "Immobilier et gestion immobilière",
  verticalHealthcare: "Santé et mieux-être",
  verticalTransportation: "Transport et déménagement",
  verticalEducation: "Éducation",
  verticalFinancial: "Services financiers",
  verticalInsurance: "Assurance",
  verticalLegal: "Droit",
  verticalTechnology: "Technologie",
  verticalManufacturing: "Fabrication",
  verticalEnergy: "Énergie et services publics",
  verticalCommunication: "Communications et médias",
  verticalEntertainment: "Divertissement et événements",
  verticalHumanResources: "Dotation et ressources humaines",
  verticalPostal: "Services postaux et livraison",
  verticalNgo: "Organisme sans but lucratif",
  verticalGovernment: "Gouvernement",
  verticalPolitical: "Politique",
  verticalGambling: "Jeux d'argent",

  bizStreetRequired: "Entrez votre adresse municipale.",
  bizCityRequired: "Entrez votre ville.",
  bizStateRequiredUs: "Choisissez votre État.",
  bizStateRequiredCa: "Choisissez votre province.",
  bizPostalRequiredUs: "Entrez votre code ZIP.",
  bizPostalRequiredCa: "Entrez votre code postal.",
  bizPostalTooLong: "Gardez cela sous 10 caractères.",
  bizWebsiteTooLong: "Gardez cela sous 255 caractères.",
  bizEmailInvalid: "Entrez une véritable adresse courriel.",
  bizPhoneInvalid:
    "Entrez un numéro de téléphone où les fournisseurs peuvent vous joindre.",
  bizLegalNameRequired: "Entrez la dénomination légale de votre entreprise.",
  bizTaxIdRequired: "Entrez votre {id} (les chiffres et les tirets conviennent).",
  bizFirstNameRequired: "Entrez votre prénom légal.",
  bizLastNameRequired: "Entrez votre nom de famille légal.",
  bizLast4Required: "Entrez les 4 derniers chiffres de votre {id}.",
  bizMobileInvalid: "Entrez un numéro mobile américain ou canadien.",
  bizWebsiteInvalid: "Cela ne ressemble pas à une adresse web.",

  companyNameRequired: "Entrez le nom de votre entreprise.",
  companyNameTooLong: "Gardez cela sous 200 caractères.",

  textingFlowTooShort:
    "Donnez aux fournisseurs au moins une phrase ou deux (40 caractères et plus).",
  textingFlowTooLong: "Gardez cela sous 2 048 caractères.",
  textingSampleTooShort:
    "Rédigez un texto réaliste, d'au moins 20 caractères.",
  textingSampleTooLong: "Gardez cela sous 1 024 caractères.",

  crewFitPrompt:
    "Tout le monde répond sur le même numéro, alors ceci ne sert qu'à " +
    "déterminer quel forfait convient. Passez la question si vous préférez.",
  crewFitBeyond:
    "Notre plus grand forfait couvre {seats} personnes. Au-delà, dites-nous " +
    "comment votre équipe fonctionne et nous serons francs avec vous sur ce " +
    "qui convient.",
  crewFitPlan:
    "{plan} couvre jusqu'à {seats} personnes pour {amount} par mois, peu " +
    "importe le nombre de clients à qui vous textez.",

  planCardTextingIncluded: "Textos inclus, selon un usage raisonnable",
  planCardIncomingFree: "Textos et photos reçus gratuits, toujours",
  planCardOverage:
    "Mois chargé ? Les textos supplémentaires sont facturés selon un usage " +
    "raisonnable, plafonnés par vous",
  planCardNumbersOne: "{count} numéro d'affaires",
  planCardNumbersMany: "{count} numéros d'affaires",
  planCardCrewStarter: "Toute votre équipe, {seats} coéquipiers",
  planCardCrewPro: "{seats} coéquipiers",
  planCardDaily: "environ {amount} par jour",

  setupNeedsYou:
    "Une étape ci-dessous a besoin de vous. Le reste se met à jour tout seul.",
  setupAllLive:
    "Tout ci-dessous est actif. Textez votre nouveau numéro pour le voir arriver.",
  setupNumberReady:
    "Textez votre nouveau numéro pour le voir arriver. Une étape ci-dessous " +
    "est encore en cours.",
  setupUpdatesItself:
    "Cet écran se met à jour tout seul. Aucun rafraîchissement nécessaire.",

  portChecklistTitle: "Transfert de votre numéro vers Loonext",
  portChecklistNeedsDocuments:
    "Téléversez votre autorisation signée (LOA) et une facture de téléphone " +
    "récente pour lancer le transfert. Votre numéro ne peut pas être " +
    "transféré tant que nous n'avons pas les deux.",
  portChecklistNeedsDocumentsCta: "Téléverser vos documents",
  portChecklistNeedsSubmit:
    "Vos documents sont reçus. Envoyez le transfert à votre fournisseur " +
    "quand vous serez prêt.",
  portChecklistNeedsSubmitCta: "Réviser et envoyer le transfert",
  portChecklistMemberDocuments:
    "Le propriétaire du compte ou un administrateur téléverse l'autorisation " +
    "signée (LOA) et une facture de téléphone récente pour lancer le transfert.",
  portChecklistInReviewWindow:
    "Le transfert complet prend habituellement de quelques jours ouvrables à " +
    "environ deux semaines (É.-U.), souvent plus vite au Canada.",
  portChecklistTrackLink: "Suivez-le dans Réglages → Numéros",

  // ── Sign up ───────────────────────────────────────────────────────────────
  createYourAccount: "Créez votre compte",
  signupSubtitle:
    "Un numéro d'affaires pour toute votre équipe. Configuré en quelques minutes.",
  yourNameLabel: "Votre nom",
  yourNamePlaceholder: "Sam Rivard",
  creatingAccount: "Création de votre compte…",
  createAccountAction: "Créer le compte",
  alreadyHaveAccount: "Vous avez déjà un compte ?",
  checkYourEmail: "Vérifiez vos courriels",
  confirmationSentPrefix: "Nous avons envoyé un lien de confirmation à",
  confirmationSentSuffix: ". Ouvrez-le pour terminer la création de votre compte.",
  wrongAddress: "Mauvaise adresse ?",
  startOver: "Recommencer",

  // ── Password reset ────────────────────────────────────────────────────────
  resetTitle: "Réinitialisez votre mot de passe",
  resetSubtitle:
    "Entrez votre courriel et nous vous enverrons un lien pour en définir un nouveau.",
  resetSentPrefix: "Si un compte existe pour",
  resetSentSuffix:
    ", nous lui avons envoyé un lien pour définir un nouveau mot de passe.",
  sending: "Envoi…",
  sendResetLink: "Envoyer le lien de réinitialisation",
  rememberedIt: "Vous vous en souvenez ?",
  backToLogin: "Retour à la connexion",
  checkingLink: "Vérification de votre lien…",
  linkExpiredTitle: "Ce lien est expiré",
  linkExpiredBody:
    "Les liens de mot de passe ne fonctionnent qu'une seule fois et expirent " +
    "après un certain temps. Demandez-en un nouveau et réessayez.",
  requestNewLink: "Demander un nouveau lien",
  setNewPasswordTitle: "Définissez un nouveau mot de passe",
  setNewPasswordSubtitle: "Vous resterez connecté sur cet appareil.",
  newPasswordLabel: "Nouveau mot de passe",
  confirmPasswordLabel: "Confirmez le mot de passe",
  savePassword: "Enregistrer le mot de passe",
  passwordUpdated: "Mot de passe mis à jour.",

  // ── Two-factor at the door ────────────────────────────────────────────────
  mfaCodeTitle: "Entrez votre code",
  mfaRecoveryTitle: "Utiliser un code de secours",
  mfaCodeBody:
    "Ouvrez votre application d'authentification et tapez les six chiffres affichés.",
  mfaRecoveryBody:
    "Un des dix codes que vous avez enregistrés à l'activation de la double " +
    "authentification. En utiliser un DÉSACTIVE la double authentification, " +
    "pour que vous puissiez entrer et la réactiver.",
  mfaCodeAria: "Code à six chiffres",
  mfaRecoveryAria: "Code de secours",
  mfaUseThisCode: "Utiliser ce code",
  mfaNoAuthenticator: "Je n'ai pas mon application d'authentification",
  mfaHaveAuthenticator: "J'ai finalement mon application d'authentification",
  mfaNoFactor:
    "Nous n'avons trouvé aucune application d'authentification sur ce compte. Déconnectez-vous et reconnectez-vous.",
  mfaCodeMismatch:
    "Ce code ne correspond pas. Vérifiez votre application et essayez le suivant.",
  mfaRateLimited: "Trop de codes erronés. Réessayez dans une heure.",
  mfaCodeInvalid: "Ce code n'est pas valide.",
  mfaNetwork:
    "Nous n'avons pas pu joindre le serveur. Vérifiez votre connexion.",

  // ── The front door's captcha ──────────────────────────────────────────────
  securityCheckAria: "Vérification de sécurité",
  securityCheckFailed:
    "Nous n'avons pas pu charger la vérification de sécurité. Actualisez la page et réessayez.",
  captchaNotConfigured:
    "Le captcha n'est pas configuré dans cet environnement.",

  // ── Invites ───────────────────────────────────────────────────────────────
  aLoonextWorkspace: "un espace de travail Loonext",
  inviteBannerText: "Vous avez été invité à joindre",
  inviteBannerAria: "Vous avez été invité à joindre {company}",
  join: "Joindre",
  dismissInvite: "Ignorer l'invitation",
  openingInvite: "Ouverture de votre invitation…",
  invitedTitle: "Vous êtes invité",
  invitedBody:
    "Connectez-vous pour joindre la boîte de réception partagée de votre " +
    "équipe. Utilisez l'adresse courriel à laquelle cette invitation a été envoyée.",
  loginToAccept: "Se connecter pour accepter",
  noPasswordYet: "Pas encore de mot de passe ?",
  setOneHere: "Définissez-en un ici",
  whatsYourName: "Quel est votre nom ?",
  nameForTeammates:
    "Vos coéquipiers le verront sur les messages, les notes et les tâches.",
  inviteNamePlaceholder: "Alex Rivard",
  joining: "Adhésion…",
  joiningTeam: "Adhésion à votre équipe…",
  saveNameFailed: "Impossible d'enregistrer votre nom. Réessayez.",
  loginDifferentEmail: "Se connecter avec une autre adresse",
  inviteWrongEmailTitle: "Cette invitation appartient à une autre adresse",
  inviteWrongEmailBody:
    "Connectez-vous avec l'adresse courriel à laquelle l'invitation a été envoyée, puis ouvrez le lien de nouveau.",
  inviteConflictTitle: "Cette invitation ne peut pas être utilisée",
  inviteNotFoundTitle: "Ce lien d'invitation ne fonctionne pas",
  inviteNotFoundBody:
    "Il a peut-être été révoqué. Demandez à votre équipe d'en envoyer un nouveau.",
  inviteErrorTitle: "Une erreur s'est produite",
  inviteErrorBody:
    "Nous n'avons pas pu accepter l'invitation. Vérifiez votre connexion et réessayez.",

  // ── The joining member's orientation ──────────────────────────────────────
  orientationInboxTitle: "Une boîte de réception, toute l'équipe",
  orientationInboxBody:
    "Chaque texto que vos clients envoient arrive ici, et toute l'équipe peut " +
    "le voir. Rien ne reste sans réponse dans le téléphone d'une seule personne.",
  orientationNumberTitle: "Vous répondez au nom de l'entreprise",
  orientationNumberBody:
    "Vos réponses partent du numéro de l'espace de travail, alors les clients " +
    "n'obtiennent jamais votre numéro personnel. Si un numéro n'est pas " +
    "partagé avec vous, les paramètres vous disent lequel et pourquoi.",
  orientationNotesTitle: "Les notes restent à l'interne",
  orientationNotesBody:
    "Basculez le rédacteur en mode Note et seule l'équipe la voit — jamais le " +
    "client. Mentionnez un coéquipier dans une note et elle arrive dans son Pour vous.",
  orientationNotificationsTitle: "Vous choisissez quand nous vous avertissons",
  orientationNotificationsBody:
    "Vous joignez un espace de travail qui a déjà du trafic. Activez les " +
    "notifications pour le travail qui vous est destiné, et modifiez-les quand " +
    "vous voulez dans les paramètres.",
  saysAttribution: "{name} dit",
  theySaid: "On a écrit",
  stepXofY: "Étape {current} sur {total}",
  skip: "Passer",
  next: "Suivant",
  notNow: "Pas maintenant",
  turnOnNotifications: "Activer les notifications",
  turningOn: "Activation…",
  startWorking: "Commencer à travailler",

  // --- Échecs d'authentification --------------------------------------------
  authInvalidCredentials:
    "Ce courriel ou ce mot de passe n'est pas le bon. Réessayez.",
  authEmailNotConfirmed:
    "Confirmez d'abord votre courriel. Nous vous avons envoyé un lien à " +
    "l'inscription.",
  authEmailExists:
    "Vous avez déjà un compte avec ce courriel. Connectez-vous plutôt.",
  authWeakPassword:
    "Ce mot de passe est trop facile à deviner. Utilisez au moins 8 caractères.",
  authSamePassword: "C'est déjà votre mot de passe. Choisissez-en un nouveau.",
  authLinkExpired: "Ce lien a expiré. Demandez-en un nouveau.",
  authTooManyAttempts: "Trop de tentatives. Attendez une minute et réessayez.",
  authUserNotFound: "Nous n'avons trouvé aucun compte avec ce courriel.",
  authSessionEnded: "Votre session a pris fin. Connectez-vous de nouveau.",
  authCaptchaFailed:
    "Nous n'avons pas pu confirmer que vous êtes une personne. Actualisez la " +
    "page et réessayez.",
  authFailed: "Une erreur s'est produite. Réessayez dans un moment.",
};
