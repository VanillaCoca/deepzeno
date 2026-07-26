import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BYOKCryptoError,
  byokAad,
  decryptSecret,
  encryptSecret,
  keyHint,
  resolveByokSecret,
  secretsMatch,
} from "@/lib/billing/crypto";

const SECRET = "0123456789abcdef0123456789abcdef";
const OTHER_SECRET = "fedcba9876543210fedcba9876543210";
const AAD = byokAad("11111111-1111-1111-1111-111111111111", "anthropic");
const PLAINTEXT = "sk-ant-api03-not-a-real-key-abcd";

describe("encryptSecret / decryptSecret", () => {
  it("round-trips under the same secret and aad", () => {
    const payload = encryptSecret({ plaintext: PLAINTEXT, aad: AAD, secret: SECRET });
    assert.equal(decryptSecret({ payload, aad: AAD, secret: SECRET }), PLAINTEXT);
  });

  it("never emits the plaintext in the stored string", () => {
    // The obvious catastrophe: a "ciphertext" that a grep of the database
    // still matches. Cheap to assert, and it would catch an accidental
    // passthrough refactor instantly.
    const payload = encryptSecret({ plaintext: PLAINTEXT, aad: AAD, secret: SECRET });
    assert.ok(!payload.includes(PLAINTEXT));
    assert.ok(payload.startsWith("v1."));
  });

  it("produces a different ciphertext every time", () => {
    // A deterministic envelope would let anyone with read access tell that two
    // users pasted the same key, which is a real leak on shared team keys.
    const a = encryptSecret({ plaintext: PLAINTEXT, aad: AAD, secret: SECRET });
    const b = encryptSecret({ plaintext: PLAINTEXT, aad: AAD, secret: SECRET });
    assert.notEqual(a, b);
  });

  it("refuses the wrong secret", () => {
    const payload = encryptSecret({ plaintext: PLAINTEXT, aad: AAD, secret: SECRET });
    assert.throws(
      () => decryptSecret({ payload, aad: AAD, secret: OTHER_SECRET }),
      BYOKCryptoError
    );
  });

  it("refuses a ciphertext lifted into another user's row", () => {
    // The attack the AAD exists for: an attacker with write access copies a
    // victim's ciphertext under their own user_id and spends the victim's
    // credits without ever reading the key. The tag has to fail here.
    const payload = encryptSecret({ plaintext: PLAINTEXT, aad: AAD, secret: SECRET });
    const stolen = byokAad("22222222-2222-2222-2222-222222222222", "anthropic");
    assert.throws(
      () => decryptSecret({ payload, aad: stolen, secret: SECRET }),
      BYOKCryptoError
    );
  });

  it("refuses a ciphertext re-pointed at a different provider", () => {
    const payload = encryptSecret({ plaintext: PLAINTEXT, aad: AAD, secret: SECRET });
    const moved = byokAad("11111111-1111-1111-1111-111111111111", "openai");
    assert.throws(
      () => decryptSecret({ payload, aad: moved, secret: SECRET }),
      BYOKCryptoError
    );
  });

  it("refuses a tampered body", () => {
    const payload = encryptSecret({ plaintext: PLAINTEXT, aad: AAD, secret: SECRET });
    const raw = Buffer.from(payload.slice(3), "base64");
    raw[raw.length - 1] ^= 0xff;
    assert.throws(
      () =>
        decryptSecret({
          payload: `v1.${raw.toString("base64")}`,
          aad: AAD,
          secret: SECRET,
        }),
      BYOKCryptoError
    );
  });

  it("rejects an unknown or missing version rather than guessing", () => {
    assert.throws(
      () => decryptSecret({ payload: "v2.abcd", aad: AAD, secret: SECRET }),
      BYOKCryptoError
    );
    assert.throws(
      () => decryptSecret({ payload: "notversioned", aad: AAD, secret: SECRET }),
      BYOKCryptoError
    );
  });

  it("rejects a truncated payload without throwing something unreadable", () => {
    assert.throws(
      () => decryptSecret({ payload: "v1.AAAA", aad: AAD, secret: SECRET }),
      BYOKCryptoError
    );
  });

  it("refuses to encrypt under a short secret", () => {
    // Failing loudly here is the whole defense against ZENO_BYOK_SECRET being
    // set to whatever made the deploy go green.
    assert.throws(
      () => encryptSecret({ plaintext: PLAINTEXT, aad: AAD, secret: "changeme" }),
      BYOKCryptoError
    );
  });
});

describe("resolveByokSecret", () => {
  it("returns null rather than a weak secret", () => {
    assert.equal(resolveByokSecret({}), null);
    assert.equal(resolveByokSecret({ ZENO_BYOK_SECRET: "short" }), null);
    assert.equal(resolveByokSecret({ ZENO_BYOK_SECRET: SECRET }), SECRET);
  });
});

describe("keyHint", () => {
  it("takes the suffix, not the prefix", () => {
    // Prefixes carry account/org identifiers in several providers' formats.
    assert.equal(keyHint("sk-ant-api03-xyzw1234"), "1234");
    assert.equal(keyHint("  sk-proj-abcdefgh  "), "efgh");
  });

  it("does not pad or crash on a stub value", () => {
    assert.equal(keyHint("ab"), "ab");
    assert.equal(keyHint(""), "");
  });
});

describe("secretsMatch", () => {
  it("compares by value and rejects length mismatch", () => {
    assert.equal(secretsMatch("abc", "abc"), true);
    assert.equal(secretsMatch("abc", "abd"), false);
    assert.equal(secretsMatch("abc", "abcd"), false);
  });
});
