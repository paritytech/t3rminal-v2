"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

interface ShellNavState {
  locked: boolean;
  hidden: boolean;
  setLocked: (locked: boolean) => void;
  setHidden: (hidden: boolean) => void;
}

const ShellNavContext = createContext<ShellNavState | null>(null);

/**
 * Holds the shell nav flags. Pages that must prevent navigation mid-flow
 * (e.g. the terminal while a sale is awaiting payment) set `locked` via
 * useNavLock; full-screen states that need the bar gone entirely (e.g. the
 * share-receipt QR view) set `hidden` via useNavHidden. The shell's BottomNav
 * reads both.
 */
export function NavLockProvider({ children }: { children: ReactNode }) {
  const [locked, setLocked] = useState(false);
  const [hidden, setHidden] = useState(false);
  const value = useMemo(() => ({ locked, hidden, setLocked, setHidden }), [locked, hidden]);
  return <ShellNavContext.Provider value={value}>{children}</ShellNavContext.Provider>;
}

/** Read the current nav flags. Safe outside the provider (never locked/hidden). */
export function useShellNavState(): { locked: boolean; hidden: boolean } {
  const ctx = useContext(ShellNavContext);
  return { locked: ctx?.locked ?? false, hidden: ctx?.hidden ?? false };
}

/**
 * Declaratively lock the shell nav while `locked` is true. Resets on unmount
 * so a page can never leave the nav stuck locked after navigating away.
 */
export function useNavLock(locked: boolean) {
  const setLocked = useContext(ShellNavContext)?.setLocked;
  useEffect(() => {
    if (!setLocked) return;
    setLocked(locked);
    return () => setLocked(false);
  }, [locked, setLocked]);
}

/** Declaratively hide the shell nav while `hidden` is true. Resets on unmount. */
export function useNavHidden(hidden: boolean) {
  const setHidden = useContext(ShellNavContext)?.setHidden;
  useEffect(() => {
    if (!setHidden) return;
    setHidden(hidden);
    return () => setHidden(false);
  }, [hidden, setHidden]);
}
