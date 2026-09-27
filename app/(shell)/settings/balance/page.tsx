"use client";

import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { AccountAvatar, useAccount } from "@/lib/web3";
import { AmountHero } from "@/components/amount-hero";
import { SubpageHeader, iconButtonClass } from "@/components/subpage-header";
import { useHostUsername } from "@/lib/hooks/use-host-username";
import { useCoinBalance } from "@/lib/payments/coinage/use-coin-balance";
import { useAssetSymbol } from "@/lib/utils/asset-metadata";
import { formatAmountFromPlanck } from "@/lib/utils/format";
import { PUSD_DECIMALS } from "@/lib/utils/asset-ids";

/**
 * Settings → Balance: what this terminal currently holds, and which account
 * holds it.
 *
 * The figure is the host's own number — `paymentBalanceSubscribe` on the
 * Polkadot app's payments bridge (lib/payments/coinage/use-coin-balance.ts) —
 * so it moves on its own as coins payments are claimed, with no refresh and no
 * chain read from the product. Outside the host there is no bridge and the
 * screen says so rather than showing a zero that would read as "you have
 * nothing".
 *
 * The merchant account comes from the host too (lib/host/accounts.ts, the
 * product-derived account). Its address is a raw identifier, so per the design
 * system it appears only where someone opened a screen to see it — this is
 * that screen, the same sanctioned case as the Terminal ID on Details, and it
 * carries a copy control for the same reason.
 */
/** How long "Reading the balance…" is an honest thing to say. */
const BALANCE_WAIT_MS = 8000;

export default function BalanceSettingsPage() {
  const { account } = useAccount();
  const { availablePlanck, status, error } = useCoinBalance();
  const alias = useHostUsername();
  const symbol = useAssetSymbol();
  const [copied, setCopied] = useState(false);

  // Say why the alias is blank rather than leaving an empty row: "not set" and
  // "you declined" are the two ordinary reasons, and both are the person's own
  // doing, so naming them is more use than silence.
  const aliasText =
    alias.status === "ready"
      ? alias.username
      : alias.status === "loading"
        ? "…"
        : alias.status === "none"
          ? "Not set in the Polkadot app"
          : alias.status === "denied"
            ? "Not shared with this terminal"
            : alias.status === "error"
              ? "Not available right now"
              : // "unavailable" — outside a host there is no account card to
                // put this row in, so it never renders anyway.
                null;

  const address = account ? account.displayAddress || account.address : null;
  const pending = status === "idle" || status === "loading";
  const readable = availablePlanck != null;

  // The subscription has no deadline of its own: a host that accepts it and
  // then never sends a balance leaves the hook in "loading" forever, and the
  // line below would read "Reading…" for the rest of the session. Give up
  // saying that after a few seconds and name the situation instead.
  const [stalled, setStalled] = useState(false);
  useEffect(() => {
    if (readable || !pending) return;
    const timer = setTimeout(() => setStalled(true), BALANCE_WAIT_MS);
    return () => clearTimeout(timer);
  }, [readable, pending]);

  const handleCopy = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — the address stays on screen to read */
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex-1 min-h-0 flex flex-col max-w-md mx-auto w-full">
        <SubpageHeader title="Balance" backHref="/settings" backLabel="Back to settings" />

        <main className="flex-1 min-h-0 overflow-y-auto px-6 pb-6">
          <AmountHero
            label="Available"
            value={
              readable ? formatAmountFromPlanck(availablePlanck, PUSD_DECIMALS) : "0.00"
            }
            symbol={symbol}
            testId="coin-balance"
            dimmed={!readable}
          />

          {/* One line under the figure, saying what the number is doing —
              which is also where the two failure states speak, so the screen
              never shows a dimmed zero with no explanation. */}
          <p className="text-caption text-fg-tertiary mt-2" data-testid="coin-balance-state">
            {readable
              ? "Updates as payments are claimed."
              : status === "unavailable"
                ? "Open the terminal from the Polkadot app to see your balance."
                : pending && !stalled
                  ? "Reading the balance from the Polkadot app…"
                  : pending
                    ? "The Polkadot app has not sent a balance yet."
                    : error || "The Polkadot app did not send a balance."}
          </p>

          {/* The account the balance belongs to. A container surface, no
              hairline — it groups, and the surface step already says so. */}
          {account && address && (
            <section className="mt-8 rounded-container bg-surface-container p-5">
              <div className="flex items-center gap-3">
                <AccountAvatar address={address} size={40} />
                <div className="min-w-0 flex-1">
                  <p className="text-label-l text-fg-primary truncate">{account.name}</p>
                  <p className="text-body-m text-fg-secondary">Held by the Polkadot app</p>
                </div>
              </div>

              {/* Alias — the name the person set in the Polkadot app. A name,
                  not an identifier, so it stays in the sans face; the address
                  below is the one that earns mono. */}
              {aliasText && (
                <div className="mt-4 rounded-nested bg-surface-nested px-4 py-3">
                  <p className="text-caption text-fg-tertiary mb-0.5">Alias</p>
                  <p
                    className={`text-body-m ${
                      alias.status === "ready" ? "text-fg-primary" : "text-fg-tertiary"
                    }`}
                    data-testid="coin-balance-alias"
                  >
                    {aliasText}
                  </p>
                </div>
              )}

              <div className="mt-3 rounded-nested bg-surface-nested px-4 py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-caption text-fg-tertiary mb-0.5">Address</p>
                  <p
                    className="text-body-m font-mono text-fg-primary break-all"
                    data-testid="coin-balance-address"
                  >
                    {address}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleCopy}
                  aria-label="Copy address"
                  className={`${iconButtonClass} shrink-0 text-fg-secondary`}
                >
                  {copied ? (
                    <Check className="size-5 text-fg-success" />
                  ) : (
                    <Copy className="size-5" />
                  )}
                </button>
              </div>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
