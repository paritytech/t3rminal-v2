"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ClipboardList,
  KeyRound,
  ReceiptText,
  Shapes,
  UserRound,
} from "lucide-react";
import { useNavHidden } from "@/components/nav-lock";
import { getSetting, setSetting } from "@/lib/storage";
import {
  EMPTY_MERCHANT_PROFILE as EMPTY_PROFILE,
  MERCHANT_PROFILE_KEY as PROFILE_KEY,
  type MerchantProfile,
} from "@/lib/config/merchant";
import { captureError } from "@/lib/telemetry";

/**
 * "Become a Merchant" onboarding: promo carousel → Your details → Receipt
 * details (with a live receipt preview) → Review → Finish. The profile is
 * persisted in host storage under `merchant-profile`; re-entering the flow
 * prefills every field. Opened from the Home tile and the Settings card.
 */

type Step = "promo" | "details" | "receipt" | "review";

const PROMO_SLIDES = [
  {
    icon: Shapes,
    iconBg: "bg-indigo-500",
    title: "Product catalog",
    subtitle: "Add items and check out faster",
  },
  {
    icon: ClipboardList,
    iconBg: "bg-fuchsia-600",
    title: "X & Z reports",
    subtitle: "Close shifts and days with proper reports",
  },
  {
    icon: KeyRound,
    iconBg: "bg-violet-500",
    title: "Terminal lock",
    subtitle: "Protect your terminal with a PIN",
  },
] as const;

