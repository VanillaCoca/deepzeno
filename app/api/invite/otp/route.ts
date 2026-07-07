import { cookies } from "next/headers";
import { INVITE_COOKIE_NAME, isValidInviteCookie } from "@/lib/auth/invite";
import { createClient } from "@/lib/supabase/server";

// Send an email one-time code — but only behind the invite gate. Moving the OTP
// send server-side (instead of calling supabase from the browser) is what makes
// the gate real for the email path: without a valid invite cookie, no code is
// ever sent. The code is still verified client-side, since it can't be obtained
// without first passing this route.
export async function POST(request: Request) {
  const cookieStore = await cookies();
  const inviteCookie = cookieStore.get(INVITE_COOKIE_NAME)?.value;

  if (!isValidInviteCookie(inviteCookie)) {
    return Response.json(
      { ok: false, error: "invite_required" },
      { status: 403 }
    );
  }

  let email = "";

  try {
    const body = (await request.json()) as { email?: unknown };
    email = typeof body.email === "string" ? body.email.trim() : "";
  } catch {
    return Response.json({ ok: false }, { status: 400 });
  }

  if (!email) {
    return Response.json({ ok: false }, { status: 400 });
  }

  const supabase = await createClient();

  if (!supabase) {
    return Response.json(
      { ok: false, error: "not_configured" },
      { status: 503 }
    );
  }

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true },
  });

  if (error) {
    return Response.json({ ok: false, error: error.message }, { status: 400 });
  }

  return Response.json({ ok: true });
}
