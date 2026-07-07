import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { INVITE_COOKIE_NAME, isValidInviteCookie } from "@/lib/auth/invite";
import { createClient } from "@/lib/supabase/server";

// OAuth (Google) redirect target. Supabase sends the user back here with a
// `code` after Google sign-in; we exchange it for a session cookie, then send
// them on to the workspace. The PKCE verifier lives in a cookie set by the
// browser client, so the server client can complete the exchange.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  // Invite gate, enforced server-side: without a valid invite cookie we never
  // exchange the OAuth code for a session, so the frontend lock can't be
  // bypassed by driving Supabase directly.
  const cookieStore = await cookies();
  if (!isValidInviteCookie(cookieStore.get(INVITE_COOKIE_NAME)?.value)) {
    return NextResponse.redirect(`${origin}/login?error=invite`);
  }

  if (code) {
    const supabase = await createClient();

    if (supabase) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);

      if (!error) {
        return NextResponse.redirect(`${origin}${next}`);
      }
    }
  }

  return NextResponse.redirect(`${origin}/login?error=oauth`);
}