export default function MerchantOnboardingPage() {
  const router = useRouter();
  useNavHidden(true);

  const [step, setStep] = useState<Step>("promo");
  const [profile, setProfile] = useState<MerchantProfile>(EMPTY_PROFILE);
  const [saving, setSaving] = useState(false);

  // A completed onboarding re-entering the flow is an EDIT — skip the promo
  // pitch and land straight on the form; back then exits the flow entirely.
  const [editing, setEditing] = useState(false);

  // Prefill from a previously saved profile.
  useEffect(() => {
    getSetting(PROFILE_KEY)
      .then((raw) => {
        if (!raw) return;
        try {
          const stored: MerchantProfile = { ...EMPTY_PROFILE, ...JSON.parse(raw) };
          setProfile(stored);
          if (stored.completedAt) {
            setEditing(true);
            setStep((current) => (current === "promo" ? "details" : current));
          }
        } catch {
          /* corrupt entry — start fresh */
        }
      })
      .catch(() => {});
  }, []);

  const set = (patch: Partial<MerchantProfile>) =>
    setProfile((prev) => ({ ...prev, ...patch }));

  const detailsComplete =
    profile.fullName.trim() !== "" &&
    profile.homeAddress.trim() !== "" &&
    profile.phone.trim() !== "";
  const receiptComplete =
    profile.businessName.trim() !== "" &&
    profile.businessAddress.trim() !== "" &&
    profile.taxId.trim() !== "";

  const handleFinish = async () => {
    setSaving(true);
    try {
      await setSetting(
        PROFILE_KEY,
        JSON.stringify({ ...profile, completedAt: new Date().toISOString() }),
      );
      router.replace("/home");
    } catch (err) {
      captureError(err, { component: "merchant-onboarding", phase: "save" });
      setSaving(false);
    }
  };

  const back = () => {
    if (step === "promo") router.back();
    else if (step === "details") {
      if (editing) router.back();
      else setStep("promo");
    }
    else if (step === "receipt") setStep("details");
    else setStep("receipt");
  };

  const stepIndex = step === "details" ? 0 : step === "receipt" ? 1 : step === "review" ? 2 : -1;
  const headerTitle =
    step === "details" ? "Your details" : step === "receipt" ? "Receipt details" : step === "review" ? "Review" : "";

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex-1 min-h-0 flex flex-col max-w-md mx-auto w-full">
        {/* Header */}
        <header className="flex items-center justify-between px-4 py-4 shrink-0">
          <button onClick={back} className="p-2" aria-label="Back">
            <ArrowLeft className="w-6 h-6 text-white" />
          </button>
          <span className="text-white text-lg font-semibold">{headerTitle}</span>
          <div className="w-10" />
        </header>

        {/* Progress — three segments for the three form steps */}
        {stepIndex >= 0 && (
          <div className="flex gap-3 px-6 pb-5 shrink-0">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className={`h-1 flex-1 rounded-full ${i <= stepIndex ? "bg-white" : "bg-neutral-800"}`}
              />
            ))}
          </div>
        )}

        {step === "promo" && <PromoStep onStart={() => setStep("details")} />}

        {step === "details" && (
          <main className="flex-1 min-h-0 overflow-y-auto flex flex-col px-6 pb-6">
            <h1 className="text-white text-2xl font-bold leading-snug mb-6">
              Add your details to become a merchant
            </h1>
            <div className="space-y-3">
              <Field label="Full name" value={profile.fullName} maxLength={64} onChange={(v) => set({ fullName: v })} />
              <Field label="Home address" value={profile.homeAddress} maxLength={96} onChange={(v) => set({ homeAddress: v })} />
              <Field label="Phone number" value={profile.phone} maxLength={32} inputMode="tel" onChange={(v) => set({ phone: v })} />
              <Field label="Extra Information" value={profile.extra} maxLength={96} onChange={(v) => set({ extra: v })} />
            </div>
            <div className="flex-1" />
            <p className="text-neutral-500 text-sm mb-4 mt-8">
              *Your details are protected and used only to generate your reports
            </p>
            <PrimaryButton disabled={!detailsComplete} onClick={() => setStep("receipt")}>
              Continue
            </PrimaryButton>
          </main>
        )}

        {step === "receipt" && (
          <main className="flex-1 min-h-0 overflow-y-auto flex flex-col px-6 pb-6">
            <h1 className="text-white text-2xl font-bold leading-snug mb-5">
              This is what your customers see on the receipt
            </h1>
            <ReceiptPreview profile={profile} />
            <div className="space-y-3 mt-6">
              <Field label="Business Name" value={profile.businessName} maxLength={64} onChange={(v) => set({ businessName: v })} />
              <Field label="Business Address" value={profile.businessAddress} maxLength={96} onChange={(v) => set({ businessAddress: v })} />
              <Field label="Tax ID" value={profile.taxId} maxLength={32} onChange={(v) => set({ taxId: v })} />
            </div>
            <div className="flex-1" />
            <div className="mt-8">
              <PrimaryButton disabled={!receiptComplete} onClick={() => setStep("review")}>
                Continue
              </PrimaryButton>
            </div>
          </main>
        )}

        {step === "review" && (
          <main className="flex-1 min-h-0 overflow-y-auto flex flex-col px-6 pb-6">
            <h1 className="text-white text-2xl font-bold leading-snug mb-6">
              Check everything&apos;s correct before you finish
            </h1>

            <SectionLabel icon={UserRound} label="Your details" />
            <div className="space-y-3 mb-7">
              <ReadonlyField label="Full name" value={profile.fullName} />
              <ReadonlyField label="Home address" value={profile.homeAddress} />
              <ReadonlyField label="Phone number" value={profile.phone} />
              <ReadonlyField label="Extra Information" value={profile.extra} />
            </div>

            <SectionLabel icon={ReceiptText} label="Receipt details" />
            <div className="space-y-3">
              <ReadonlyField label="Business Name" value={profile.businessName} />
              <ReadonlyField label="Address" value={profile.businessAddress} />
              <ReadonlyField label="Tax ID" value={profile.taxId} />
            </div>

            <div className="flex-1" />
            <div className="mt-8">
              <PrimaryButton disabled={saving} onClick={handleFinish}>
                {saving ? "Saving…" : "Finish"}
              </PrimaryButton>
            </div>
          </main>
        )}
      </div>
    </div>
  );
}

/* ── Promo step ─────────────────────────────────────────────────── */

