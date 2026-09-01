"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import {
  EMPTY_MERCHANT_PROFILE,
  MERCHANT_PROFILE_KEY,
  type MerchantProfile,
  updateMerchantProfile,
} from "@/lib/config/merchant";
import { getSetting } from "@/lib/storage";
import { captureError } from "@/lib/telemetry";

/**
 * Settings → Receipt: edit the receipt-facing business identity with a live
 * receipt preview, then confirm on a full sample receipt. Writes the same
 * stored merchant profile the onboarding flow uses, so a change here shows up
 * on every receipt, payment deeplink and print.
 */

type Step = "edit" | "preview";

export default function ReceiptSettingsPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("edit");
  const [businessName, setBusinessName] = useState("");
  const [businessAddress, setBusinessAddress] = useState("");
  const [taxId, setTaxId] = useState("");
  const [saving, setSaving] = useState(false);

  // Prefill from the stored merchant profile (shared with onboarding).
  useEffect(() => {
    getSetting(MERCHANT_PROFILE_KEY)
      .then((raw) => {
        if (!raw) return;
        try {
          const profile: MerchantProfile = { ...EMPTY_MERCHANT_PROFILE, ...JSON.parse(raw) };
          setBusinessName(profile.businessName);
          setBusinessAddress(profile.businessAddress);
          setTaxId(profile.taxId);
        } catch {
          /* corrupt entry — start fresh */
        }
      })
      .catch(() => {});
  }, []);

  const complete =
    businessName.trim() !== "" && businessAddress.trim() !== "" && taxId.trim() !== "";

  const handleNext = async () => {
    setSaving(true);
    try {
      await updateMerchantProfile({
        businessName: businessName.trim(),
        businessAddress: businessAddress.trim(),
        taxId: taxId.trim(),
      });
      setStep("preview");
    } catch (err) {
      captureError(err, { component: "receipt-settings", phase: "save" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex-1 min-h-0 flex flex-col max-w-md mx-auto w-full">
        {/* Header */}
        <header className="flex items-center justify-between px-4 py-4 shrink-0">
          <button
            onClick={() => (step === "preview" ? setStep("edit") : router.push("/settings"))}
            className="p-2"
            aria-label="Back"
          >
            <ArrowLeft className="w-6 h-6 text-white" />
          </button>
          <span className="text-white text-lg font-semibold">
            {step === "edit" ? "Receipt" : "Preview"}
          </span>
          <div className="w-10" />
        </header>

        {step === "edit" ? (
          <main className="flex-1 min-h-0 overflow-y-auto flex flex-col px-6 pb-6">
            {/* Live receipt header preview */}
            <div className="bg-white rounded-2xl px-5 pt-5 pb-6 font-mono text-sm shrink-0">
              <p className={`text-center font-bold ${businessName.trim() ? "text-black" : "text-neutral-700"}`}>
                {businessName.trim() || "Name on receipt"}
              </p>
              <p className={`text-center ${businessAddress.trim() ? "text-black" : "text-neutral-500"}`}>
                {businessAddress.trim() || "Extra Information"}
              </p>
              {taxId.trim() && <p className="text-center text-black">{taxId.trim()}</p>}
              <div className="mt-4 space-y-0.5">
                {[
                  ["Order:", "#4S0X"],
                  ["Date:", "2026/07/06 15:25"],
                  ["Terminal", "DA01"],
                  ["Merchant ID", "fankhaus"],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between text-neutral-400">
                    <span>{label}</span>
                    <span>{value}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Fields */}
            <div className="space-y-3 mt-6">
              <Field label="Business Name" value={businessName} maxLength={64} onChange={setBusinessName} />
              <Field label="Business Address" value={businessAddress} maxLength={96} onChange={setBusinessAddress} />
              <Field label="Tax ID" value={taxId} maxLength={32} onChange={setTaxId} />
            </div>

            <div className="flex-1" />
            <button
              type="button"
              onClick={handleNext}
              disabled={!complete || saving}
              className="mt-8 w-full bg-white hover:bg-neutral-100 disabled:bg-neutral-900 disabled:text-neutral-600 text-black font-semibold py-4 rounded-2xl transition"
            >
              {saving ? "Saving…" : "Next"}
            </button>
          </main>
        ) : (
          <main className="flex-1 min-h-0 overflow-y-auto flex flex-col px-6 pb-6">
            {/* Full sample receipt */}
            <div className="bg-white rounded-2xl px-5 pt-5 pb-6 font-mono text-sm shrink-0">
              <p className="text-center font-bold text-black">{businessName.trim()}</p>
              <p className="text-center text-black">{businessAddress.trim()}</p>
              <p className="text-center text-black">{taxId.trim()}</p>

              <div className="mt-4 space-y-0.5 text-black">
                {[
                  ["Order:", "#1111"],
                  ["Date:", "2026/07/06 15:25"],
                  ["Terminal", "DA01"],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between">
                    <span>{label}</span>
                    <span>{value}</span>
                  </div>
                ))}
              </div>

              <p className="text-neutral-400 mt-3 select-none overflow-hidden whitespace-nowrap">
                {"- ".repeat(40)}
              </p>
              <div className="flex justify-between text-black">
                <span>Item</span>
                <span>Price in USD</span>
              </div>
              <div className="flex justify-between text-black">
                <span>1x Example</span>
                <span className="font-bold">1.00</span>
              </div>
              <p className="text-neutral-400 select-none overflow-hidden whitespace-nowrap">
                {"- ".repeat(40)}
              </p>
              <div className="flex justify-between text-black font-bold text-base mt-1">
                <span>Total</span>
                <span>1.00 USD</span>
              </div>

              <div className="flex justify-center mt-4">
                <QRCodeSVG value="t3rminal-receipt-sample" size={88} level="L" />
              </div>
            </div>

            <div className="flex-1" />
            <div className="flex gap-3 mt-8">
              <button
                type="button"
                onClick={() => setStep("edit")}
                className="flex-1 bg-neutral-900 hover:bg-neutral-800 text-white font-semibold py-4 rounded-2xl transition"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => router.push("/settings")}
                className="flex-1 bg-white hover:bg-neutral-100 text-black font-semibold py-4 rounded-2xl transition"
              >
                Done
              </button>
            </div>
          </main>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  maxLength: number;
}) {
  const filled = value !== "";
  return (
    <label className="block rounded-2xl border border-neutral-800 bg-neutral-950 px-4 py-3">
      {filled && (
        <span className="flex justify-between text-neutral-500 text-xs mb-0.5">
          <span>{label}</span>
          <span>
            {value.length}/{maxLength}
          </span>
        </span>
      )}
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={maxLength}
        placeholder={label}
        className="w-full bg-transparent text-white text-base outline-none placeholder:text-neutral-500"
      />
    </label>
  );
}
