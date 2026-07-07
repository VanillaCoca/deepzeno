import { cookies } from "next/headers";
import {
  INVITE_COOKIE_MAX_AGE,
  INVITE_COOKIE_NAME,
  inviteCookieValue,
  isValidCode,
} from "@/lib/auth/invite";
import { isProductionEnvironment } from "@/lib/constants";

// Verify an invite code server-side. On success, set the httpOnly cookie that
// unlocks the login options (and is enforced again at the OAuth callback and
// OTP send). Returns 401 for a wrong code so it can't be brute-guessed silently.
export async function POST(request: Request) {
  let code = "";

  try {
    const body = (await request.json()) as { code?: unknown };
    code = typeof body.code === "string" ? body.code : "";
  } catch {
    return Response.json({ ok: false }, { status: 400 });
  }

  if (!isValidCode(code)) {
    return Response.json({ ok: false }, { status: 401 });
  }

  const cookieStore = await cookies();
  cookieStore.set(INVITE_COOKIE_NAME, inviteCookieValue(), {
    httpOnly: true,
    secure: isProductionEnvironment,
    sameSite: "lax",
    path: "/",
    maxAge: INVITE_COOKIE_MAX_AGE,
  });

  return Response.json({ ok: true });
}
