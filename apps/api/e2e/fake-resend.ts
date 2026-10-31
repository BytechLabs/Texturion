/**
 * D31 launch-pass harness — fake Resend server.
 *
 * A real node:http server for the one Resend call the Worker makes,
 * `POST /emails` (src/email/resend.ts). The Worker reaches it through
 * `env.RESEND_API_BASE`, the same seam the rig's guard uses, exactly as the
 * Telnyx and Stripe fakes are reached through theirs. So `fetch` is not
 * patched, and a send that skipped the seam would go to the real Resend and
 * fail the run instead of being quietly captured.
 *
 * Every accepted message is kept whole for assertions. A request that is not
 * a well-formed send is refused with Resend's own 422 shape, so a malformed
 * body fails the flow that sent it rather than passing as delivered.
 *
 * Lives under apps/api/e2e/ ONLY; never imported by src/.
 */
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export interface SentEmail {
  to: string[];
  subject: string;
  from: string;
  text: string;
  html: string;
  reply_to: string | null;
  headers: Record<string, string>;
  /** The bearer the Worker sent, so a test can tell it used RESEND_API_KEY. */
  authorization: string | null;
}

export interface FakeResend {
  origin: string;
  /** Every message accepted, oldest first. */
  emails: SentEmail[];
  /** Requests that were not a well-formed `POST /emails`. */
  refused: { method: string; path: string }[];
  reset(): void;
  close(): Promise<void>;
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function parseSend(raw: string): Omit<SentEmail, "authorization"> | null {
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  const to = typeof body.to === "string" ? [body.to] : body.to;
  if (
    !Array.isArray(to) ||
    to.length === 0 ||
    !to.every((address) => typeof address === "string") ||
    typeof body.from !== "string" ||
    typeof body.subject !== "string" ||
    (typeof body.html !== "string" && typeof body.text !== "string")
  ) {
    return null;
  }
  return {
    to: to as string[],
    subject: body.subject,
    from: body.from,
    text: typeof body.text === "string" ? body.text : "",
    html: typeof body.html === "string" ? body.html : "",
    reply_to: typeof body.reply_to === "string" ? body.reply_to : null,
    headers:
      body.headers !== null && typeof body.headers === "object"
        ? (body.headers as Record<string, string>)
        : {},
  };
}

export async function startFakeResend(): Promise<FakeResend> {
  const emails: SentEmail[] = [];
  const refused: { method: string; path: string }[] = [];

  const server: Server = createServer((req, res) => {
    void (async () => {
      const raw = await readBody(req);
      const method = req.method ?? "GET";
      const path = new URL(req.url ?? "/", "http://resend.local").pathname;
      const sent = method === "POST" && path === "/emails" ? parseSend(raw) : null;
      if (sent === null) {
        refused.push({ method, path });
        res.writeHead(422, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            name: "validation_error",
            message: `fake-resend accepts only a well-formed POST /emails, not ${method} ${path}`,
          }),
        );
        return;
      }
      const auth = req.headers.authorization;
      emails.push({ ...sent, authorization: typeof auth === "string" ? auth : null });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: `email_e2e_${emails.length}` }));
    })();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;

  return {
    origin: `http://127.0.0.1:${port}`,
    emails,
    refused,
    reset: () => {
      emails.length = 0;
      refused.length = 0;
    },
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}
