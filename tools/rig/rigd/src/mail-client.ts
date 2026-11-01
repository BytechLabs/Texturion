/**
 * Mail as S34 and S35 read it: the robot mailbox the edge stores mail into
 * (mail.ts, under `state/rigd/mail`) and Supabase Auth's local Mailpit.
 *
 * Bodies are decoded just far enough to find links: quoted-printable soft
 * breaks and escapes, then every http(s) URL. Following a link is one GET
 * with redirects left unfollowed, so the answer says where it sends you.
 */
import type { StoredMail } from "./mail.ts";
import type { MailApi, MailMessage } from "./scenarios/context.ts";

export interface MailClientOptions {
  /** The robot mailbox's address, from the rig's private config; never in git. */
  robotMailbox?: string;
  storedMail: (since: number) => StoredMail[];
  /** Mailpit's HTTP API, e.g. http://127.0.0.1:54324. */
  mailpitUrl: string;
  fetch?: typeof fetch;
}

/** Quoted-printable decoded, the way the mail's text parts are usually sent. */
export function decodeQuotedPrintable(text: string): string {
  return text.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

export function linksIn(text: string): string[] {
  const found = decodeQuotedPrintable(text).match(/https?:\/\/[^\s"'<>)\]]+/g) ?? [];
  return [...new Set(found.map((link) => link.replace(/&amp;/g, "&").replace(/[.,;]+$/, "")))];
}

/** The body of a raw message: everything after the header block. */
export function bodyOf(raw: string): string {
  const split = raw.search(/\r?\n\r?\n/);
  return split === -1 ? "" : raw.slice(split).trim();
}

export class MailClient implements MailApi {
  readonly #o: MailClientOptions;
  readonly #fetch: typeof fetch;

  constructor(options: MailClientOptions) {
    this.#o = options;
    this.#fetch = options.fetch ?? fetch;
  }

  robotAddress(tag: string): string | undefined {
    const mailbox = this.#o.robotMailbox;
    if (!mailbox || !/^[a-z0-9._-]+$/.test(tag)) return undefined;
    const [local, domain] = mailbox.split("@");
    return local && domain ? `${local}+${tag}@${domain}` : undefined;
  }

  async robotMail(args: { since: number; tag?: string }): Promise<MailMessage[]> {
    const wanted = args.tag ? this.robotAddress(args.tag)?.toLowerCase() : undefined;
    return this.#o
      .storedMail(args.since)
      .filter((mail) => !wanted || mail.to.toLowerCase() === wanted)
      .map((mail) => {
        const text = decodeQuotedPrintable(bodyOf(mail.raw));
        return { id: mail.id, to: mail.to, from: mail.from, subject: mail.subject, text, links: linksIn(text), received_at: mail.received_at };
      });
  }

  async mailpit(args: { to: string; since: number }): Promise<MailMessage[]> {
    const base = this.#o.mailpitUrl.replace(/\/+$/, "");
    const listed = await this.#get<{ messages?: MailpitSummary[] }>(`${base}/api/v1/search?query=${encodeURIComponent(`to:"${args.to}"`)}`);
    const recent = (listed.messages ?? []).filter((message) => Date.parse(message.Created) >= args.since);
    const out: MailMessage[] = [];
    for (const summary of recent) {
      const full = await this.#get<{ Text?: string; HTML?: string }>(`${base}/api/v1/message/${encodeURIComponent(summary.ID)}`);
      const text = full.Text ?? full.HTML ?? "";
      out.push({
        id: summary.ID,
        to: summary.To?.[0]?.Address ?? args.to,
        from: summary.From?.Address ?? "",
        subject: summary.Subject ?? "",
        text,
        links: linksIn(`${text}\n${full.HTML ?? ""}`),
        received_at: summary.Created,
      });
    }
    return out.sort((a, b) => a.received_at.localeCompare(b.received_at));
  }

  async openLink(url: string): Promise<{ status: number; location: string | null }> {
    if (!/^https?:\/\//.test(url)) throw new Error("mail: only http(s) links are followed");
    const response = await this.#fetch(url, { redirect: "manual", signal: AbortSignal.timeout(15_000) });
    await response.body?.cancel();
    return { status: response.status, location: response.headers.get("location") };
  }

  async #get<T>(url: string): Promise<T> {
    const response = await this.#fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`mail: Mailpit answered ${response.status}`);
    return (await response.json()) as T;
  }
}

interface MailpitSummary {
  ID: string;
  Created: string;
  Subject?: string;
  From?: { Address?: string };
  To?: { Address?: string }[];
}
