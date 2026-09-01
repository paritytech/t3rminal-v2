"use client";

import Link from "next/link";
import { ClipboardList, Settings, TrendingUp, ReceiptText, Store } from "lucide-react";
import { useTodaysIncome } from "@/lib/storage";
import { useMerchantProfile } from "@/lib/config/merchant";
import { formatAmountFromPlanck } from "@/lib/utils/format";
import { PUSD_DECIMALS } from "@/lib/utils/asset-ids";
import { useAssetSymbol } from "@/lib/utils/asset-metadata";

/**
 * Merchant home dashboard. Today's Income is live from sale storage; the
 * action tiles are still placeholders (no navigation yet). The gear in the
 * header opens Settings (no longer a nav tab).
 */
export default function HomePage() {
  const { totalPlanck, isLoading } = useTodaysIncome();
  const symbol = useAssetSymbol();
  // Once onboarding is completed the tile disappears — the profile lives on
  // under Settings → Merchant Profile.
  const merchant = useMerchantProfile();

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="flex-1 flex flex-col max-w-md mx-auto w-full">
        {/* Header */}
        <header className="flex items-center justify-between px-6 py-5">
          <h1 className="text-white text-3xl font-bold">Home</h1>
          <Link href="/settings" aria-label="Settings" className="p-2 -mr-2">
            <Settings className="w-6 h-6 text-white" />
          </Link>
        </header>

        {/* Today's income — live sum of today's incoming sales */}
        <section className="px-6 mb-8">
          <p className="text-neutral-400 text-base mb-1">Today&apos;s Income</p>
          <div className="flex items-baseline justify-between gap-4">
            <span
              data-testid="todays-income"
              className={`text-white text-7xl font-bold tracking-tight break-all ${
                isLoading ? "opacity-40" : ""
              }`}
            >
              {formatAmountFromPlanck(totalPlanck, PUSD_DECIMALS)}
            </span>
            <span className="text-neutral-400 text-base font-semibold shrink-0">{symbol}</span>
          </div>
        </section>

        {/* Action tiles. Sales/Export work from day one; Reports (X/Z
            tooling) unlocks with the merchant profile. */}
        <section className="px-6 grid grid-cols-2 gap-4">
          <HomeTile icon={TrendingUp} label="Sales" accent href="/home/sales" />
          <HomeTile icon={ReceiptText} label="Export CSV" accent href="/home/export" />
          {merchant.completed && (
            <HomeTile icon={ClipboardList} label="Reports" accent href="/home/reports" />
          )}
          {!merchant.isLoading && !merchant.completed && (
            <HomeTile icon={Store} label="Become a Merchant" href="/merchant" />
          )}
        </section>
      </div>
    </div>
  );
}

function HomeTile({
  icon: Icon,
  label,
  accent = false,
  href,
}: {
  icon: typeof TrendingUp;
  label: string;
  accent?: boolean;
  href?: string;
}) {
  const className = `aspect-square rounded-3xl p-5 flex flex-col justify-between items-start text-left transition active:scale-95 ${
    accent ? "bg-[#4353ff] hover:bg-[#3646e0]" : "bg-neutral-900 hover:bg-neutral-800"
  }`;
  const content = (
    <>
      <Icon className="w-7 h-7 text-white" />
      <span className="text-white text-xl font-semibold leading-tight">{label}</span>
    </>
  );
  return href ? (
    <Link href={href} className={className}>
      {content}
    </Link>
  ) : (
    <button type="button" className={className}>
      {content}
    </button>
  );
}
