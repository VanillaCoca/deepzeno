"use client";

import { Loader2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "@/components/chat/toast";
import { useLocale } from "@/components/i18n/locale-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createClient as createSupabaseClient,
  isSupabaseConfigured,
} from "@/lib/supabase/client";

type Step = "email" | "code";

function GoogleIcon() {
  return (
    <svg aria-hidden="true" className="size-4" viewBox="0 0 24 24">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1Z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38Z"
        fill="#EA4335"
      />
    </svg>
  );
}

export function LoginForm() {
  const router = useRouter();
  const { t } = useLocale();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const configured = isSupabaseConfigured();

  function ensureConfigured() {
    if (configured) {
      return true;
    }
    toast({
      type: "error",
      description: t("dialog.login.supabaseMissingToast"),
    });
    return false;
  }

  function describeError(error: unknown) {
    return error instanceof Error
      ? error.message
      : t("dialog.login.authFailedToast");
  }

  async function sendCode() {
    const supabase = createSupabaseClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true },
    });

    if (error) {
      throw error;
    }

    toast({ type: "success", description: t("dialog.login.codeSentToast") });
  }

  async function handleGoogle() {
    if (!ensureConfigured()) {
      return;
    }

    setIsGoogleLoading(true);

    try {
      const supabase = createSupabaseClient();
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
        },
      });

      if (error) {
        throw error;
      }
      // On success the browser redirects to Google; nothing else to do here.
    } catch {
      toast({
        type: "error",
        description: t("dialog.login.googleFailedToast"),
      });
      setIsGoogleLoading(false);
    }
  }

  async function handleSendCode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!ensureConfigured()) {
      return;
    }

    setIsSubmitting(true);

    try {
      await sendCode();
      setCode("");
      setStep("code");
    } catch (error) {
      toast({ type: "error", description: describeError(error) });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleResend() {
    if (!ensureConfigured()) {
      return;
    }

    setIsSubmitting(true);

    try {
      await sendCode();
    } catch (error) {
      toast({ type: "error", description: describeError(error) });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleVerify(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!ensureConfigured()) {
      return;
    }

    setIsSubmitting(true);

    try {
      const supabase = createSupabaseClient();
      const { error } = await supabase.auth.verifyOtp({
        email,
        token: code.trim(),
        type: "email",
      });

      if (error) {
        throw error;
      }

      router.push("/");
      router.refresh();
    } catch (error) {
      toast({ type: "error", description: describeError(error) });
      setIsSubmitting(false);
    }
  }

  if (step === "code") {
    return (
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <p className="font-medium text-foreground text-sm">
            {t("dialog.login.checkEmailTitle")}
          </p>
          <p className="text-[13px] text-muted-foreground">
            {t("dialog.login.checkEmailBody")}{" "}
            <span className="text-foreground">{email}</span>
          </p>
        </div>

        <form className="flex flex-col gap-4" onSubmit={handleVerify}>
          <div className="flex flex-col gap-2">
            <Label className="font-normal text-muted-foreground" htmlFor="code">
              {t("dialog.login.code")}
            </Label>
            <Input
              autoComplete="one-time-code"
              autoFocus
              className="h-11 rounded-lg border-border/50 bg-muted/50 text-center text-lg tracking-[0.5em] transition-colors focus:border-foreground/20 focus:bg-muted"
              id="code"
              inputMode="numeric"
              maxLength={6}
              onChange={(event) =>
                setCode(event.target.value.replace(/\D/g, ""))
              }
              placeholder={t("dialog.login.codePlaceholder")}
              required
              value={code}
            />
          </div>

          <Button
            className="relative"
            disabled={isSubmitting || code.length < 6}
            type="submit"
          >
            {t("dialog.login.verifyContinue")}
            {isSubmitting && (
              <Loader2Icon className="absolute right-4 size-4 animate-spin" />
            )}
          </Button>
        </form>

        <div className="flex items-center justify-between text-[13px]">
          <button
            className="text-muted-foreground transition-colors hover:text-foreground"
            onClick={() => {
              setStep("email");
              setCode("");
            }}
            type="button"
          >
            {t("dialog.login.changeEmail")}
          </button>
          <button
            className="text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
            disabled={isSubmitting}
            onClick={handleResend}
            type="button"
          >
            {t("dialog.login.resendCode")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <Button
        className="relative w-full gap-2"
        disabled={isGoogleLoading || isSubmitting}
        onClick={handleGoogle}
        type="button"
        variant="outline"
      >
        <GoogleIcon />
        {t("dialog.login.continueWithGoogle")}
        {isGoogleLoading && (
          <Loader2Icon className="absolute right-4 size-4 animate-spin" />
        )}
      </Button>

      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-border/60" />
        <span className="text-[12px] text-muted-foreground">
          {t("dialog.login.or")}
        </span>
        <span className="h-px flex-1 bg-border/60" />
      </div>

      <form className="flex flex-col gap-4" onSubmit={handleSendCode}>
        <div className="flex flex-col gap-2">
          <Label className="font-normal text-muted-foreground" htmlFor="email">
            {t("dialog.login.email")}
          </Label>
          <Input
            autoComplete="email"
            className="h-10 rounded-lg border-border/50 bg-muted/50 text-sm transition-colors focus:border-foreground/20 focus:bg-muted"
            id="email"
            onChange={(event) => setEmail(event.target.value)}
            placeholder={t("dialog.login.emailPlaceholder")}
            required
            type="email"
            value={email}
          />
        </div>

        <Button
          className="relative"
          disabled={isSubmitting || isGoogleLoading || !email}
          type="submit"
        >
          {t("dialog.login.continueWithEmail")}
          {isSubmitting && (
            <Loader2Icon className="absolute right-4 size-4 animate-spin" />
          )}
        </Button>
      </form>

      {!configured && (
        <p className="text-[13px] text-muted-foreground">
          {t("dialog.login.supabaseConfigHint")}
        </p>
      )}
    </div>
  );
}
