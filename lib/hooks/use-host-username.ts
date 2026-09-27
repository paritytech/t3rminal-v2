"use client";

import { useEffect, useState } from "react";
import { getHostUsername, type HostUsernameState } from "@/lib/host/username";

/**
 * The merchant's alias from the Polkadot app, resolved once per session.
 *
 * Mount-time only: the call prompts for the identity permission the first
 * time, so it belongs on a screen the merchant opened on purpose (Settings →
 * Balance), never in a layout or a provider that runs everywhere.
 */
export function useHostUsername(): HostUsernameState {
  const [state, setState] = useState<HostUsernameState>({ status: "loading" });

  useEffect(() => {
    let alive = true;
    void getHostUsername().then((next) => {
      if (alive) setState(next);
    });
    return () => {
      alive = false;
    };
  }, []);

  return state;
}
