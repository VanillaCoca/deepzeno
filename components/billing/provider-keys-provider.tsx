"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { ProviderKeysDialog } from "@/components/billing/provider-keys-dialog";

type ProviderKeysContextValue = {
  /** Opens the usage & API-keys dialog from anywhere below the provider. */
  openProviderKeys: () => void;
};

const ProviderKeysContext = createContext<ProviderKeysContextValue | null>(
  null
);

/**
 * Owns the one instance of the usage & API-keys dialog.
 *
 * Connecting a key is the single action that turns a refusal back into a
 * working product, so the places that need to *offer* it are not the places
 * that own it: an exhausted allowance surfaces as a 402 inside a chat error
 * handler, while the dialog lived in `useState` local to whichever account
 * menu happened to be mounted. That left every refusal saying "go to
 * Settings" — the product knowing exactly which door to open and making the
 * user hunt for it anyway.
 *
 * Nothing is rendered until something asks. Mounting this at the root
 * therefore costs an empty context and no DOM, and no route inherits a Radix
 * `useId` subtree it never opens (see DeferredCreateProject for what that
 * costs on the homepage).
 */
export function ProviderKeysProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  const openProviderKeys = useCallback(() => {
    setMounted(true);
    setOpen(true);
  }, []);

  const value = useMemo<ProviderKeysContextValue>(
    () => ({ openProviderKeys }),
    [openProviderKeys]
  );

  return (
    <ProviderKeysContext.Provider value={value}>
      {children}
      {mounted ? (
        <ProviderKeysDialog onOpenChange={setOpen} open={open} />
      ) : null}
    </ProviderKeysContext.Provider>
  );
}

/**
 * Returns `null` outside the provider instead of throwing.
 *
 * Callers use the result to decide whether to offer the shortcut at all. A
 * hook that threw would push every error handler into a try/catch; one that
 * returned a silent no-op would render a button that does nothing, which is
 * worse than the sentence on its own.
 */
export function useProviderKeys(): ProviderKeysContextValue | null {
  return useContext(ProviderKeysContext);
}
