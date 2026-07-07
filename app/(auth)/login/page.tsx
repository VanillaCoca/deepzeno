import { cookies } from "next/headers";
import { Suspense } from "react";
import { LoginForm } from "@/components/auth/login-form";
import { INVITE_COOKIE_NAME, isValidInviteCookie } from "@/lib/auth/invite";

// Reads the invite cookie (runtime data) so a returning, already-verified visitor
// doesn't re-enter the code. Isolated in its own component so the cookies() access
// stays INSIDE the Suspense boundary — otherwise it blocks the static shell from
// prerendering (Next 16 Cache Components "blocking route"). When the gate is
// disabled (no INVITE_CODES), isValidInviteCookie returns true and it opens
// unlocked.
async function InviteAwareLoginForm() {
  const cookieStore = await cookies();
  const initiallyUnlocked = isValidInviteCookie(
    cookieStore.get(INVITE_COOKIE_NAME)?.value
  );

  return <LoginForm initiallyUnlocked={initiallyUnlocked} />;
}

export default function Page() {
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Welcome to ZENO</h1>
      <Suspense
        fallback={
          <div className="h-[260px] rounded-2xl border border-border/50 bg-muted/30" />
        }
      >
        <InviteAwareLoginForm />
      </Suspense>
    </>
  );
}
