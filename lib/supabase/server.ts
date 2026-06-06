import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { AppSession, AuthenticatedUser } from "./types";

export type { AppSession } from "./types";

export function isSupabaseConfigured() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

function mapUser(user: {
  id: string;
  email?: string | null;
}): AuthenticatedUser {
  return {
    id: user.id,
    email: user.email ?? null,
    type: "regular",
  };
}

function decodeJwtPayload(token: string | null | undefined) {
  if (!token) {
    return null;
  }

  const parts = token.split(".");
  if (parts.length < 2) {
    return null;
  }

  try {
    const normalized = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(
      normalized.length + ((4 - (normalized.length % 4)) % 4),
      "="
    );
    const payload = JSON.parse(
      Buffer.from(padded, "base64").toString("utf8")
    ) as {
      sub?: string;
      email?: string | null;
      exp?: number;
    };

    if (payload.exp && payload.exp * 1000 <= Date.now()) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

export async function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    return null;
  }

  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Cookie writes are unavailable in some Server Component contexts.
        }
      },
    },
  });
}

export async function auth(): Promise<AppSession | null> {
  const supabase = await createClient();

  if (!supabase) {
    return null;
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();
  const claims = decodeJwtPayload(session?.access_token);

  if (!claims?.sub) {
    return null;
  }

  return {
    user: mapUser({
      id: claims.sub,
      email: typeof claims.email === "string" ? claims.email : null,
    }),
  };
}

export async function requireAuth() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  return session;
}

export async function signOut({
  redirectTo = "/login",
}: {
  redirectTo?: string;
} = {}) {
  "use server";

  const supabase = await createClient();

  if (supabase) {
    await supabase.auth.signOut();
  }

  redirect(redirectTo);
}
