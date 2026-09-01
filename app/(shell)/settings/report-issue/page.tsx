"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Check,
  Image as ImageIcon,
  Paperclip,
  ScrollText,
  Trash2,
  X,
} from "lucide-react";
import * as Sentry from "@sentry/nextjs";
import { formatLogsAsText } from "@/lib/debug/log-capture";

/**
 * Settings → Help us fix an issue: a user problem report. Description +
 * optional screenshots + optional technical details (the captured console
 * log) are sent as one Sentry event with attachments. The logs icon in the
 * header opens the raw log list (/settings/logs).
 */

const MAX_DESCRIPTION = 1200;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ACCEPTED_TYPES = ["image/png", "image/jpeg"];

interface Attachment {
  file: File;
  id: string;
}

type SendState = "form" | "sending" | "error" | "success";

function formatSize(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / (1024 * 1024)))} MB`;
}

export default function ReportIssuePage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [description, setDescription] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [includeTechnical, setIncludeTechnical] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [sendState, setSendState] = useState<SendState>("form");

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    setFileError(null);
    const next: Attachment[] = [];
    for (const file of Array.from(list)) {
      if (!ACCEPTED_TYPES.includes(file.type)) {
        setFileError(`${file.name}: only PNG or JPG screenshots are supported.`);
        continue;
      }
      if (file.size > MAX_FILE_BYTES) {
        setFileError(`${file.name}: larger than 10 MB.`);
        continue;
      }
      next.push({ file, id: `${file.name}-${file.size}-${file.lastModified}` });
    }
    setAttachments((prev) => {
      const seen = new Set(prev.map((a) => a.id));
      return [...prev, ...next.filter((a) => !seen.has(a.id))];
    });
  };

  const handleSend = async () => {
    setSendState("sending");
    try {
      const fileBuffers = await Promise.all(
        attachments.map(async ({ file }) => ({
          filename: file.name,
          data: new Uint8Array(await file.arrayBuffer()),
        })),
      );

      Sentry.withScope((scope) => {
        scope.setTag("report.kind", "user-report");
        scope.setExtra("description", description);
        for (const attachment of fileBuffers) scope.addAttachment(attachment);
        if (includeTechnical) {
          scope.addAttachment({ filename: "console-logs.txt", data: formatLogsAsText() });
        }
        Sentry.captureMessage(
          `User report: ${description.slice(0, 120)}`,
          "info",
        );
      });

      // flush() actually pushes the event out — its result is the only real
      // "did it leave the device" signal we have.
      const flushed = await Sentry.flush(5000);
      setSendState(flushed ? "success" : "error");
    } catch {
      setSendState("error");
    }
  };

  /* ── Sending / outcome overlays ─────────────────────────────── */

  if (sendState === "sending") {
    return (
      <FullScreen>
        <div className="w-10 h-10 rounded-full border-2 border-neutral-700 border-t-white animate-spin mb-6" />
        <p className="text-white text-2xl font-semibold">Sending…</p>
      </FullScreen>
    );
  }

  if (sendState === "error") {
    return (
      <FullScreen onClose={() => setSendState("form")}>
        <div className="w-14 h-14 rounded-full bg-red-500 flex items-center justify-center mb-6">
          <X className="w-7 h-7 text-white" strokeWidth={3} />
        </div>
        <p className="text-white text-2xl font-semibold text-center mb-10">
          Couldn&apos;t send.
          <br />
          Try again
        </p>
        <div className="flex-1" />
        <button
          onClick={handleSend}
          className="w-full bg-white hover:bg-neutral-100 text-black font-semibold py-4 rounded-2xl transition"
        >
          Retry
        </button>
      </FullScreen>
    );
  }

  if (sendState === "success") {
    return (
      <FullScreen onClose={() => router.push("/settings")}>
        <div className="w-14 h-14 rounded-full bg-green-500 flex items-center justify-center mb-6">
          <Check className="w-7 h-7 text-white" strokeWidth={3} />
        </div>
        <p className="text-white text-2xl font-semibold text-center mb-10">
          Thanks! for your feedback we&apos;ll look into it
        </p>
        <div className="flex-1" />
        <button
          onClick={() => router.push("/settings")}
          className="w-full bg-white hover:bg-neutral-100 text-black font-semibold py-4 rounded-2xl transition"
        >
          Done
        </button>
      </FullScreen>
    );
  }

  /* ── Form ───────────────────────────────────────────────────── */

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex-1 min-h-0 flex flex-col max-w-md mx-auto w-full">
        {/* Header — logs shortcut on the right */}
        <header className="flex items-center justify-between px-4 py-4 shrink-0">
          <Link href="/settings" className="p-2" aria-label="Back to settings">
            <ArrowLeft className="w-6 h-6 text-white" />
          </Link>
          <span className="text-white text-lg font-semibold">Report a problem</span>
          <Link href="/settings/logs" className="p-2" aria-label="View logs">
            <ScrollText className="w-6 h-6 text-white" />
          </Link>
        </header>

        <main className="flex-1 min-h-0 overflow-y-auto flex flex-col px-6 pb-6">
          <h1 className="text-white text-2xl font-bold leading-snug">Describe what happened</h1>
          <p className="text-neutral-400 text-sm mb-4">
            What were you doing when it went wrong?
          </p>

          {/* Description */}
          <div className="rounded-2xl border border-neutral-800 bg-neutral-950 px-4 py-3">
            <div className="flex justify-between text-neutral-500 text-xs mb-1">
              <span>Tell us what happened…</span>
              <span>
                {description.length}/{MAX_DESCRIPTION}
              </span>
            </div>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={MAX_DESCRIPTION}
              rows={5}
              className="w-full bg-transparent text-white text-base outline-none resize-none placeholder:text-neutral-600"
            />
          </div>

          {/* Screenshots */}
          <div className="mt-4 rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
            <div className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-white font-semibold">Add screenshot</p>
                <p className="text-neutral-400 text-sm mt-0.5">
                  Add a screenshot to help us understand (PNG or JPG, max 10 MB)
                </p>
              </div>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                aria-label="Attach screenshot"
                className="shrink-0 p-2 text-neutral-300 hover:text-white transition"
              >
                <Paperclip className="w-5 h-5" />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED_TYPES.join(",")}
                multiple
                hidden
                onChange={(e) => {
                  addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </div>

            {attachments.length > 0 && (
              <div className="mt-3 space-y-2">
                {attachments.map(({ file, id }) => (
                  <div
                    key={id}
                    className="flex items-center gap-3 rounded-xl bg-neutral-900 px-3 py-2.5"
                  >
                    <ImageIcon className="w-5 h-5 text-neutral-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-sm truncate">{file.name}</p>
                      <p className="text-neutral-500 text-xs">{formatSize(file.size)}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setAttachments((prev) => prev.filter((a) => a.id !== id))
                      }
                      aria-label={`Remove ${file.name}`}
                      className="shrink-0 text-red-500 hover:text-red-400 transition"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {fileError && <p className="text-red-400 text-xs mt-2">{fileError}</p>}
          </div>

          {/* Technical details */}
          <button
            type="button"
            onClick={() => setIncludeTechnical((v) => !v)}
            className="mt-4 rounded-2xl border border-neutral-800 bg-neutral-950 p-4 flex items-start gap-3 text-left"
          >
            <div className="flex-1 min-w-0">
              <p className="text-white font-semibold">Include technical details</p>
              <p className="text-neutral-400 text-sm mt-0.5">
                Helps us find the problem faster. No personal data is shared
              </p>
            </div>
            <span
              className={`shrink-0 w-6 h-6 rounded-md border flex items-center justify-center transition ${
                includeTechnical ? "bg-white border-white" : "border-neutral-600"
              }`}
            >
              {includeTechnical && <Check className="w-4 h-4 text-black" strokeWidth={3} />}
            </span>
          </button>

          <div className="flex-1" />
          <button
            type="button"
            onClick={handleSend}
            disabled={description.trim() === ""}
            className="mt-8 w-full bg-white hover:bg-neutral-100 disabled:bg-neutral-900 disabled:text-neutral-600 text-black font-semibold py-4 rounded-2xl transition"
          >
            Send
          </button>
        </main>
      </div>
    </div>
  );
}

function FullScreen({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose?: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex-1 min-h-0 flex flex-col max-w-md mx-auto w-full">
        <header className="flex items-center px-4 py-4 shrink-0">
          {onClose && (
            <button onClick={onClose} className="p-2" aria-label="Close">
              <X className="w-6 h-6 text-white" />
            </button>
          )}
        </header>
        <main className="flex-1 flex flex-col items-center justify-center px-6 pb-10">
          {children}
        </main>
      </div>
    </div>
  );
}
