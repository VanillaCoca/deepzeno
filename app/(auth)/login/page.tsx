import { cookies } from "next/headers";
import { Suspense } from "react";
import { LoginForm } from "@/components/auth/login-form";
import { ZenoLogo } from "@/components/zeno-logo";
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
      <div className="mb-6 flex items-center gap-2.5">
        <ZenoLogo className="size-8 text-foreground" />
        <span
          className="text-2xl text-foreground tracking-tight"
          style={{ fontFamily: "var(--font-averia)" }}
        >
          ZENO
        </span>
      </div>
      <p className="font-medium text-muted-foreground text-xs uppercase tracking-[0.18em]">
        Insight-first AI
      </p>
      <h1 className="text-balance font-semibold text-3xl tracking-tight">
        Make your research and planning more insightful.
      </h1>
      <p className="pb-2 text-muted-foreground text-sm leading-relaxed">
        Most AI tools answer your question and forget it. ZENO treats your
        project as a serious one — it does the digging, surfaces the assumptions
        worth a second look, and keeps every judgment you confirm, even as the
        goal shifts under you.
      </p>
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
