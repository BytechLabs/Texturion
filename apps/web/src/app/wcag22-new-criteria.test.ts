/**
 * #238: the WCAG 2.2 criteria that §7 never mentioned, and 1.3.5 which the
 * 2.1 contract also missed.
 *
 * ── WHY THIS FILE EXISTS ──────────────────────────────────────────────────
 *
 * The issue asked for "the 2.1 → 2.2 delta" and the work that followed covered
 * the three criteria the issue NAMED: 2.5.7 dragging, 2.5.8 target size and the
 * focus criteria. WCAG 2.2 added six Level A/AA criteria in total. Three had
 * never been looked at:
 *
 *   3.2.6 Consistent Help (A)              : a help route, if offered, sits in
 *                                            the same place on every page.
 *   3.3.7 Redundant Entry (A)              : do not ask for what was already
 *                                            entered in the same flow.
 *   3.3.8 Accessible Authentication (AA)   : signing in must not need a
 *                                            cognitive test: no blocked paste,
 *                                            no field a password manager cannot
 *                                            recognise.
 *
 * And 1.3.5 Identify Input Purpose (AA, from 2.1): the form fields that ask
 * for the person's own name, email, phone and address must say so in
 * `autocomplete`. It was not in §7 either, and the registration form that
 * collects a brand's contact details had six fields that did not.
 *
 * 3.3.8 and 1.3.5 are the same mechanism: the browser and the password manager
 * can only do the remembering for the person if the field names its purpose
 * and nothing stops them pasting.
 *
 * ── WHAT IS AND IS NOT CLAIMED ────────────────────────────────────────────
 *
 * Checked here, from source: the autocomplete token on every identity field,
 * the absence of any paste/copy/cut/drop handler in the sign-in surface, the
 * one-time-code token on every code field, and that the help route exists in
 * the same slot on every signed-out screen.
 *
 * NOT checked, and said so in docs/ACCESSIBILITY.md:
 *  - 3.3.7 needs a judgement about each multi-step flow; the specified
 *    position is that every prefilled field is shown back, never re-asked, and
 *    nothing mechanical can decide that for a flow nobody has written yet.
 *  - The Turnstile widget on the sign-in forms is Cloudflare's, and whether its
 *    managed challenge ever escalates to a cognitive test is outside our code.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { sourceFiles, sourceText, stripComments } from "@/test/source-tree";

const SRC = join(process.cwd(), "src");

/** A path as the roster spells it: relative to src/, forward slashes. */
function relative(path: string): string {
  return path.slice(SRC.length + 1).replace(/\\/g, "/");
}

const productionFiles = sourceFiles(SRC, [".tsx"]).filter(
  (file) => !/\.test\.tsx?$/.test(file),
);

const code = (rel: string): string => {
  const abs = join(SRC, rel);
  expect(existsSync(abs), `${rel} should exist`).toBe(true);
  return stripComments(sourceText(abs));
};

/**
 * Where a person types their own details or their credentials. A directory
 * means every `.tsx` below it.
 */
const IDENTITY_SCOPE = [
  "app/(auth)/",
  "components/auth/",
  "app/onboarding/",
  "components/settings/registration-fix-form.tsx",
  "components/settings/change-password-card.tsx",
  "components/settings/change-email-card.tsx",
  "components/settings/two-factor-card.tsx",
  "app/(app)/settings/profile/page.tsx",
  "app/(app)/settings/workspace/page.tsx",
];

/** The sign-in surface: where 3.3.8 forbids interfering with the credential. */
const SIGN_IN_SCOPE = [
  "app/(auth)/",
  "components/auth/",
  "components/ui/password-input.tsx",
  "components/settings/change-password-card.tsx",
  "components/settings/two-factor-card.tsx",
];

const inScope = (rel: string, scope: readonly string[]): boolean =>
  scope.some((entry) => (entry.endsWith("/") ? rel.startsWith(entry) : rel === entry));

