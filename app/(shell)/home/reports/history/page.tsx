"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Download, Search } from "lucide-react";
import { useCurrentPeriod } from "@/lib/hooks/use-current-period";
import { ReportRow, reportDayKey, reportGroupLabel } from "@/components/report-row";
import type { DailyReportRecord } from "@/lib/storage/types";

/**
 * Full report history, newest first, grouped by day (TODAY / YESTERDAY /
 * date). The download icon leads to Export CSV — the actual "take my data
 * out" flow.
 */

export default function ReportHistoryPage() {
  const { reports } = useCurrentPeriod();
  const [term, setTerm] = useState("");

  const groups = useMemo(() => {
    const query = term.trim().toLowerCase();
    const filtered = query
      ? reports.filter((r) => {
          const haystack = `${r.finalized ? "day summary z-report closed" : "current report x-report saved"} ${r.date} ${r.entryCount}`;
          return haystack.toLowerCase().includes(query);
        })
      : reports;
    const byDay = new Map<string, DailyReportRecord[]>();
    for (const record of filtered) {
      const key = reportDayKey(record);
      byDay.set(key, [...(byDay.get(key) ?? []), record]);
    }
    return [...byDay.entries()].sort(([a], [b]) => b.localeCompare(a));
  }, [reports, term]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex-1 min-h-0 flex flex-col max-w-md mx-auto w-full">
        {/* Header */}
        <header className="flex items-center justify-between px-4 py-4 shrink-0">
          <Link href="/home/reports" className="p-2" aria-label="Back to reports">
            <ArrowLeft className="w-6 h-6 text-white" />
          </Link>
          <span className="text-white text-lg font-semibold">Report History</span>
          <Link href="/home/export" className="p-2" aria-label="Export reports">
            <Download className="w-6 h-6 text-white" />
          </Link>
        </header>

        {/* Search */}
        <div className="px-6 pb-3 shrink-0">
          <div className="flex items-center gap-2 bg-neutral-900 rounded-full px-4 py-2.5">
            <Search className="w-4 h-4 text-neutral-500 shrink-0" />
            <input
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="Search reports"
              className="w-full bg-transparent text-white text-sm outline-none placeholder:text-neutral-500"
            />
          </div>
        </div>

        <main className="flex-1 min-h-0 overflow-y-auto px-6 pb-6">
          {groups.length === 0 ? (
            <p className="text-neutral-500 text-sm text-center py-12">
              {term ? "No reports match your search." : "No reports yet."}
            </p>
          ) : (
            groups.map(([day, records]) => (
              <section key={day} className="mb-4">
                <h3 className="text-neutral-400 text-xs font-semibold tracking-widest mb-1">
                  {reportGroupLabel(day)}
                </h3>
                {records.map((record) => (
                  <ReportRow key={record.date} record={record} />
                ))}
              </section>
            ))
          )}
        </main>
      </div>
    </div>
  );
}
