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
  },
  zh: {
    ...dictionaries.zh,
    ...detailMessages.zh,
    ...dialogsMessages.zh,
    ...graphMessages.zh,
    ...chatMessages.zh,
  },
  fr: {
    ...dictionaries.fr,
    ...detailMessages.fr,
    ...dialogsMessages.fr,
    ...graphMessages.fr,
    ...chatMessages.fr,
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

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  // Start from the default so the server and the first client render match;
  // read the stored choice after mount (avoids a hydration mismatch).
  const [locale, setLocaleState] = useState<Locale>(defaultLocale);

  useEffect(() => {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (isLocale(stored)) {
      setLocaleState(stored);
    }
  }, []);

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
