"use client";

/**
 * The merchant's alias — the username the person set in the Polkadot app
 * (`host_get_user_id` → `primaryUsername`, e.g. `todor` or `todor.001`).
 *
 * This is the human name for the account whose address we otherwise have to
 * print raw, so it is what the Balance screen leads with. The host exposes
 * exactly one, the primary; there is no list of further aliases on this call.
 * (`getContextualAlias` is a different thing entirely: a ring-VRF pseudonym
 * for one ring, not a display name.)
 *
 * Two things make this a resolve-once value rather than a plain read:
 *
 *  - **It prompts.** Both phone hosts gate it behind the `UserIdentityAccess`
 *    permission and show a dialog the first time a product asks. Asking again
 *    on every mount would re-prompt whoever granted it "once", so the answer
 *    is cached for the session.
 *  - **Absence is normal.** A wallet with no username answers `NotConnected`,
 *    and a person may decline. Neither is an error to report — the screen just
 *    has no alias to show — so nothing here throws or logs at error level.
 */

import { getAccountsProvider } from "./connection"
import { isInHost } from "./detect"

export type HostUsernameState =
  | { status: "loading" }
  /** The host named the account. */
  | { status: "ready"; username: string }
  /** No username is set in the Polkadot app for this wallet. */
  | { status: "none" }
  /** The person declined to share their identity with the terminal. */
  | { status: "denied" }
  /** Outside a host container, or the SDK predates the call. */
  | { status: "unavailable" }
  /** The host answered with something we can't read; `reason` is its own words. */
  | { status: "error"; reason: string }

/** Settled answer for this session — the call prompts, so ask once. */
let cached: HostUsernameState | null = null

function classify(error: unknown): HostUsernameState {
  const named = error && typeof error === "object" ? (error as { name?: unknown; payload?: { reason?: unknown } }) : null
  const name = String(named?.name ?? error ?? "")
  const reason = String(named?.payload?.reason ?? name)
  // Hosts spell a refusal in more than one way: the typed `PermissionDenied`
  // when the person declines, and a generic `Unknown` carrying "denied" when
  // the host simply will not answer this call. Both mean the same thing to a
  // merchant, so both land on "not shared".
  const both = `${name} ${reason}`
  if (/NotConnected/i.test(both)) return { status: "none" }
  if (/PermissionDenied|denied|rejected/i.test(both)) return { status: "denied" }
  return { status: "error", reason }
}

/**
 * Resolve the alias. Never throws and never rejects: every outcome, including
 * "there isn't one", comes back as a state the caller can render.
 */
export async function getHostUsername(): Promise<HostUsernameState> {
  if (cached) return cached

  if (!isInHost()) {
    cached = { status: "unavailable" }
    return cached
  }

  try {
    const provider = getAccountsProvider() as {
      getUserId?: () => {
        match: <T>(ok: (v: { primaryUsername: string }) => T, err: (e: unknown) => T) => Promise<T>
      }
    }
    if (typeof provider.getUserId !== "function") {
      cached = { status: "unavailable" }
      return cached
    }

    cached = await provider.getUserId().match<HostUsernameState>(
      ({ primaryUsername }) => {
        const username = primaryUsername.trim()
        return username ? { status: "ready", username } : { status: "none" }
      },
      (error) => classify(error),
    )
  } catch (error) {
    cached = classify(error)
  }

  return cached
}

/** For tests, and for a deliberate re-ask after the person changes their username. */
export function resetHostUsernameCache(): void {
  cached = null
}
