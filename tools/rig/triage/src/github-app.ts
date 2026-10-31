/**
 * The rig's GitHub App (`loonext-rig`, made in founder action FA9). Its private key,
 * RIG_APP_KEY, never leaves the rig. Each use mints a fresh installation token
 * scoped to the one repository and to issues only; tokens last an hour and
 * are never stored or reused.
 */
import { createSign } from "node:crypto";

export const GITHUB_API = "https://api.github.com";

export interface AppCredentials {
  appId: string;
  /** PEM, PKCS#1 or PKCS#8. */
  privateKey: string;
  /** owner/name */
  repo: string;
}

export function appJwt(appId: string, privateKey: string, nowMs: number): string {
  if (!/^\d+$/.test(appId)) throw new Error("github app: the App id is numeric");
  const now = Math.floor(nowMs / 1000);
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  // Backdated a minute for clock drift; GitHub refuses a life over ten minutes.
  const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({ iat: now - 60, exp: now + 540, iss: appId })}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(privateKey).toString("base64url");
  return `${unsigned}.${signature}`;
}

export function githubHeaders(token: string): Record<string, string> {
  return {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${token}`,
    "x-github-api-version": "2022-11-28",
    "user-agent": "loonext-rigd",
  };
}

/** A token for this one call sequence: issues on the one repository, nothing else. */
export async function installationToken(
  credentials: AppCredentials,
  options: { fetch?: typeof fetch; now?: number; permissions?: Record<string, "read" | "write"> } = {},
): Promise<string> {
  const doFetch = options.fetch ?? fetch;
  const [owner, name] = splitRepo(credentials.repo);
  const jwt = appJwt(credentials.appId, credentials.privateKey, options.now ?? Date.now());
  const installation = await doFetch(`${GITHUB_API}/repos/${owner}/${name}/installation`, { headers: githubHeaders(jwt) });
  if (!installation.ok) throw new Error(`github app: installation lookup returned ${installation.status}`);
  const { id } = (await installation.json()) as { id?: number };
  if (typeof id !== "number") throw new Error("github app: no installation id");
  const minted = await doFetch(`${GITHUB_API}/app/installations/${id}/access_tokens`, {
    method: "POST",
    headers: { ...githubHeaders(jwt), "content-type": "application/json" },
    body: JSON.stringify({ repositories: [name], permissions: options.permissions ?? { issues: "write" } }),
  });
  if (!minted.ok) throw new Error(`github app: minting a token returned ${minted.status}`);
  const { token } = (await minted.json()) as { token?: string };
  if (!token) throw new Error("github app: no token in the response");
  return token;
}

export function splitRepo(repo: string): [string, string] {
  const match = /^([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)$/.exec(repo);
  if (!match) throw new Error("github app: the repository is owner/name");
  return [match[1]!, match[2]!];
}
