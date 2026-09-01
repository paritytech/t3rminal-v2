"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, Copy, RefreshCw, Trash2 } from "lucide-react";
import {
  clearCapturedLogs,
  downloadLogsTxt,
  formatLogsAsText,
  getCapturedLogs,
} from "@/lib/debug/log-capture";

/**
 * Raw console-log list (opened from Report a problem's header icon). One
 * primary action: copy everything to the clipboard so it can be pasted into
 * a chat/issue. Falls back to a .txt download when the clipboard is
 * unavailable (host webviews).
 */
export default function LogsPage() {
  const router = useRouter();
  const [count, setCount] = useState(0);
  const [text, setText] = useState("");
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(() => {
    setCount(getCapturedLogs().length);
    setText(formatLogsAsText());
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(formatLogsAsText());
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard unavailable (host webview) — hand over a file instead.
      downloadLogsTxt();
    }
  };

  const handleClear = () => {
    clearCapturedLogs();
    refresh();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex-1 min-h-0 flex flex-col max-w-md mx-auto w-full">
        {/* Header */}
        <header className="flex items-center justify-between px-4 py-4 shrink-0">
          <button onClick={() => router.back()} className="p-2" aria-label="Back">
            <ArrowLeft className="w-6 h-6 text-white" />
          </button>
          <span className="text-white text-lg font-semibold">Logs</span>
          <button onClick={refresh} className="p-2" aria-label="Refresh logs">
            <RefreshCw className="w-5 h-5 text-white" />
          </button>
        </header>

        <main className="flex-1 min-h-0 flex flex-col px-6 pb-6">
          <div className="flex items-center justify-between mb-3 shrink-0">
            <p className="text-neutral-400 text-sm">{count} entries this session</p>
            <button
              onClick={handleClear}
              className="flex items-center gap-1.5 text-neutral-500 hover:text-red-400 text-sm transition"
            >
              <Trash2 className="w-4 h-4" /> Clear
            </button>
          </div>

          {/* Log list */}
          <div className="flex-1 min-h-0 overflow-auto rounded-2xl border border-neutral-800 bg-neutral-950 p-3">
            <pre className="text-neutral-300 text-[11px] leading-relaxed font-mono whitespace-pre-wrap break-words">
              {text || "No logs captured yet."}
            </pre>
          </div>

          <button
            type="button"
            onClick={handleCopy}
            disabled={count === 0}
            className="mt-4 shrink-0 w-full bg-white hover:bg-neutral-100 disabled:bg-neutral-900 disabled:text-neutral-600 text-black font-semibold py-4 rounded-2xl transition flex items-center justify-center gap-2"
          >
            {copied ? (
              <>
                <Check className="w-5 h-5" /> Copied
              </>
            ) : (
              <>
                <Copy className="w-5 h-5" /> Copy logs
              </>
            )}
          </button>
        </main>
      </div>
    </div>
  );
}
