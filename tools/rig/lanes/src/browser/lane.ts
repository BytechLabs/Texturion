/**
 * The Playwright browser lane: one browser profile per member, each with its
 * own code on the fake microphone and the in-page judge installed.
 *
 * A profile signs its member in on the app's own login page the first time
 * the app sends it there, and keeps the session for later runs. A kept session
 * is a known device: the app mails the account holder about every session id
 * it has not seen (apps/api auth/new-device-notice.ts), and each mail spends
 * the guard's Resend budget. The UI steps
 * find controls by role and English name, the way a member does ("Answer",
 * "Hang up", "Call"). The web app has no test-id contract for calls yet;
 * `SELECTORS` is the one place to change when it lands.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium, type BrowserContext, type BrowserType, type Page } from "playwright";
import {
  analyzeFrames,
  detectCodes,
  SURFACES,
  SURFACE_HZ,
  type DetectOptions,
  type Detection,
  type NumberBook,
  type Surface,
} from "@loonext/rig-robot";
import { chromiumArgs, hostResolverRules } from "./args.ts";
import { installPageJudge, type PageCapture, type PageJudgeConfig, type RigJudgeHandle } from "./page-judge.ts";

export const JUDGE_CONFIG: PageJudgeConfig = { captureRate: 16_000, maxSeconds: 180, statsIntervalMs: 500 };

export const SELECTORS = {
  answer: { role: "button", name: "Answer" },
  decline: { role: "button", name: "Decline" },
  hangUp: { role: "button", name: "Hang up" },
  openDialer: { role: "button", name: "Dial" },
  dialerTitle: { role: "dialog", name: "Dial a number" },
  call: { role: "button", name: "Call" },
  incoming: { text: /Incoming call/ },
  /** apps/web/src/app/(auth)/login, as scripts/dev-shot.mjs signs in. */
  loginEmail: 'input[type="email"]',
  loginPassword: 'input[type="password"]',
  loginSubmit: 'form button[type="submit"]',
  /** The push card on /settings/notifications (components/notifications/permission-card.tsx). */
  pushCard: "Push on this device",
  pushTurnOn: { role: "button", name: "Turn on" },
  pushTurnOff: { role: "button", name: "Turn off" },
  /** The call bar's controls (apps/web/src/i18n/sections/shell.ts, English). */
  putOnHold: { role: "button", name: "Put on hold" },
  resume: { role: "button", name: /^Resume call with / },
  mute: { role: "button", name: "Mute" },
  unmute: { role: "button", name: "Unmute" },
  keypad: { role: "button", name: "Keypad" },
  transfer: { role: "button", name: "Transfer this call" },
  completeTransfer: { role: "button", name: "Complete transfer" },
  /** apps/web/src/app/(auth)/signup. */
  signUpName: 'input[name="name"]',
  /** The onboarding wizard (apps/web/src/app/onboarding, English): its name step's field and the shared Continue button. */
  companyName: 'input[name="name"]',
  wizardContinue: { role: "button", name: "Continue" },
  numberStepTitle: "How do you want your business number?",
  numbersLoadFailed: "Couldn't load numbers",
  /** The number picker's rows (components/numbers/number-picker.tsx); the step's other radios are its mode and country. */
  listedNumber: 'ul button[role="radio"]',
  checkoutCard: 'input[name="cardnumber"], input[name="cardNumber"]',
} as const;

/** Stripe's hosted pages the lane may follow Checkout and the portal to. */
export const STRIPE_HOSTS = ["checkout.stripe.com", "billing.stripe.com"] as const;

export const LOGIN_PATH = "/login";
const WIZARD_PATH = /^\/onboarding\/([a-z-]+)$/;
const WIZARD_STEP_TIMEOUT_MS = 15_000;
const SIGN_IN_TIMEOUT_MS = 30_000;
const PUSH_TIMEOUT_MS = 15_000;
const CLEARED_POLL_MS = 100;

export interface MemberCredentials {
  email: string;
  password: string;
}

