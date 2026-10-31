/**
 * The robot's mailbox: mail the edge's email handler received for the robot's
 * address, stored on the rig for S34 to read. Only mail the rig's own API sent
 * through Resend should arrive, and it is kept a week at most.
 */
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { MailFrame } from "./uplink.ts";

const KEEP_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_RAW_BYTES = 512 * 1024;

export interface StoredMail {
  id: string;
  to: string;
  from: string;
  subject: string;
  raw: string;
  received_at: string;
}

export class Mailbox {
  readonly #dir: string;
  readonly #now: () => number;

  constructor(dir: string, now: () => number = Date.now) {
    this.#dir = dir;
    this.#now = now;
    mkdirSync(dir, { recursive: true });
  }

  store(frame: MailFrame): StoredMail {
    const mail: StoredMail = {
      id: frame.id,
      to: frame.to,
      from: frame.from,
      subject: frame.subject,
      raw: frame.raw.length > MAX_RAW_BYTES ? frame.raw.slice(0, MAX_RAW_BYTES) : frame.raw,
      received_at: new Date(this.#now()).toISOString(),
    };
    writeFileSync(join(this.#dir, `${safeName(frame.id)}.json`), JSON.stringify(mail));
    this.purge();
    return mail;
  }

  list(since?: number): StoredMail[] {
    return readdirSync(this.#dir)
      .filter((name) => name.endsWith(".json"))
      .map((name) => JSON.parse(readFileSync(join(this.#dir, name), "utf8")) as StoredMail)
      .filter((mail) => since === undefined || Date.parse(mail.received_at) >= since)
      .sort((a, b) => a.received_at.localeCompare(b.received_at));
  }

  purge(): void {
    for (const name of readdirSync(this.#dir)) {
      const path = join(this.#dir, name);
      if (this.#now() - statSync(path).mtimeMs > KEEP_MS) rmSync(path, { force: true });
    }
  }
}

function safeName(id: string): string {
  return id.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 120);
}
