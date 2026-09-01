"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Copy } from "lucide-react";
import { setTerminalName, useTerminalIdentity } from "@/lib/config/terminal";

/**
 * Settings → Details: this terminal's identity. The name is merchant-chosen;
 * the Terminal ID is minted once per device and read-only — it tags receipts
 * and payment deeplinks.
 */
export default function DetailsSettingsPage() {
  const { name, terminalId, isLoading } = useTerminalIdentity();
  const [draftName, setDraftName] = useState("");
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!isLoading) setDraftName(name);
    // Only seed the draft once the stored name arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

  const handleSave = async () => {
    await setTerminalName(draftName);
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };

  const handleCopy = async () => {
    if (!terminalId) return;
    try {
      await navigator.clipboard.writeText(terminalId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — the ID is short enough to retype */
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex-1 min-h-0 flex flex-col max-w-md mx-auto w-full">
        {/* Header */}
        <header className="flex items-center justify-between px-4 py-4 shrink-0">
          <Link href="/settings" className="p-2" aria-label="Back to settings">
            <ArrowLeft className="w-6 h-6 text-white" />
          </Link>
          <span className="text-white text-lg font-semibold">Details</span>
          <div className="w-10" />
        </header>

        <main className="flex-1 min-h-0 overflow-y-auto flex flex-col px-6 pb-6">
          {/* Terminal name */}
          <label className="block rounded-2xl border border-neutral-800 bg-neutral-950 px-4 py-3">
            {draftName !== "" && (
              <span className="block text-neutral-500 text-xs mb-0.5">Terminal name</span>
            )}
            <input
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              maxLength={48}
              placeholder="Terminal name"
              className="w-full bg-transparent text-white text-base outline-none placeholder:text-neutral-500"
            />
          </label>
          <p className="text-neutral-500 text-xs mt-2">
            A label for this device — e.g. &quot;Front counter&quot;.
          </p>

          {/* Terminal ID — read-only */}
          <div className="mt-5 rounded-2xl border border-neutral-800 bg-neutral-900 px-4 py-3 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-neutral-500 text-xs mb-0.5">Terminal ID</p>
              <p className="text-white font-mono text-lg tracking-widest">
                {terminalId ?? "…"}
              </p>
            </div>
            <button
              type="button"
              onClick={handleCopy}
              aria-label="Copy terminal ID"
              className="shrink-0 text-neutral-400 hover:text-white transition"
            >
              {copied ? <Check className="w-5 h-5" /> : <Copy className="w-5 h-5" />}
            </button>
          </div>
          <p className="text-neutral-500 text-xs mt-2">
            Generated once for this device. Shown on receipts and attached to
            payments.
          </p>

          <div className="flex-1" />
          <button
            type="button"
            onClick={handleSave}
            disabled={isLoading || draftName.trim() === name.trim()}
            className="mt-8 w-full bg-white hover:bg-neutral-100 disabled:bg-neutral-900 disabled:text-neutral-600 text-black font-semibold py-4 rounded-2xl transition flex items-center justify-center gap-2"
          >
            {saved ? (
              <>
                <Check className="w-5 h-5" /> Saved
              </>
            ) : (
              "Save"
            )}
          </button>
        </main>
      </div>
    </div>
  );
}
