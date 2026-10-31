/**
 * The Playwright browser lane: one Chromium profile per member, each with its
 * own code on the fake microphone and the in-page judge installed.
 *
 * A profile signs its member in on the app's own login page the first time
 * the app sends it there, and keeps the session for later runs. The UI steps
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
import { chromiumArgs } from "./args.ts";
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
} as const;

export const LOGIN_PATH = "/login";
const SIGN_IN_TIMEOUT_MS = 30_000;
const PUSH_TIMEOUT_MS = 15_000;

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
  headless?: boolean;
  browserType?: BrowserType;
  executablePath?: string;
}

export class BrowserLane {
  readonly #o: BrowserLaneOptions;
  readonly #open = new Map<string, MemberPage>();

  constructor(options: BrowserLaneOptions) {
    this.#o = options;
  }

  /** The member's page, launched once and reused for the run. */
  async open(member: string, surface: Surface, path = "/"): Promise<MemberPage> {
    const existing = this.#open.get(member);
    if (existing) return existing;
    if (!/^[a-z0-9-]+$/.test(member)) throw new Error(`browser lane: "${member}" is not a member key`);
    const profile = join(this.#o.profilesDir, member);
    mkdirSync(profile, { recursive: true });
    const context = await (this.#o.browserType ?? chromium).launchPersistentContext(profile, {
      headless: this.#o.headless ?? true,
      executablePath: this.#o.executablePath,
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
    this.#open.set(member, opened);
    return opened;
  }

  async closeAll(): Promise<void> {
    await Promise.allSettled([...this.#open.values()].map((page) => page.close()));
    this.#open.clear();
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

  async answer(): Promise<void> {
    await this.page.getByRole(SELECTORS.answer.role, { name: SELECTORS.answer.name, exact: true }).click();
    await this.mark("answered");
  }

  async hangUp(): Promise<void> {
    await this.page.getByRole(SELECTORS.hangUp.role, { name: SELECTORS.hangUp.name, exact: true }).click();
    await this.mark("hung_up");
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
