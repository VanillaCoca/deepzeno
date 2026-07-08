import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

// Invite-code gate. A single shared code (or a small comma-separated set) lives
// in INVITE_CODES. Verification happens server-side; on success we set an
// httpOnly cookie whose value is an HMAC the client cannot forge. The gate is
// then enforced at the points where a session is actually created (the OAuth
// callback and the server-side OTP send), so it can't be bypassed from the
// frontend.

export const INVITE_COOKIE_NAME = "zeno_invite";
export const INVITE_COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

const COOKIE_MESSAGE = "zeno-invite:v1";

function getConfiguredCodes(): string[] {
  return (process.env.INVITE_CODES ?? "")
    .split(",")
    .map((code) => code.trim().toLowerCase())
    .filter(Boolean);
}

// The gate is OFF when no codes are configured. This keeps local development and
// a deliberate "turn the gate off" both a zero-code, env-only change. Production
// must set INVITE_CODES.
export function isInviteGateEnabled(): boolean {
  return getConfiguredCodes().length > 0;
}

function getSecret(): string {
  return (
    process.env.INVITE_SECRET ??
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    "zeno-dev-invite-secret"
  );
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  // timingSafeEqual throws on length mismatch; a differing length is already a
  // non-match, so short-circuit (the leaked bit is only the length).
  if (bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

// True when the gate is disabled, or when the submitted code matches a
// configured one (trimmed, case-insensitive, constant-time compare).
export function isValidCode(rawCode: string): boolean {
  const codes = getConfiguredCodes();
  if (codes.length === 0) {
    return true;
  }
  const candidate = rawCode.trim().toLowerCase();
  if (!candidate) {
    return false;
  }
  return codes.some((code) => safeEqual(code, candidate));
}

// The opaque, unforgeable value we store in the invite cookie once a valid code
// has been presented. Constant per deployment; httpOnly keeps it out of JS.
export function inviteCookieValue(): string {
  return createHmac("sha256", getSecret())
    .update(COOKIE_MESSAGE)
    .digest("base64url");
}

// True when the gate is disabled, or when the cookie carries the expected HMAC.
export function isValidInviteCookie(value: string | undefined | null): boolean {
  if (!isInviteGateEnabled()) {
    return true;
  }
  if (!value) {
    return false;
  }
  return safeEqual(value, inviteCookieValue());
}
