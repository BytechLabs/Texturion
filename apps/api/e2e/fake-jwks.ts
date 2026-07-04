/**
 * D31 launch-pass harness — fake JWKS server.
 *
 * The Worker verifies user access tokens ES256 against `SUPABASE_JWKS_URL`
 * (src/auth/jwt.ts, via jose `createRemoteJWKSet`). GoTrue is NOT used: we mint
 * a harness ES256 keypair, serve its public JWK from this in-process http
 * server, point `SUPABASE_JWKS_URL` at it, and sign tokens with the private key
 * — exactly the shape of src/test/support.ts createTestAuth()/jwksRoute().
 *
 * Lives under apps/api/e2e/ ONLY; never imported by src/ (no mocks in product
 * code — the hard rule).
 */
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";

import { exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";

export interface JwksAuth {
  /** Origin the JWKS is served from, e.g. `http://127.0.0.1:53111`. */
  origin: string;
  /** The full `.well-known/jwks.json` URL → env.SUPABASE_JWKS_URL. */
  jwksUrl: string;
  privateKey: CryptoKey;
  jwk: JWK;
  /**
   * Mint a Supabase-shaped access token. `sub` is the seeded auth.users id;
   * `issuer` MUST be `<SUPABASE_URL>/auth/v1` (jwt.ts expectedIssuer).
   */
  token(options: {
    sub: string;
    issuer: string;
    expiresIn?: number;
    audience?: string;
  }): Promise<string>;
  close(): Promise<void>;
}

/** Boot the fake JWKS server on an ephemeral port with a fresh ES256 key. */
export async function startFakeJwks(): Promise<JwksAuth> {
  const { publicKey, privateKey } = await generateKeyPair("ES256");
  const kid = "e2e-es256-key";
  const jwk: JWK = {
    ...(await exportJWK(publicKey)),
    kid,
    alg: "ES256",
    use: "sig",
  };

  const server: Server = createServer((req, res) => {
    if (req.url && req.url.startsWith("/auth/v1/.well-known/jwks.json")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ keys: [jwk] }));
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const origin = `http://127.0.0.1:${port}`;

  return {
    origin,
    jwksUrl: `${origin}/auth/v1/.well-known/jwks.json`,
    privateKey,
    jwk,
    async token({ sub, issuer, expiresIn = 3600, audience = "authenticated" }) {
      const now = Math.floor(Date.now() / 1000);
      return new SignJWT({})
        .setProtectedHeader({ alg: "ES256", kid })
        .setIssuer(issuer)
        .setAudience(audience)
        .setSubject(sub)
        .setIssuedAt(now - 60)
        .setExpirationTime(now + expiresIn)
        .sign(privateKey);
    },
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}