function PromoStep({ onStart }: { onStart: () => void }) {
  const [slide, setSlide] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setSlide((s) => (s + 1) % PROMO_SLIDES.length), 4000);
    return () => clearInterval(id);
  }, []);

  const active = PROMO_SLIDES[slide];
  const Icon = active.icon;

  return (
    <main className="flex-1 min-h-0 overflow-y-auto flex flex-col px-6 pb-6">
      <div className="text-center mb-6">
        <p className="text-neutral-400 text-sm mb-1">Become a merchant</p>
        <h1 className="text-white text-2xl font-bold leading-snug">
          Unlock tools to run your business
        </h1>
      </div>

      {/* Phone-frame preview (placeholder skeleton per slide) */}
      <div className="flex-1 min-h-0 flex items-center justify-center mb-6">
        <div className="w-56 max-h-full aspect-[9/16] rounded-[2rem] border border-neutral-700 bg-neutral-950 p-4 flex flex-col gap-3 overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="w-10 h-2 rounded bg-neutral-800" />
            <span className="w-6 h-2 rounded bg-neutral-800" />
          </div>
          <div className={`w-10 h-10 rounded-xl ${active.iconBg} flex items-center justify-center`}>
            <Icon className="w-5 h-5 text-white" />
          </div>
          <span className="w-3/4 h-3 rounded bg-neutral-800" />
          <span className="w-1/2 h-3 rounded bg-neutral-800" />
          <div className="grid grid-cols-3 gap-2 mt-2">
            {Array.from({ length: 6 }, (_, i) => (
              <span key={i} className="aspect-square rounded-lg bg-neutral-900 border border-neutral-800" />
            ))}
          </div>
        </div>
      </div>

      {/* Caption + dots */}
      <div className="flex items-center gap-3 mb-6">
        <div className={`w-11 h-11 rounded-full ${active.iconBg} flex items-center justify-center shrink-0`}>
          <Icon className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-neutral-400 text-sm">{active.title}</p>
          <p className="text-white font-semibold leading-tight">{active.subtitle}</p>
        </div>
        <div className="flex gap-1.5 shrink-0">
          {PROMO_SLIDES.map((_, i) => (
            <button
              key={i}
              onClick={() => setSlide(i)}
              aria-label={`Slide ${i + 1}`}
              className={`h-1.5 rounded-full transition-all ${i === slide ? "w-5 bg-white" : "w-1.5 bg-neutral-600"}`}
            />
          ))}
        </div>
      </div>

      <PrimaryButton onClick={onStart}>Become a Merchant</PrimaryButton>
      {/* Placeholder — multi-terminal onboarding isn't built yet. */}
      <button
        type="button"
        className="w-full mt-3 bg-neutral-900 hover:bg-neutral-800 text-white font-medium py-4 rounded-2xl transition"
      >
        Need more sales points?
      </button>
    </main>
  );
}

/* ── Receipt preview ────────────────────────────────────────────── */

function ReceiptPreview({ profile }: { profile: MerchantProfile }) {
  const sample = useMemo(
    () => [
      ["Order:", "#4S0X"],
      ["Date:", "2026/07/06 15:25"],
      ["Terminal", "DA01"],
      ["Merchant ID", "fankhaus"],
    ],
    [],
  );
  const named = profile.businessName.trim() !== "";

  return (
    <div className="bg-white rounded-2xl px-5 pt-5 pb-6 font-mono text-sm shrink-0">
      <p className={`text-center font-bold ${named ? "text-black" : "text-neutral-800"}`}>
        {profile.businessName.trim() || "Business Name"}
      </p>
      <p className={`text-center ${profile.businessAddress.trim() ? "text-black" : "text-neutral-500"}`}>
        {profile.businessAddress.trim() || "Business Address"}
      </p>
      <p className={`text-center mb-4 ${profile.taxId.trim() ? "text-black" : "text-neutral-500"}`}>
        {profile.taxId.trim() || "TAX ID"}
      </p>
      {sample.map(([label, value]) => (
        <div key={label} className="flex justify-between text-neutral-400">
          <span>{label}</span>
          <span>{value}</span>
        </div>
      ))}
    </div>
  );
}

/* ── Shared bits ────────────────────────────────────────────────── */

function PrimaryButton({
  children,
  onClick,
  disabled = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="w-full bg-white hover:bg-neutral-100 disabled:bg-neutral-900 disabled:text-neutral-600 text-black font-semibold py-4 rounded-2xl transition"
    >
      {children}
    </button>
  );
}

function SectionLabel({ icon: Icon, label }: { icon: typeof UserRound; label: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <Icon className="w-5 h-5 text-white" />
      <span className="text-white font-semibold">{label}</span>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  maxLength,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  maxLength: number;
  inputMode?: "tel";
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
        inputMode={inputMode}
        className="w-full bg-transparent text-white text-base outline-none placeholder:text-neutral-500"
      />
    </label>
  );
}

function ReadonlyField({ label, value }: { label: string; value: string }) {
  const filled = value.trim() !== "";
  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-900 px-4 py-3">
      {filled ? (
        <>
          <p className="text-neutral-500 text-xs mb-0.5">{label}</p>
          <p className="text-white">{value}</p>
        </>
      ) : (
        <p className="text-neutral-500">{label}</p>
      )}
    </div>
  );
}
