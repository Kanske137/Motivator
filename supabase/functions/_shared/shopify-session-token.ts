// Verifies a Shopify App Bridge **session token** (a short-lived JWT that the
// embedded admin mints via `getSessionToken()`), server-side, using the app's
// client secret. This is the trust anchor for tenant-scoped admin writes: the
// browser never touches the DB directly — it sends this token, we verify it
// here, derive the shop, and only then write with service_role.
//
// Shopify session-token spec:
//   https://shopify.dev/docs/apps/build/authentication-authorization/session-tokens
//   - Signed HS256 with the app's client secret.
//   - `aud` = the app's client id (API key).
//   - `dest` = https://{shop}.myshopify.com  (the shop the request is for).
//   - `iss`  = https://{shop}.myshopify.com/admin  (same host as `dest`).
//   - `exp` / `nbf` bound a ~1 minute validity window.
//
// We NEVER trust a shop passed in the request body — the shop is derived from
// the cryptographically-verified `dest` claim only.

export interface SessionTokenPayload {
  iss: string;
  dest: string;
  aud: string;
  sub: string;
  exp: number;
  nbf: number;
  iat: number;
  jti?: string;
  sid?: string;
}

export interface VerifiedSession {
  /** Verified shop domain, e.g. "acme.myshopify.com". Derived from `dest`. */
  shop: string;
  payload: SessionTokenPayload;
}

export class SessionTokenError extends Error {
  code:
    | "missing_token"
    | "malformed"
    | "bad_alg"
    | "bad_signature"
    | "expired"
    | "not_yet_valid"
    | "wrong_audience"
    | "bad_dest"
    | "config";
  constructor(code: SessionTokenError["code"], message: string) {
    super(message);
    this.name = "SessionTokenError";
    this.code = code;
  }
}

// Allow a small clock skew between Shopify and the edge runtime.
const LEEWAY_SECONDS = 10;

function base64UrlToBytes(part: string): Uint8Array {
  const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function decodeJson<T>(part: string): T {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(part))) as T;
}

function hostOf(u: string): string | null {
  try {
    return new URL(u).host.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Verify a Shopify session token. Throws {@link SessionTokenError} on any
 * failure; returns the verified shop + payload on success.
 */
export async function verifyShopifySessionToken(
  token: string | null | undefined,
  clientId: string,
  clientSecret: string,
): Promise<VerifiedSession> {
  if (!clientId || !clientSecret) {
    throw new SessionTokenError(
      "config",
      "SHOPIFY_APP_CLIENT_ID / SHOPIFY_APP_CLIENT_SECRET saknas i miljön.",
    );
  }
  if (!token) {
    throw new SessionTokenError("missing_token", "Ingen Shopify-session-token angavs.");
  }

  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new SessionTokenError("malformed", "Session-token är inte en giltig JWT (förväntade 3 delar).");
  }
  const [headerB64, payloadB64, signatureB64] = parts;

  let header: { alg?: string; typ?: string };
  try {
    header = decodeJson(headerB64);
  } catch {
    throw new SessionTokenError("malformed", "Kunde inte avkoda JWT-header.");
  }
  if (header.alg !== "HS256") {
    throw new SessionTokenError("bad_alg", `Oväntad JWT-alg: ${header.alg}. Endast HS256 accepteras.`);
  }

  // Verify the HMAC signature over `${header}.${payload}` with the app secret.
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(clientSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const signingInput = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const signatureBytes = base64UrlToBytes(signatureB64);
  const valid = await crypto.subtle.verify("HMAC", key, signatureBytes, signingInput);
  if (!valid) {
    throw new SessionTokenError("bad_signature", "Session-tokenens signatur är ogiltig.");
  }

  let payload: SessionTokenPayload;
  try {
    payload = decodeJson<SessionTokenPayload>(payloadB64);
  } catch {
    throw new SessionTokenError("malformed", "Kunde inte avkoda JWT-payload.");
  }

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === "number" && payload.exp < now - LEEWAY_SECONDS) {
    throw new SessionTokenError("expired", "Session-token har gått ut.");
  }
  if (typeof payload.nbf === "number" && payload.nbf > now + LEEWAY_SECONDS) {
    throw new SessionTokenError("not_yet_valid", "Session-token är inte giltig ännu (nbf).");
  }

  // `aud` must be OUR app — otherwise a token minted for another app installed
  // on the same shop could be replayed against us.
  if (payload.aud !== clientId) {
    throw new SessionTokenError("wrong_audience", "Session-tokenens aud matchar inte appens client id.");
  }

  // `iss` and `dest` must share the same host, and it must be a myshopify domain.
  const destHost = payload.dest ? hostOf(payload.dest) : null;
  const issHost = payload.iss ? hostOf(payload.iss) : null;
  if (!destHost || !issHost || destHost !== issHost) {
    throw new SessionTokenError("bad_dest", "Session-tokenens iss/dest är inkonsekventa.");
  }
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(destHost)) {
    throw new SessionTokenError("bad_dest", `Ogiltig shop-domän i dest: ${destHost}.`);
  }

  return { shop: destHost, payload };
}