export interface BrowserLaneOptions {
  /** e.g. https://app.rig.internal */
  appOrigin: string;
  profilesDir: string;
  /** Where writeFakeMicWavs put the surface WAVs. */
  fakeMicDir: string;
  numbers: NumberBook;
  /** The member's sign-in: the seed's tenants.json, by member key. */
  credentials?: (member: string) => MemberCredentials | undefined;
  /** The rig's Supabase origin: a sign-up's confirmation link opens its verify path. */
  authOrigin?: string;
  headless?: boolean;
  browserType?: BrowserType;
  executablePath?: string;
  /**
   * Google Chrome, for the pages opened with `push: true`: Chromium has no
   * push service, so Web Push (S21, D08) runs only there. It runs in Chrome's
   * own headless mode, which needs no display and gets a push subscription;
   * `headless: false` runs it headed, which needs a display.
   */
  chrome?: { executablePath: string };
}

export interface OpenOptions {
  /** The page needs Web Push: Google Chrome when the lane has it, else Chromium, which cannot subscribe. */
  push?: boolean;
}

/** A member's profile folder; Chrome's is kept apart, because a profile is not shared between browsers. */
export function profileName(member: string, chrome: boolean): string {
  return chrome ? `${member}.chrome` : member;
}

/** Where the onboarding wizard took a new owner, and what its number step's picker did. */
export interface OnboardingWalk {
  /** The wizard steps the page was on, in order; the last is where it stopped. */
  steps: string[];
  /** "listed" numbers to pick from, "failed" to load them, or neither within the wait. */
  numberSearch: "listed" | "failed" | "pending";
}

export class BrowserLane {
  readonly #o: BrowserLaneOptions;
  readonly #open = new Map<string, MemberPage>();
  readonly #public = new Set<PublicPage>();

  constructor(options: BrowserLaneOptions) {
    this.#o = options;
  }

