/**
 * The Playwright browser lane: one Chromium profile per member, each with its
 * own code on the fake microphone and the in-page judge installed.
 *
 * The UI steps find controls by role and English name, the way a member does
 * ("Answer", "Hang up", "Call"). The web app has no test-id contract for calls
 * yet; `SELECTORS` is the one place to change when it lands.
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
} as const;

export interface BrowserLaneOptions {
  /** e.g. https://app.rig.internal */
  appOrigin: string;
  profilesDir: string;
  /** Where writeFakeMicWavs put the surface WAVs. */
  fakeMicDir: string;
  numbers: NumberBook;
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
    await page.goto(new URL(path, this.#o.appOrigin).toString());
    const opened = new MemberPage(member, surface, context, page, this.#o.numbers);
    this.#open.set(member, opened);
    return opened;
  }

  async closeAll(): Promise<void> {
    await Promise.allSettled([...this.#open.values()].map((page) => page.close()));
    this.#open.clear();
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

  constructor(member: string, surface: Surface, context: BrowserContext, page: Page, numbers: NumberBook) {
    this.member = member;
    this.surface = surface;
    this.context = context;
    this.page = page;
    this.#numbers = numbers;
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