/** The `autocomplete` tokens 1.3.5 recognises, plus the two we use on purpose. */
const TOKENS = new Set([
  "off",
  "name",
  "given-name",
  "additional-name",
  "family-name",
  "honorific-prefix",
  "organization",
  "organization-title",
  "email",
  "username",
  "new-password",
  "current-password",
  "one-time-code",
  "tel",
  "tel-national",
  "street-address",
  "address-line1",
  "address-line2",
  "address-level1",
  "address-level2",
  "postal-code",
  "country",
  "country-name",
  "url",
  "bday",
]);

/** Input types that hold no personal detail, so 1.3.5 has nothing to say. */
const NOT_PERSONAL_TYPE =
  /\btype=(?:"|\{")?(?:date|datetime-local|time|month|week|checkbox|radio|file|range|hidden|search|submit|button|color)\b/;

interface Field {
  rel: string;
  line: number;
  tag: string;
}

/**
 * Every `<Input>`, `<PasswordInput>` and `<input>` opening tag, brace-aware so
 * an arrow function in a prop (`=>`) does not end the tag early.
 *
 * `<Textarea>` is deliberately not here: free text is not a personal detail
 * with a registered purpose, and `<InputOTP` never matches (`\b`).
 */
function fieldsIn(rel: string, text: string): Field[] {
  const found: Field[] = [];
  const open = /<(Input|PasswordInput|input)\b/g;
  let match: RegExpExecArray | null;
  while ((match = open.exec(text))) {
    let depth = 0;
    let end = match.index + match[0].length;
    for (; end < text.length; end += 1) {
      const char = text[end];
      if (char === "{") depth += 1;
      else if (char === "}") depth -= 1;
      else if (char === ">" && depth === 0 && text[end - 1] !== "=") break;
    }
    found.push({
      rel,
      line: text.slice(0, match.index).split("\n").length,
      tag: text.slice(match.index, end + 1),
    });
  }
  return found;
}

const identityFields: Field[] = productionFiles
  .map((file) => ({ rel: relative(file), text: stripComments(sourceText(file)) }))
  .filter(({ rel }) => inScope(rel, IDENTITY_SCOPE))
  .flatMap(({ rel, text }) => fieldsIn(rel, text))
  .filter((field) => !NOT_PERSONAL_TYPE.test(field.tag));

const where = (field: Field): string =>
  `${field.rel}:${field.line}  ${field.tag.replace(/\s+/g, " ").slice(0, 110)}`;

