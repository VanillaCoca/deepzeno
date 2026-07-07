"use client";

import { LogOutIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useLocale } from "@/components/i18n/locale-provider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  createClient as createSupabaseClient,
  isSupabaseConfigured,
} from "@/lib/supabase/client";

// Account control for chrome outside the workspace sidebar — notably the project
// home header, which otherwise had no way to sign out. Avatar button opens a menu
// with the signed-in email and Log out. Mirrors the sidebar's sign-out behavior.
export function AccountMenu({ userEmail }: { userEmail: string | null }) {
  const router = useRouter();
  const { t } = useLocale();
  const [isSigningOut, setIsSigningOut] = useState(false);

  const email = userEmail ?? "Authenticated user";
  const name = email.includes("@") ? email.split("@")[0] : email;
  const initial = (name.trim()[0] ?? "?").toUpperCase();

  async function handleSignOut() {
    if (!isSupabaseConfigured()) {
      router.push("/login");
      return;
    }

    setIsSigningOut(true);

    try {
      const supabase = createSupabaseClient();
      await supabase.auth.signOut();
      router.push("/login");
      router.refresh();
    } finally {
      setIsSigningOut(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="flex size-8 items-center justify-center rounded-full bg-muted font-semibold text-foreground text-xs ring-1 ring-border/60 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title={name}
          type="button"
        >
          {initial}
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="min-w-52" sideOffset={8}>
        <DropdownMenuLabel className="truncate font-normal text-muted-foreground text-xs">
          {email}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={isSigningOut}
          onSelect={() => handleSignOut()}
          variant="destructive"
        >
          <LogOutIcon />
          {t("account.logOut")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
