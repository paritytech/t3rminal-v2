"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { useSalesHistory, type SaleRecord } from "@/lib/storage";
import { formatAmountFromPlanck } from "@/lib/utils/format";
import { PUSD_DECIMALS } from "@/lib/utils/asset-ids";
import { useAssetSymbol } from "@/lib/utils/asset-metadata";

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type ChartView = "months" | "weeks" | "days";
const WEEKS_SHOWN = 12;
const DAYS_SHOWN = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Planck → display string with thousands separators, always 2 decimals. */
function money(planck: bigint): string {
  return Number(formatAmountFromPlanck(planck, PUSD_DECIMALS)).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Monday-based start of the current week. */
function startOfWeek(now: Date): Date {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = (d.getDay() + 6) % 7; // Mon=0 … Sun=6
  d.setDate(d.getDate() - day);
  return d;
}

/**
 * Sales dashboard, opened from the Home "Sales" tile. All figures are computed
 * from the local sale records (same source as History): incoming sales only,
 * summed in exact planck bigints and formatted once for display.
 */
export default function SalesPage() {
  const router = useRouter();
  const symbol = useAssetSymbol();
  const { sales, isLoading } = useSalesHistory();
  const currentYear = new Date().getFullYear();
  const [view, setView] = useState<ChartView>("months");
  // Tapped bar whose amount tooltip stays open (hover covers mouse users).
  const [activeBar, setActiveBar] = useState<number | null>(null);

  const stats = useMemo(() => {
    const incoming = (sales ?? []).filter((s: SaleRecord) => s.type === "incoming");
    const now = new Date();
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = startOfWeek(now);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    let today = 0n;
    let week = 0n;
    let month = 0n;
    let total = 0n;
    let yearTotal = 0n;
    const monthly: bigint[] = Array.from({ length: 12 }, () => 0n);
    // Rolling buckets, oldest first — index (length-1) is the current week/day.
    const weekly: bigint[] = Array.from({ length: WEEKS_SHOWN }, () => 0n);
    const daily: bigint[] = Array.from({ length: DAYS_SHOWN }, () => 0n);

    for (const sale of incoming) {
      let amount: bigint;
      try {
        amount = BigInt(sale.amountPlanck);
      } catch {
        continue; // malformed legacy record — skip rather than poison the totals
      }
      const ts = new Date(sale.timestamp);
      total += amount;
      if (ts >= dayStart) today += amount;
      if (ts >= weekStart) week += amount;
      if (ts >= monthStart) month += amount;
      if (ts.getFullYear() === currentYear) {
        yearTotal += amount;
        monthly[ts.getMonth()] += amount;
      }

      // Rolling week/day buckets. Round (not floor) the day distance so a DST
      // hour shift can't push a sale into the neighboring bucket.
      const tsDayStart = new Date(ts.getFullYear(), ts.getMonth(), ts.getDate());
      const daysAgo = Math.round((dayStart.getTime() - tsDayStart.getTime()) / DAY_MS);
      if (daysAgo >= 0 && daysAgo < DAYS_SHOWN) {
        daily[DAYS_SHOWN - 1 - daysAgo] += amount;
      }
      const weeksAgo = Math.round(
        (weekStart.getTime() - startOfWeek(ts).getTime()) / (7 * DAY_MS),
      );
      if (weeksAgo >= 0 && weeksAgo < WEEKS_SHOWN) {
        weekly[WEEKS_SHOWN - 1 - weeksAgo] += amount;
      }
    }

    const count = incoming.length;
    const average = count > 0
      ? Number(formatAmountFromPlanck(total, PUSD_DECIMALS)) / count
      : 0;

    return {
      count,
      today,
      week,
      month,
      average,
      yearTotal,
      monthly,
      weekly,
      daily,
    };
  }, [sales, currentYear]);

  // Chart series for the active view: values, labels, which bar is "now",
  // and the total shown above the chart.
  const chart = useMemo(() => {
    const now = new Date();
    if (view === "weeks") {
      const start = startOfWeek(now);
      const labels = stats.weekly.map((_, i) => {
        const d = new Date(start.getTime() - (WEEKS_SHOWN - 1 - i) * 7 * DAY_MS);
        return `${d.getMonth() + 1}/${d.getDate()}`;
      });
      return {
        values: stats.weekly,
        labels,
        highlightIndex: WEEKS_SHOWN - 1,
        title: `Last ${WEEKS_SHOWN} weeks`,
        total: stats.weekly.reduce((sum, v) => sum + v, 0n),
      };
    }
    if (view === "days") {
      const labels = stats.daily.map((_, i) => {
        const d = new Date(now.getTime() - (DAYS_SHOWN - 1 - i) * DAY_MS);
        return `${d.getDate()}`;
      });
      return {
        values: stats.daily,
        labels,
        highlightIndex: DAYS_SHOWN - 1,
        title: `Last ${DAYS_SHOWN} days`,
        total: stats.daily.reduce((sum, v) => sum + v, 0n),
      };
    }
    return {
      values: stats.monthly,
      labels: MONTH_LABELS,
      highlightIndex: now.getMonth(),
      title: `Total for ${currentYear}`,
      total: stats.yearTotal,
    };
  }, [view, stats, currentYear]);

  const maxValue = chart.values.reduce((max, v) => (v > max ? v : max), 0n);
  const dim = isLoading ? "opacity-40" : "";

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="flex-1 flex flex-col max-w-md mx-auto w-full">
        {/* Header */}
        <header className="flex items-center justify-between px-4 py-4">
          <button onClick={() => router.back()} className="p-2" aria-label="Back to home">
            <ArrowLeft className="w-6 h-6 text-white" />
          </button>
          <span className="text-white text-lg font-semibold">Sales</span>
          <div className="w-10" />
        </header>

        <main className={`flex flex-col gap-3 px-4 pb-6 ${dim}`}>
          {/* Stat cards */}
          <div className="grid grid-cols-2 gap-3">
            {/* Transactions — links to the full list in History */}
            <Link href="/history" className="bg-neutral-900 rounded-2xl p-4 hover:bg-neutral-800 transition">
              <div className="flex items-center justify-between mb-2">
                <span className="flex items-center gap-2 text-neutral-300 text-sm">
                  <span className="w-2 h-2 rounded-full bg-green-500" />
                  Transactions
                </span>
                <ChevronRight className="w-4 h-4 text-neutral-500" />
              </div>
              <p data-testid="sales-transactions" className="text-white text-3xl font-bold">{stats.count}</p>
            </Link>

            {/* Refunds — always 0 until refunds exist in the system */}
            <div className="bg-neutral-900 rounded-2xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="w-2 h-2 rounded-full bg-orange-500" />
                <span className="text-neutral-300 text-sm">Refunds</span>
              </div>
              <p className="text-white text-3xl font-bold">0</p>
            </div>

            <StatCard label="Today" value={money(stats.today)} unit={symbol} />
            <StatCard label="This week" value={money(stats.week)} unit={symbol} />
            <StatCard label="This month" value={money(stats.month)} unit={symbol} />
            <StatCard
              label="Average sale"
              value={stats.average.toLocaleString("en-US", { maximumFractionDigits: 2 })}
              unit={symbol}
            />
          </div>

          {/* Chart card — total + bars at monthly/weekly/daily granularity */}
          <div className="bg-neutral-900 rounded-2xl p-4">
            <div className="mb-1">
              <span className="text-neutral-300 text-sm">{chart.title}</span>
            </div>
            <p data-testid="sales-year-total" className="mb-4">
              <span className="text-white text-3xl font-bold tracking-tight">{money(chart.total)}</span>
              <span className="text-neutral-400 text-sm font-semibold ml-2">{symbol}</span>
            </p>

            {/* Granularity switch */}
            <div className="flex bg-neutral-800 rounded-lg p-1 mb-5 w-fit">
              {([
                ["months", "Months"],
                ["weeks", "Weeks"],
                ["days", "Days"],
              ] as [ChartView, string][]).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => { setView(key); setActiveBar(null); }}
                  className={`px-3 py-1 rounded-md text-sm font-medium transition ${
                    view === key
                      ? "bg-neutral-600 text-white"
                      : "text-neutral-400 hover:text-neutral-200"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Bars — flat dash for empty buckets, the current bucket in blue */}
            <div
              className="grid gap-1.5 items-end h-28"
              style={{ gridTemplateColumns: `repeat(${chart.values.length}, minmax(0, 1fr))` }}
            >
              {chart.values.map((value, i) => {
                const ratio = maxValue > 0n
                  ? Number((value * 1000n) / maxValue) / 1000
                  : 0;
                const height = value > 0n ? Math.max(10, Math.round(ratio * 100)) : 4;
                return (
                  <div
                    key={i}
                    className="group relative flex flex-col items-center justify-end h-full cursor-pointer"
                    onClick={() => setActiveBar(activeBar === i ? null : i)}
                  >
                    {/* Amount tooltip — on hover (mouse) or tap (touch) */}
                    <div
                      className={`pointer-events-none absolute bottom-full mb-1.5 left-1/2 -translate-x-1/2 z-10 rounded-md bg-neutral-700 px-2 py-1 text-[10px] font-semibold text-white whitespace-nowrap shadow-lg ${
                        activeBar === i ? "" : "hidden group-hover:block"
                      }`}
                    >
                      {money(value)} {symbol}
                    </div>
                    <div
                      className={`w-full rounded-md ${
                        i === chart.highlightIndex ? "bg-[#4353ff]" : "bg-neutral-500"
                      }`}
                      style={{ height: `${height}%` }}
                    />
                  </div>
                );
              })}
            </div>
            <div
              className="grid gap-1.5 mt-2"
              style={{ gridTemplateColumns: `repeat(${chart.values.length}, minmax(0, 1fr))` }}
            >
              {chart.labels.map((label, i) => (
                <span
                  key={`${label}-${i}`}
                  className={`text-[9px] text-center truncate ${
                    i === chart.highlightIndex ? "text-white font-semibold" : "text-neutral-500"
                  }`}
                >
                  {label}
                </span>
              ))}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

function StatCard({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="bg-neutral-900 rounded-2xl p-4">
      <p className="text-neutral-300 text-sm mb-2">{label}</p>
      <p className="text-white">
        <span className="text-3xl font-bold tracking-tight">{value}</span>
        <span className="text-neutral-400 text-xs font-semibold ml-1.5">{unit}</span>
      </p>
    </div>
  );
}
