"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { QualityPreference } from "@/lib/ai/model-policy";

const STORAGE_KEY = "zeno-quality";
const DEFAULT_QUALITY: QualityPreference = "balanced";

function isQuality(value: unknown): value is QualityPreference {
  return value === "economy" || value === "balanced" || value === "best";
}

type QualityContextValue = {
  quality: QualityPreference;
  setQuality: (next: QualityPreference) => void;
};

const QualityContext = createContext<QualityContextValue | null>(null);

export function QualityProvider({ children }: { children: React.ReactNode }) {
  const [quality, setQualityState] =
    useState<QualityPreference>(DEFAULT_QUALITY);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isQuality(stored)) {
      setQualityState(stored);
    }
  }, []);

  const value = useMemo<QualityContextValue>(
    () => ({
      quality,
      setQuality: (next: QualityPreference) => {
        setQualityState(next);
        localStorage.setItem(STORAGE_KEY, next);
      },
    }),
    [quality]
  );

  return (
    <QualityContext.Provider value={value}>{children}</QualityContext.Provider>
  );
}

export function useQuality() {
  const context = useContext(QualityContext);
  if (!context) {
    throw new Error("useQuality must be used within QualityProvider");
  }
  return context;
}
