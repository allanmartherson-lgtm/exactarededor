// Shared helpers for signing and verifying magic-link JWTs (HS256).
// The token is short and opaque; the canonical record lives in `magic_link_tokens`.

import { create, verify, getNumericDate } from "https://deno.land/x/djwt@v3.0.2/mod.ts";

const ENC = new TextEncoder();

async function getKey(): Promise<CryptoKey> {
  const secret = Deno.env.get("MAGIC_LINK_SECRET");
  if (!secret) throw new Error("MAGIC_LINK_SECRET is not configured");
  return await crypto.subtle.importKey(
    "raw",
    ENC.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export interface MagicLinkPayload {
  jti: string;                // token id (matches magic_link_tokens.id)
  sub: string;                // issued_to_user_id
  act: string;                // action (approve|reject|return_to_analyst|return_to_validator|view)
  pid?: string;               // payment_id
  cgid?: string;              // company_group_id
}

export async function signMagicLink(
  payload: MagicLinkPayload,
  ttlSeconds = 60 * 60 * 72, // 72h default
): Promise<string> {
  const key = await getKey();
  return await create(
    { alg: "HS256", typ: "JWT" },
    {
      ...payload,
      iat: getNumericDate(0),
      exp: getNumericDate(ttlSeconds),
    },
    key,
  );
}

export async function verifyMagicLink(token: string): Promise<MagicLinkPayload & { exp: number; iat: number }> {
  const key = await getKey();
  const payload = await verify(token, key);
  return payload as MagicLinkPayload & { exp: number; iat: number };
}

export async function sha256Hex(input: string): Promise<string> {
  const data = ENC.encode(input);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
