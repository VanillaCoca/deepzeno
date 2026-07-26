// Envelope for user-supplied provider keys.
//
// Why encrypt at all, given that Supabase already encrypts its disks: disk
// encryption defends against someone carrying the disk away. It does nothing
// against the failure modes this product actually has — a leaked service-role
// key, a mis-scoped PostgREST call, a `select *` in a log line, a database
// dump handed to a contractor. Application-level encryption means the row is
// useless without ZENO_BYOK_SECRET, which lives only in the deployment
// environment and never in the database.
//
// No `server-only` import: node:test needs to run this, and there is nothing
// here that is unsafe to *load* in a browser bundle — the secret is what must
// never cross, and the secret comes from the caller.

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12; // GCM's native nonce size; anything else costs a rehash.
const TAG_BYTES = 16;
const VERSION = "v1";

/**
 * Refuse to encrypt under a guessable secret.
 *
 * 32 characters is not a security proof — it is a tripwire. The realistic
 * failure is not a brute-forced 256-bit key, it is someone setting
 * ZENO_BYOK_SECRET=changeme to get the deploy green and never revisiting it.
 * Failing loudly at that moment is the only time anyone will notice.
 */
const MIN_SECRET_LENGTH = 32;

export class BYOKCryptoError extends Error {}

/**
 * Any secret string → exactly 32 bytes, via SHA-256.
 *
 * Hashing rather than requiring a specific encoding means the operator can
 * paste whatever `openssl rand -hex 32` or a password manager gives them and
 * it works. The cost is that two different secrets can never collide in
 * practice, which is the property we needed anyway.
 */
function deriveKey(secret: string): Buffer {
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new BYOKCryptoError(
      `ZENO_BYOK_SECRET must be at least ${MIN_SECRET_LENGTH} characters.`
    );
  }
  return createHash("sha256").update(secret, "utf8").digest();
}

export function resolveByokSecret(
  env: Record<string, string | undefined> = process.env
): string | null {
  const secret = env.ZENO_BYOK_SECRET;
  return secret && secret.length >= MIN_SECRET_LENGTH ? secret : null;
}

/**
 * `aad` binds the ciphertext to the row that holds it.
 *
 * Without it, anyone who can write to `provider_keys` can copy another user's
 * ciphertext into their own row and spend that user's credits — they never
 * need to read the key to use it. With it, the tag fails and the copy is
 * inert. This is the one attack the encryption would otherwise not cover, and
 * it costs a string concatenation.
 */
export function byokAad(userId: string, provider: string): string {
  return `${userId}:${provider}`;
}

/** Returns `v1.<base64 iv||tag||ciphertext>`. */
export function encryptSecret({
  plaintext,
  aad,
  secret,
}: {
  plaintext: string;
  aad: string;
  secret: string;
}): string {
  const key = deriveKey(secret);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const body = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `${VERSION}.${Buffer.concat([iv, tag, body]).toString("base64")}`;
}

export function decryptSecret({
  payload,
  aad,
  secret,
}: {
  payload: string;
  aad: string;
  secret: string;
}): string {
  const separator = payload.indexOf(".");
  const version = separator === -1 ? "" : payload.slice(0, separator);
  if (version !== VERSION) {
    // Versioned from day one so a future key rotation can re-wrap old rows
    // instead of forcing every user to paste their key again.
    throw new BYOKCryptoError(`Unsupported ciphertext version: ${version}`);
  }

  const raw = Buffer.from(payload.slice(separator + 1), "base64");
  if (raw.length <= IV_BYTES + TAG_BYTES) {
    throw new BYOKCryptoError("Ciphertext is truncated.");
  }

  const key = deriveKey(secret);
  const decipher = createDecipheriv(ALGORITHM, key, raw.subarray(0, IV_BYTES));
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));

  try {
    return Buffer.concat([
      decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    // Wrong secret, tampered row, or a ciphertext lifted from another user.
    // All three are the same answer to the caller: this key is unusable.
    throw new BYOKCryptoError("Failed to decrypt provider key.");
  }
}

/**
 * The last four characters, for the settings UI.
 *
 * Not a prefix: several providers embed an account or org identifier in the
 * leading characters (`sk-ant-api03-…`, `sk-proj-…`), so a prefix leaks more
 * about the account than it does about which key this is. The suffix is the
 * part that is random in every format.
 */
export function keyHint(plaintext: string): string {
  const trimmed = plaintext.trim();
  return trimmed.length <= 4 ? trimmed : trimmed.slice(-4);
}

/**
 * Constant-time compare, for verifying a pasted key against a stored one
 * without leaking the answer through response timing.
 */
export function secretsMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}
