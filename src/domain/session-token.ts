export const SESSION_COOKIE = "jirani_session";

export type SessionClaims = {
  profileId: string;
  exp: number;
};

export async function sealSession(claims: SessionClaims, secret: string): Promise<string> {
  const payload = encodeJson(claims);
  const signature = await sign(secret, payload);
  return `${payload}.${bytesToBase64Url(signature)}`;
}

export async function openSession(token: string, secret: string, nowSeconds = Math.floor(Date.now() / 1000)): Promise<SessionClaims | null> {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payload, signature] = parts;
  if (!payload || !signature) return null;
  const expected = await sign(secret, payload);
  const received = base64UrlToBytes(signature);
  if (!received || !equalBytes(expected, received)) return null;
  const claims = decodeJson(payload);
  if (!claims) return null;
  if (!Number.isInteger(claims.exp) || claims.exp <= nowSeconds) return null;
  if (!/^[0-9a-f-]{36}$/i.test(claims.profileId)) return null;
  return claims;
}

async function sign(secret: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return new Uint8Array(signature);
}

function encodeJson(claims: SessionClaims): string {
  return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(claims)));
}

function decodeJson(payload: string): SessionClaims | null {
  const bytes = base64UrlToBytes(payload);
  if (!bytes) return null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as Partial<SessionClaims>;
    if (typeof parsed.profileId !== "string" || typeof parsed.exp !== "number") return null;
    return { profileId: parsed.profileId, exp: parsed.exp };
  } catch {
    return null;
  }
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function base64UrlToBytes(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - (value.length % 4)) % 4);
  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return null;
  }
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index]! ^ right[index]!;
  return difference === 0;
}
