"use client";

import { Loader2Icon } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { toast } from "@/components/chat/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createClient as createSupabaseClient,
  isSupabaseConfigured,
} from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type AuthMode = "login" | "register";

export function LoginForm({
  initialMode = "login",
}: {
  initialMode?: AuthMode;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<AuthMode>(() => {
    const modeParam = searchParams.get("mode");
    return modeParam === "register" ? "register" : initialMode;
  });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const configured = isSupabaseConfigured();

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!configured) {
      toast({
        type: "error",
        description:
          "Supabase environment variables are missing. Add the public URL and anon key first.",
      });
      return;
    }

    setIsSubmitting(true);

    try {
      const supabase = createSupabaseClient();

      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (error) {
          throw error;
        }

        router.push("/");
        router.refresh();
        return;
      }

      const { data, error } = await supabase.auth.signUp({
        email,
        password,
      });

      if (error) {
        throw error;
      }

      if (data.session) {
        toast({
          type: "success",
          description: "Account created.",
        });
        router.push("/");
        router.refresh();
        return;
      }

      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (!signInError) {
        toast({
          type: "success",
          description: "Account created.",
        });
        router.push("/");
        router.refresh();
        return;
      }

      toast({
        type: "success",
        description:
          "Account created. If email confirmation is enabled in Supabase, confirm the email before signing in.",
      });
      setMode("login");
    } catch (error) {
      toast({
        type: "error",
        description:
          error instanceof Error ? error.message : "Authentication failed.",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-2 rounded-xl border border-border/50 bg-muted/40 p-1">
        <button
          className={cn(
            "flex-1 rounded-lg px-3 py-2 text-sm transition-colors",
            mode === "login"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
          onClick={() => setMode("login")}
          type="button"
        >
          Sign in
        </button>
        <button
          className={cn(
            "flex-1 rounded-lg px-3 py-2 text-sm transition-colors",
            mode === "register"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
          onClick={() => setMode("register")}
          type="button"
        >
          Create account
        </button>
      </div>

      <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
        <div className="flex flex-col gap-2">
          <Label className="font-normal text-muted-foreground" htmlFor="email">
            Email
          </Label>
          <Input
            autoComplete="email"
            autoFocus
            className="h-10 rounded-lg border-border/50 bg-muted/50 text-sm transition-colors focus:border-foreground/20 focus:bg-muted"
            id="email"
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            required
            type="email"
            value={email}
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label
            className="font-normal text-muted-foreground"
            htmlFor="password"
          >
            Password
          </Label>
          <Input
            className="h-10 rounded-lg border-border/50 bg-muted/50 text-sm transition-colors focus:border-foreground/20 focus:bg-muted"
            id="password"
            minLength={6}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="At least 6 characters"
            required
            type="password"
            value={password}
          />
        </div>

        <Button
          className="relative"
          disabled={isSubmitting || !configured}
          type="submit"
        >
          {mode === "login" ? "Sign in" : "Create account"}
          {isSubmitting && (
            <Loader2Icon className="absolute right-4 size-4 animate-spin" />
          )}
        </Button>
      </form>

      {!configured && (
        <p className="text-[13px] text-muted-foreground">
          Add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` to
          enable authentication.
        </p>
      )}
    </div>
  );
}
