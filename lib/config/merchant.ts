"use client";

/**
 * Merchant onboarding profile (Become a Merchant flow). Stored as one JSON
 * settings entry; `completedAt` marks a finished onboarding and is what the
 * Home tile / Settings entries key off.
 */

import { useEffect, useState } from "react";
import { getSetting, setSetting } from "@/lib/storage";
import { onStorageChange } from "@/lib/storage/host-storage";
import type { BusinessProfile } from "@/lib/config/business";

export const MERCHANT_PROFILE_KEY = "merchant-profile";

export interface MerchantProfile {
  fullName: string;
  homeAddress: string;
  phone: string;
  extra: string;
  businessName: string;
  businessAddress: string;
  taxId: string;
  completedAt?: string;
}

export const EMPTY_MERCHANT_PROFILE: MerchantProfile = {
  fullName: "",
  homeAddress: "",
  phone: "",
  extra: "",
  businessName: "",
  businessAddress: "",
  taxId: "",
};

/** Live view of the stored profile — re-reads on any settings-table write. */
export function useMerchantProfile() {
  const [profile, setProfile] = useState<MerchantProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    const load = () =>
      getSetting(MERCHANT_PROFILE_KEY)
        .then((raw) => {
          if (!mounted) return;
          try {
            setProfile(raw ? { ...EMPTY_MERCHANT_PROFILE, ...JSON.parse(raw) } : null);
          } catch {
            setProfile(null);
          }
          setIsLoading(false);
        })
        .catch(() => {
          if (mounted) setIsLoading(false);
        });
    void load();
    const unsubscribe = onStorageChange("settings", () => void load());
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  return { profile, completed: Boolean(profile?.completedAt), isLoading };
}

/** Read-merge-write a partial update without clobbering the rest. */
export async function updateMerchantProfile(patch: Partial<MerchantProfile>): Promise<void> {
  const raw = await getSetting(MERCHANT_PROFILE_KEY);
  let existing = EMPTY_MERCHANT_PROFILE;
  if (raw) {
    try {
      existing = { ...EMPTY_MERCHANT_PROFILE, ...JSON.parse(raw) };
    } catch {
      /* corrupt entry — overwrite */
    }
  }
  await setSetting(MERCHANT_PROFILE_KEY, JSON.stringify({ ...existing, ...patch }));
}

/**
 * Receipt-facing business identity: the merchant profile's receipt details
 * override the admin-QR-derived profile field by field, so an edit in
 * Settings → Receipt (or onboarding) shows up on every receipt, deeplink and
 * print. Falls back to `base` while nothing is filled in.
 */
export function mergeMerchantBusinessProfile(
  base: BusinessProfile,
  profile: MerchantProfile | null,
): BusinessProfile {
  if (!profile) return base;
  const name = profile.businessName.trim();
  const address = profile.businessAddress.trim();
  const taxId = profile.taxId.trim();
  if (!name && !address && !taxId) return base;
  return {
    ...base,
    name: name || base.name,
    addressLine1: address || base.addressLine1,
    // The receipt renders addressLine2 as the third centered header line —
    // the natural slot for the Tax ID until BusinessProfile grows a field.
    addressLine2: taxId || base.addressLine2,
    phone: profile.phone.trim() || base.phone,
  };
}