describe("#238 WCAG 2.2 criteria beyond the named three", () => {
  it("W-0: the scan looked at enough fields to mean something", () => {
    // A guard whose healthy state is "found nothing" is indistinguishable from
    // one that read the wrong directory. Today's count is 58; the floor sits
    // just under it so deleting a form's fields cannot go unremarked.
    expect(identityFields.length).toBeGreaterThanOrEqual(56);
  });

  it("W-1 (1.3.5): every identity field states its purpose, or says it has none", () => {
    // `autoComplete="off"` is a decision (an EIN is not something a browser
    // should keep); an ABSENT attribute is nobody having decided.
    const undecided = identityFields.filter(
      (field) => !/\bautoComplete=/.test(field.tag),
    );
    expect(
      undecided.map(where),
      "These fields collect a person's details and name no autocomplete " +
        "purpose (WCAG 1.3.5). Use the registered token, or autoComplete=\"off\" " +
        "if the value is not something a browser should remember:\n  " +
        undecided.map(where).join("\n  "),
    ).toEqual([]);
  });

  it("W-2 (1.3.5): a literal autocomplete value is a registered token", () => {
    // `autoComplete="firstname"` is a typo the browser ignores in silence, so
    // the field looks handled and a password manager still cannot fill it.
    const unknown = identityFields.filter((field) => {
      const literal = field.tag.match(/\bautoComplete="([^"]*)"/);
      return literal !== null && !TOKENS.has(literal[1]);
    });
    expect(unknown.map(where)).toEqual([]);
  });

  it("W-3 (3.3.8): every password field says whether it is a new or an existing one", () => {
    // Without the distinction a password manager does not know whether to fill
    // or to offer a generated one, and either failure is the person typing a
    // password from memory.
    const passwords = productionFiles
      .map((file) => ({ rel: relative(file), text: stripComments(sourceText(file)) }))
      .filter(({ rel }) => !rel.startsWith("components/ui/"))
      .flatMap(({ rel, text }) => fieldsIn(rel, text))
      .filter((field) => /<PasswordInput\b|\btype="password"/.test(field.tag));

    expect(passwords.length, "the sign-in forms were not found").toBeGreaterThanOrEqual(5);
    const wrong = passwords.filter(
      (field) =>
        !/\bautoComplete="(?:current-password|new-password)"/.test(field.tag),
    );
    expect(wrong.map(where)).toEqual([]);
  });

  it("W-4 (3.3.8): login asks for an existing password and signup for a new one", () => {
    expect(code("app/(auth)/login/page.tsx")).toContain(
      'autoComplete="current-password"',
    );
    expect(code("app/(auth)/signup/page.tsx")).toContain(
      'autoComplete="new-password"',
    );
    expect(code("app/(auth)/update-password/page.tsx")).toContain(
      'autoComplete="new-password"',
    );
  });

  it("W-5 (3.3.8): every one-time code field names itself as one", () => {
    // A six-digit code is the textbook transcription test. `one-time-code` is
    // what lets a phone offer the code from the message it just received.
    for (const rel of [
      "components/auth/mfa-challenge.tsx",
      "components/settings/change-password-card.tsx",
      "components/settings/two-factor-card.tsx",
    ]) {
      expect(code(rel), rel).toContain("one-time-code");
    }
  });

  it("W-6 (3.3.8): nothing on the sign-in surface blocks paste, copy, cut or drop", () => {
    // Blocking paste is the commonest way a form fails a person who cannot
    // reliably retype a long password.
    const offenders = productionFiles
      .map((file) => ({ rel: relative(file), text: stripComments(sourceText(file)) }))
      .filter(({ rel }) => inScope(rel, SIGN_IN_SCOPE))
      .filter(({ text }) => /\bon(?:Paste|Copy|Cut|Drop|BeforeInput)\b/.test(text))
      .map(({ rel }) => rel);
    expect(offenders).toEqual([]);
  });

  it("W-7 (3.3.8): the only paste handlers in the app are the message composers", () => {
    // They intercept a pasted IMAGE to attach it. If a fourth appears, someone
    // should look at whether it sits on a credential or code field.
    const handlers = productionFiles
      .filter((file) => /\bonPaste=/.test(stripComments(sourceText(file))))
      .map(relative)
      .sort();
    expect(handlers).toEqual([
      "components/inbox/new-conversation.tsx",
      "components/tasks/task-detail-panel.tsx",
      "components/tasks/task-feed.tsx",
      "components/thread/composer.tsx",
    ]);
  });

  it("W-8 (3.2.6): every signed-out screen carries the same help link in the same slot", () => {
    // The slot is the AUTH LAYOUT, directly under the card. Putting it in the
    // layout rather than per page is what makes "consistent" a property of the
    // code instead of a thing five pages each have to remember.
    const layout = code("app/(auth)/layout.tsx");
    expect(layout).toContain("<AuthHelp />");
    expect(layout.indexOf("{children}")).toBeLessThan(layout.indexOf("<AuthHelp />"));

    const help = code("components/auth/auth-help.tsx");
    expect(help).toContain('href="/contact"');
    expect(help).toContain("onboarding.authHelpLink");
  });

  it("W-9 (3.2.6): the other two help routes exist where their screens expect them", () => {
    // Signed-in: Settings → Help. Marketing: the footer's contact link, on every
    // page because the footer is in the shared shell.
    expect(code("components/settings/settings-nav.tsx")).toContain('slug: "help"');
    expect(code("components/marketing/footer.tsx")).toContain(
      "href: LIVE_ROUTES.contact",
    );
  });
});
