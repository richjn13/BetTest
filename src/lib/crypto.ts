import { createHmac, randomBytes, randomInt, scryptSync, timingSafeEqual } from "node:crypto";

const SCRYPT_KEYLEN = 32;

/** PINs are short, so hash them with scrypt and a per-user salt. */
export function hashPin(pin: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(pin.normalize("NFKC"), salt, SCRYPT_KEYLEN);
  return `scrypt$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

export function verifyPin(pin: string, stored: string): boolean {
  const [scheme, saltPart, hashPart] = stored.split("$");
  if (scheme !== "scrypt" || !saltPart || !hashPart) return false;
  const expected = Buffer.from(hashPart, "base64url");
  const actual = scryptSync(
    pin.normalize("NFKC"),
    Buffer.from(saltPart, "base64url"),
    expected.length,
  );
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** Constant-time comparison, so a wrong key cannot be found byte by byte. */
export function timingSafeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function verifySignature(payload: string, signature: string, secret: string): boolean {
  const expected = Buffer.from(sign(payload, secret));
  const actual = Buffer.from(signature);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

// Ambiguous characters (0/O, 1/I) are left out: join codes get read aloud.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateJoinCode(length = 6): string {
  let code = "";
  for (let i = 0; i < length; i += 1) {
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return code;
}
