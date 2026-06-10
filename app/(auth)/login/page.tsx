import { Suspense } from "react";
import { LoginForm } from "@/components/auth/login-form";

export default function Page() {
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Welcome to ZENO</h1>
      <p className="text-sm text-muted-foreground">
        Continue with Google, or enter your email and we'll send you a one-time
        code. No password needed.
      </p>
      <Suspense
        fallback={
          <div className="h-[260px] rounded-2xl border border-border/50 bg-muted/30" />
        }
      >
        <LoginForm />
      </Suspense>
    </>
  );
}
