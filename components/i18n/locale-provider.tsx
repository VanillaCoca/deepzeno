"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  defaultLocale,
  dictionaries,
  isLocale,
  type Locale,
} from "@/lib/i18n/dictionaries";
import { chatMessages } from "@/lib/i18n/messages/chat";
import { detailMessages } from "@/lib/i18n/messages/detail";
import { dialogsMessages } from "@/lib/i18n/messages/dialogs";
import { graphMessages } from "@/lib/i18n/messages/graph";
import { headerMessages } from "@/lib/i18n/messages/header";
import { kickoffMessages } from "@/lib/i18n/messages/kickoff";
import { renameMessages } from "@/lib/i18n/messages/rename";

export const LOCALE_STORAGE_KEY = "zeno-locale";

// Merge the per-feature copy into the core dictionaries so every `t("…")` key
// (nav/account/detail/dialog/…) resolves from one place. dictionaries.ts and
// the per-feature fragment files stay independent.
const mergedDictionaries: Record<Locale, Record<string, string>> = {
  en: {
    ...dictionaries.en,
    ...detailMessages.en,
    ...dialogsMessages.en,
    ...graphMessages.en,
    ...chatMessages.en,
    ...headerMessages.en,
    ...kickoffMessages.en,
    ...renameMessages.en,
  },
  zh: {
    ...dictionaries.zh,
    ...detailMessages.zh,
    ...dialogsMessages.zh,
    ...graphMessages.zh,
    ...chatMessages.zh,
    ...headerMessages.zh,
    ...kickoffMessages.zh,
    ...renameMessages.zh,
  },
  fr: {
    ...dictionaries.fr,
    ...detailMessages.fr,
    ...dialogsMessages.fr,
    ...graphMessages.fr,
    ...chatMessages.fr,
    ...headerMessages.fr,
    ...kickoffMessages.fr,
    ...renameMessages.fr,
  },
};

function interpolate(
  template: string,
  params?: Record<string, string | number>
): string {
  if (!params) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match
  );
}

type LocaleContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({
  children,
  initialLocale,
}: {
  children: React.ReactNode;
  // The locale read from the cookie on the server. When provided, the server
  // renders in this language AND the client's first render starts here, so they
  // match even for client components that hydrate late under streaming (the
  // homepage cards). Falls back to the default when there's no cookie yet.
  initialLocale?: Locale;
}) {
  const [locale, setLocaleState] = useState<Locale>(
    initialLocale ?? defaultLocale
  );

  useEffect(() => {
    // Reconcile with localStorage only when the server didn't already seed a
    // locale (e.g. first visit before the cookie exists). When initialLocale is
    // set, cookie and localStorage are in sync, so this is a no-op and never
    // causes a post-hydration flip.
    if (initialLocale) {
      return;
    }
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (isLocale(stored)) {
      setLocaleState(stored);
    }
  }, [initialLocale]);

  const value = useMemo<LocaleContextValue>(() => {
    return {
      locale,
      setLocale: (next: Locale) => {
        setLocaleState(next);
        localStorage.setItem(LOCALE_STORAGE_KEY, next);
        // Also persist to a cookie so server components (e.g. the homepage) can
        // render in the chosen language.
        // biome-ignore lint/suspicious/noDocumentCookie: simple persisted preference; Cookie Store API isn't broadly available.
        document.cookie = `${LOCALE_STORAGE_KEY}=${next}; path=/; max-age=31536000; samesite=lax`;
      },
      t: (key: string, params?: Record<string, string | number>) => {
        const template =
          mergedDictionaries[locale][key] ??
          mergedDictionaries[defaultLocale][key] ??
          key;
        return interpolate(template, params);
      },
    };
  }, [locale]);

  return (
    <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
  );
}

export function useLocale() {
  const context = useContext(LocaleContext);
  if (!context) {
    throw new Error("useLocale must be used within LocaleProvider");
  }
  return context;
}
