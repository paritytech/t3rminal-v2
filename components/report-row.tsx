"use client";

import { FileCheck, FileX } from "lucide-react";
import type { DailyReportRecord } from "@/lib/storage/types";

const MONTH_NAMES = [
  "JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE",
  "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER",
];

/** The YYYY-MM-DD day a report belongs to (periods carry a `#NN` suffix). */
export function reportDayKey(record: DailyReportRecord): string {
  return record.date.split("#")[0] ?? record.date;
}

/** Group header for a report day: TODAY / YESTERDAY / "12 JULY". */
export function reportGroupLabel(ymd: string): string {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = new Date(ymd + "T00:00:00");
  const diff = Math.round((today.getTime() - day.getTime()) / 86_400_000);
  if (diff === 0) return "TODAY";
  if (diff === 1) return "YESTERDAY";
  const label = `${day.getDate()} ${MONTH_NAMES[day.getMonth()]}`;
  return day.getFullYear() === now.getFullYear() ? label : `${label} ${day.getFullYear()}`;
}

/**
 * One report entry, shared by the Reports screens: Z (day summary, blue) vs
 * X (current report, dark) with the `kind · count · state · time` meta line.
 */
export function ReportRow({ record }: { record: DailyReportRecord }) {
  const finalized = Boolean(record.finalized);
  const Icon = finalized ? FileCheck : FileX;
  const time = new Date(record.publishedAt).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  return (
    <div className="flex items-center gap-3 py-2.5">
      <span
        className={`w-11 h-11 rounded-full flex items-center justify-center shrink-0 ${
          finalized ? "bg-[#4353ff]" : "bg-neutral-800"
        }`}
      >
        <Icon className="w-5 h-5 text-white" />
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-white font-semibold">
          {finalized ? "Day summary" : "Current report"}
        </p>
        <p className="text-neutral-500 text-sm truncate">
          {finalized ? "Z-Report" : "X-Report"} · {record.entryCount} Transactions ·{" "}
          {finalized ? "Closed" : "Saved"} · {time}
        </p>
      </div>
    </div>
  );
}