  /** The member's page, launched once and reused for the run. */
  async open(member: string, surface: Surface, path = "/", options: OpenOptions = {}): Promise<MemberPage> {
    if (!/^[a-z0-9-]+$/.test(member)) throw new Error(`browser lane: "${member}" is not a member key`);
    const chrome = options.push ? this.#o.chrome : undefined;
    const name = profileName(member, chrome !== undefined);
    const existing = this.#open.get(name);
    if (existing) return existing;
    const profile = join(this.#o.profilesDir, name);
    mkdirSync(profile, { recursive: true });
    const context = await (this.#o.browserType ?? chromium).launchPersistentContext(profile, {
      headless: this.#o.headless ?? true,
      executablePath: chrome?.executablePath ?? this.#o.executablePath,
      args: chromiumArgs({ fakeMicWav: join(this.#o.fakeMicDir, `${surface}.wav`) }),
      permissions: ["microphone", "notifications"],
      locale: "en-CA",
      timezoneId: "America/Toronto",
    });
    await context.addInitScript(installPageJudge, JUDGE_CONFIG);
    const page = context.pages()[0] ?? (await context.newPage());
    const target = new URL(path, this.#o.appOrigin).toString();
    try {
      await page.goto(target);
      if (onLoginPage(page.url())) {
        await signIn(page, member, this.#o.credentials?.(member));
        if (new URL(page.url()).pathname !== new URL(target).pathname) await page.goto(target);
      }
    } catch (error) {
      await context.close().catch(() => undefined);
      throw error;
    }
    const opened = new MemberPage(member, surface, context, page, this.#o.numbers, this.#o.appOrigin);
    this.#open.set(name, opened);
    return opened;
  }

  /** A fresh browser with no profile and nobody signed in, closed with the run. */
  async openPublic(path: string): Promise<PublicPage> {
    const browser = await (this.#o.browserType ?? chromium).launch({
      headless: this.#o.headless ?? true,
      executablePath: this.#o.executablePath,
      args: [`--host-resolver-rules=${hostResolverRules()}`],
    });
    const context = await browser.newContext({ locale: "en-CA", timezoneId: "America/Toronto" });
    const page = await context.newPage();
    const opened = new PublicPage(page, this.#o.appOrigin, () => browser.close(), this.#o.authOrigin);
    this.#public.add(opened);
    await opened.goto(path);
    return opened;
  }

  async closeAll(): Promise<void> {
    await Promise.allSettled([...this.#open.values(), ...this.#public].map((page) => page.close()));
    this.#open.clear();
    this.#public.clear();
  }
}

/**
 * A visitor's page: the public sign-up, then the new owner's app. Steps find
 * controls by role and English name; a step that never offers its control
 * says so rather than clicking something else.
 */
export class PublicPage {
  readonly page: Page;
  readonly #origin: string;
  readonly #close: () => Promise<void>;
  readonly #authOrigin: string | undefined;

  constructor(page: Page, origin: string, close: () => Promise<void>, authOrigin?: string) {
    this.page = page;
    this.#origin = origin;
    this.#close = close;
    this.#authOrigin = authOrigin;
  }

  async goto(pathOrUrl: string): Promise<void> {
    const target = new URL(pathOrUrl, this.#origin);
    const verifyLink = this.#authOrigin !== undefined && target.origin === new URL(this.#authOrigin).origin && target.pathname === "/auth/v1/verify";
    if (target.origin !== new URL(this.#origin).origin && !verifyLink && !(STRIPE_HOSTS as readonly string[]).includes(target.hostname)) {
      throw new Error(`browser lane: ${target.hostname} is neither the rig's app, its sign-up verify link nor Stripe's hosted pages`);
    }
    await this.page.goto(target.toString());
  }

  async path(): Promise<string> {
    return new URL(this.page.url()).pathname;
  }

  async waitForText(text: string, timeoutMs: number): Promise<boolean> {
    try {
      await this.page.getByText(text, { exact: false }).first().waitFor({ timeout: timeoutMs });
      return true;
    } catch {
      return false;
    }
  }

  async signUp(args: { email: string; password: string; name: string }): Promise<{ ok: boolean; alert?: string }> {
    const name = this.page.locator(SELECTORS.signUpName);
    if (await name.count()) await name.fill(args.name);
    await this.page.locator(SELECTORS.loginEmail).fill(args.email);
    await this.page.locator(SELECTORS.loginPassword).first().fill(args.password);
    const submit = this.page.locator(SELECTORS.loginSubmit);
    await submit.and(this.page.locator(":enabled")).waitFor({ timeout: SIGN_IN_TIMEOUT_MS });
    await submit.click();
    const alert = await this.page.getByRole("alert").first().textContent({ timeout: 5_000 }).catch(() => null);
    return alert && /error|could not|invalid|already/i.test(alert) ? { ok: false, alert: alert.trim() } : { ok: true };
  }

  /**
   * Walks the onboarding wizard as far as it is safe to: the name step is
   * filled in and continued, and the walk stops on the number step without
   * touching it. Continuing from there creates the workspace, and the
   * Checkout after it ends in an order for a number. Null when the page is
   * not on the name step, or the name step never moves on.
   */
  async walkOnboarding(args: { business: string }): Promise<OnboardingWalk | null> {
    const wizardStep = () => WIZARD_PATH.exec(new URL(this.page.url()).pathname)?.[1];
    await this.page.waitForURL((url) => WIZARD_PATH.test(url.pathname), { timeout: WIZARD_STEP_TIMEOUT_MS }).catch(() => undefined);
    const steps: string[] = [];
    if (wizardStep() === "name") {
      steps.push("name");
      await this.page.locator(SELECTORS.companyName).fill(args.business);
      await this.page.getByRole(SELECTORS.wizardContinue.role, { name: SELECTORS.wizardContinue.name, exact: true }).click();
      await this.page.waitForURL((url) => url.pathname !== "/onboarding/name", { timeout: WIZARD_STEP_TIMEOUT_MS }).catch(() => undefined);
    }
    if (wizardStep() !== "number") return null;
    steps.push("number");
    await this.page.getByText(SELECTORS.numberStepTitle).waitFor({ timeout: WIZARD_STEP_TIMEOUT_MS });
    const failed = this.page.getByText(SELECTORS.numbersLoadFailed);
    const listed = this.page.locator(SELECTORS.listedNumber);
    await failed.or(listed.first()).first().waitFor({ timeout: WIZARD_STEP_TIMEOUT_MS }).catch(() => undefined);
    const numberSearch = (await failed.count()) > 0 ? "failed" : (await listed.count()) > 0 ? "listed" : "pending";
    return { steps, numberSearch };
  }

  async checkout(args: { card: string }): Promise<{ returned: boolean; challenged: boolean }> {
    if (!/^\d{16}$/.test(args.card)) throw new Error("browser lane: a test card is 16 digits");
    await this.goto("/settings/billing");
    await this.page.getByRole("button", { name: /^(Subscribe|Choose|Start|Upgrade)/ }).first().click({ timeout: PUSH_TIMEOUT_MS });
    await this.page.waitForURL((url) => url.hostname === "checkout.stripe.com", { timeout: 30_000 });
    const challenged = (await this.page.locator('iframe[src*="hcaptcha"], iframe[title*="challenge" i]').count()) > 0;
    await this.page.locator(SELECTORS.checkoutCard).first().fill(args.card);
    await this.page.locator('input[name="cardExpiry"]').fill("12 / 34");
    await this.page.locator('input[name="cardCvc"]').fill("123");
    const holder = this.page.locator('input[name="billingName"]');
    if (await holder.count()) await holder.fill("Rig Owner");
    await this.page.locator('button[type="submit"]').first().click();
    try {
      await this.page.waitForURL((url) => url.origin === new URL(this.#origin).origin, { timeout: 60_000 });
      return { returned: true, challenged };
    } catch {
      return { returned: false, challenged };
    }
  }

  async openBillingPortal(): Promise<string | null> {
    await this.goto("/settings/billing");
    try {
      await this.page.getByRole("button", { name: /portal|Manage billing|Manage subscription/i }).first().click({ timeout: PUSH_TIMEOUT_MS });
      await this.page.waitForURL((url) => url.hostname === "billing.stripe.com", { timeout: 30_000 });
      return new URL(this.page.url()).hostname;
    } catch {
      return null;
    }
  }

  close(): Promise<void> {
    return this.#close();
  }
}

export function onLoginPage(url: string): boolean {
  const { pathname } = new URL(url);
  return pathname === LOGIN_PATH || pathname.startsWith(`${LOGIN_PATH}/`);
}

/**
 * Signs a member in as a person does: the email, the password, and the
 * submit button once the app enables it (on the rig, Turnstile's always-pass
 * test key enables it after a moment).
 */
export async function signIn(page: Page, member: string, credentials: MemberCredentials | undefined): Promise<void> {
  if (!credentials) throw new Error(`browser lane: the app asks ${member} to sign in, and the rig has no sign-in for them`);
  await page.locator(SELECTORS.loginEmail).fill(credentials.email);
  await page.locator(SELECTORS.loginPassword).fill(credentials.password);
  const submit = page.locator(SELECTORS.loginSubmit);
  await submit.and(page.locator(":enabled")).waitFor({ timeout: SIGN_IN_TIMEOUT_MS });
  await submit.click();
  try {
    await page.waitForURL((url) => !onLoginPage(url.toString()), { timeout: SIGN_IN_TIMEOUT_MS });
  } catch {
    // The page's own alert says why, and never holds the password.
    const alert = await page.getByRole("alert").first().textContent({ timeout: 1_000 }).catch(() => null);
    throw new Error(`browser lane: ${member} could not sign in${alert ? ` (${alert.trim()})` : ""}`);
  }
}

export type HearOptions = Omit<DetectOptions, "answerOffsetMs" | "own"> & {
  /** The mark the window counts from; defaults to `answered`, which `answer()` sets. */
  answerMark?: string;
  /** Epoch ms of answer, when the far end answered rather than this page. */
  answeredAt?: number;
};

export interface PageHearing {
  detection: Detection;
  capture: Omit<PageCapture, "pcm_b64">;
  /** Seconds of concealment over seconds received, from getStats. */
  concealedRatio?: number;
  /** Audio energy the page heard before answer: ringback or early media. */
  energyBeforeAnswer?: number;
}

export class MemberPage {
  readonly member: string;
  readonly surface: Surface;
  readonly context: BrowserContext;
  readonly page: Page;
  readonly #numbers: NumberBook;
  readonly #origin: string;

  constructor(member: string, surface: Surface, context: BrowserContext, page: Page, numbers: NumberBook, origin: string) {
    this.member = member;
    this.surface = surface;
    this.context = context;
    this.page = page;
    this.#numbers = numbers;
    this.#origin = origin;
  }

  /**
   * Turns on push for this browser from the app's settings, in a second tab
   * so the member's page keeps its place. False when the card never offers it
   * or never says it is on: a Chromium with no push service cannot subscribe.
   */
  async enablePush(): Promise<boolean> {
    const tab = await this.context.newPage();
    try {
      await tab.goto(new URL("/settings/notifications", this.#origin).toString());
      const card = tab.locator("div").filter({ hasText: SELECTORS.pushCard }).filter({ has: tab.getByRole("button") }).last();
      const off = card.getByRole(SELECTORS.pushTurnOff.role, { name: SELECTORS.pushTurnOff.name, exact: true });
      if (await off.isVisible()) return true;
      await card.getByRole(SELECTORS.pushTurnOn.role, { name: SELECTORS.pushTurnOn.name, exact: true }).click({ timeout: PUSH_TIMEOUT_MS });
      await off.waitFor({ timeout: PUSH_TIMEOUT_MS });
      return true;
    } catch {
      return false;
    } finally {
      await tab.close().catch(() => undefined);
    }
  }

  mark(name: string): Promise<void> {
    return this.page.evaluate((n) => (window as unknown as { __rigJudge?: RigJudgeHandle }).__rigJudge?.mark(n), name);
  }

  /** Waits for the ring dialog; resolves with how long it took, or undefined if it never showed. */
  async waitForRing(timeoutMs: number): Promise<number | undefined> {
    const started = Date.now();
    try {
      await this.page.getByRole(SELECTORS.answer.role, { name: SELECTORS.answer.name, exact: true }).waitFor({ timeout: timeoutMs });
      await this.mark("ringing");
      return Date.now() - started;
    } catch {
      return undefined;
    }
  }

  /**
   * Waits until no Answer or Hang up control shows: the ring dialog and the
   * call bar are both gone. Resolves with how long that took, or undefined at
   * the deadline.
   */
  async waitForCallCleared(timeoutMs: number): Promise<number | undefined> {
    const started = Date.now();
    const controls = [SELECTORS.answer, SELECTORS.hangUp].map((control) =>
      this.page.getByRole(control.role, { name: control.name, exact: true }).filter({ visible: true }),
    );
    for (;;) {
      const showing = await Promise.all(controls.map((control) => control.count()));
      if (showing.every((count) => count === 0)) return Date.now() - started;
      if (Date.now() - started >= timeoutMs) return undefined;
      await this.page.waitForTimeout(CLEARED_POLL_MS);
    }
  }

  async answer(): Promise<void> {
    await this.page.getByRole(SELECTORS.answer.role, { name: SELECTORS.answer.name, exact: true }).click();
    await this.mark("answered");
  }

  async hangUp(): Promise<void> {
    await this.page.getByRole(SELECTORS.hangUp.role, { name: SELECTORS.hangUp.name, exact: true }).click();
    await this.mark("hung_up");
  }

  async decline(): Promise<void> {
    await this.page.getByRole(SELECTORS.decline.role, { name: SELECTORS.decline.name, exact: true }).click();
    await this.mark("declined");
  }

  async hold(on: boolean): Promise<void> {
    const control = on ? SELECTORS.putOnHold : SELECTORS.resume;
    await this.page.getByRole(control.role, { name: control.name }).first().click();
    await this.mark(on ? "hold" : "resumed");
  }

  async mute(on: boolean): Promise<void> {
    const control = on ? SELECTORS.mute : SELECTORS.unmute;
    await this.page.getByRole(control.role, { name: control.name, exact: true }).click();
    await this.mark(on ? "muted" : "unmuted");
  }

  async pressKeys(digits: string): Promise<void> {
    if (!/^[0-9*#]+$/.test(digits)) throw new Error("browser lane: keypad digits are 0-9, * and #");
    await this.page.getByRole(SELECTORS.keypad.role, { name: SELECTORS.keypad.name, exact: true }).click();
    for (const digit of digits) await this.page.getByRole("button", { name: digit, exact: true }).last().click();
    await this.mark("keys");
  }

  /**
   * Transfers to a teammate the picker lists by name, or to a number's role.
   * The web call bar has no consult control of its own yet, so a consult
   * that never offers one throws rather than finishing as a blind transfer.
   */
  async transfer(args: { to: string; mode: "blind" | "consult" }): Promise<void> {
    await this.page.getByRole(SELECTORS.transfer.role, { name: SELECTORS.transfer.name, exact: true }).click();
    const target = this.#numbers.number(args.to)?.replace(/^\+1/, "") ?? args.to;
    await this.page.getByRole("button", { name: target }).first().click();
    if (args.mode === "consult") {
      const complete = this.page.getByRole(SELECTORS.completeTransfer.role, { name: SELECTORS.completeTransfer.name, exact: true });
      try {
        await complete.waitFor({ timeout: 10_000 });
      } catch {
        throw new Error("browser lane: the call bar offered no consult transfer");
      }
    }
    await this.mark("transferred");
  }

  async completeTransfer(): Promise<void> {
    await this.page.getByRole(SELECTORS.completeTransfer.role, { name: SELECTORS.completeTransfer.name, exact: true }).click();
    await this.mark("transfer_completed");
  }

  async background(): Promise<void> {
    const tab = await this.context.newPage();
    await tab.goto("about:blank");
    await tab.bringToFront();
  }

  /** What the app's service worker is showing; Chrome's own notification centre cannot be read. */
  async notifications(): Promise<{ title: string; body: string; tag: string }[]> {
    return this.page.evaluate(async () => {
      const registration = await navigator.serviceWorker?.getRegistration();
      const shown = registration ? await registration.getNotifications() : [];
      return shown.map((n) => ({ title: n.title, body: n.body, tag: n.tag }));
    });
  }

  /** Opens the dialer, enters a role's number on its keypad and presses Call. */
  async dial(role: string): Promise<void> {
    const number = this.#numbers.number(role);
    if (!number) throw new Error(`browser lane: no number for ${role}`);
    const dialog = this.page.getByRole(SELECTORS.dialerTitle.role, { name: SELECTORS.dialerTitle.name });
    if (!(await dialog.isVisible())) {
      await this.page.getByRole(SELECTORS.openDialer.role, { name: SELECTORS.openDialer.name, exact: true }).first().click();
    }
    await dialog.waitFor({ timeout: 10_000 });
    for (const digit of number.replace(/^\+1/, "")) {
      await dialog.getByRole("button", { name: digit, exact: true }).click();
    }
    await dialog.getByRole(SELECTORS.call.role, { name: SELECTORS.call.name, exact: true }).click();
    await this.mark("dialed");
  }

  async waitForText(text: string, timeoutMs: number): Promise<boolean> {
    try {
      await this.page.getByText(text, { exact: false }).first().waitFor({ timeout: timeoutMs });
      return true;
    } catch {
      return false;
    }
  }

  /** Everything the page heard so far, judged by the robot's detector. */
  async hear(options: HearOptions = {}): Promise<PageHearing> {
    const capture = await this.page.evaluate(() => {
      const judge = (window as unknown as { __rigJudge?: RigJudgeHandle }).__rigJudge;
      if (!judge) throw new Error("the in-page judge is not installed");
      return judge.take();
    });
    return judgeCapture(capture, this.surface, options);
  }

  async close(): Promise<void> {
    await this.context.close();
  }
}

/** Judges a capture taken from a page; exported so it can be tested without a browser. */
export function judgeCapture(
  capture: PageCapture,
  own: Surface,
  options: HearOptions = {},
): PageHearing {
  const bytes = Buffer.from(capture.pcm_b64, "base64");
  const samples = new Float32Array(bytes.length / 2);
  for (let i = 0; i < samples.length; i++) samples[i] = bytes.readInt16LE(i * 2) / 32768;
  const mark = capture.marks.find((m) => m.name === (options.answerMark ?? "answered"));
  const answered = options.answeredAt !== undefined ? { at: options.answeredAt } : mark;
  const answerOffsetMs = answered && capture.startedAt !== null ? answered.at - capture.startedAt : 0;
  const table = analyzeFrames(samples, capture.sampleRate, SURFACES.map((s) => SURFACE_HZ[s]));
  const { answerMark: _mark, answeredAt: _at, ...detect } = options;
  const detection = detectCodes(table, { ...detect, own, answerOffsetMs });

  const inbound = capture.stats.filter((s) => s.kind === "inbound");
  const last = inbound.at(-1);
  const concealedRatio =
    last?.concealedSamples !== undefined && last.totalSamplesReceived
      ? last.concealedSamples / last.totalSamplesReceived
      : undefined;
  let energyBeforeAnswer: number | undefined;
  if (answered) {
    // From the page's own samples, in getStats' units (sum of squares times seconds).
    // getStats' inbound energy stays 0 while the stream plays through a muted
    // element (Chromium 1.61's build, checked 2026-10-31), so it is evidence only.
    const end = Math.max(0, Math.min(samples.length, Math.round((answerOffsetMs * capture.sampleRate) / 1000)));
    let sum = 0;
    for (let i = 0; i < end; i++) sum += samples[i]! * samples[i]!;
    energyBeforeAnswer = sum / capture.sampleRate;
  }
  const { pcm_b64: _audio, ...rest } = capture;
  return { detection, capture: rest, concealedRatio, energyBeforeAnswer };
}
