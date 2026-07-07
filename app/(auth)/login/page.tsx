import { cookies } from "next/headers";
import { Suspense } from "react";
import { LoginForm } from "@/components/auth/login-form";
import { INVITE_COOKIE_NAME, isValidInviteCookie } from "@/lib/auth/invite";

export default async function Page() {
  // Read the invite cookie server-side so a returning, already-verified visitor
  // doesn't have to re-enter the code. When the gate is disabled (no
  // INVITE_CODES), isValidInviteCookie returns true and the form opens unlocked.
  const cookieStore = await cookies();
  const initiallyUnlocked = isValidInviteCookie(
    cookieStore.get(INVITE_COOKIE_NAME)?.value
  );

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Welcome to ZENO</h1>
      <Suspense
        fallback={
          <div className="h-[260px] rounded-2xl border border-border/50 bg-muted/30" />
        }
      >
        <LoginForm initiallyUnlocked={initiallyUnlocked} />
      </Suspense>
    </>
  );
}
