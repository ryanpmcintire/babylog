"use client";

import { useMemo } from "react";
import { useAuth } from "@/app/providers";

export type BabyProfile = {
  id: string;
  name: string;
  fullName?: string;
  birthdate: Date;
};

// --- Household config ---------------------------------------------------
//
// Phase A: Adding a new family is just adding a BabyProfile here and mapping
// each member's email to its id. This is the single source of truth for
// who is in the app; `allowlist.ts` derives from it, and every component
// reads the active baby via `useBaby()` rather than hardcoded constants.
//
// Phase B (later): this entire table moves into Firestore as a `households`
// collection and the resolve step becomes a doc read keyed on the signed-in
// user's uid.
// -----------------------------------------------------------------------

const BABIES: Record<string, BabyProfile> = {
  mcintire: {
    id: "mcintire",
    name: "Lily",
    fullName: "Lily Patricia McIntire",
    birthdate: new Date("2026-04-09T02:25:00-05:00"),
  },
};

const EMAIL_TO_BABY: Record<string, string> = {
  "ryanpmcintire@gmail.com": "mcintire",
  "kellynmelanson@gmail.com": "mcintire",
};

// Fallback used while auth is resolving or if a new allowed user hasn't yet
// been mapped to a baby. Keeps the UI stable instead of crashing.
const DEFAULT_BABY: BabyProfile = BABIES.mcintire!;

export function getBabyForEmail(
  email: string | null | undefined,
): BabyProfile {
  if (!email) return DEFAULT_BABY;
  const babyId = EMAIL_TO_BABY[email.toLowerCase().trim()];
  if (!babyId) return DEFAULT_BABY;
  return BABIES[babyId] ?? DEFAULT_BABY;
}

export function useBaby(): BabyProfile {
  const { user } = useAuth();
  return useMemo(
    () => getBabyForEmail(user?.email ?? null),
    [user?.email],
  );
}

export function getAllowedEmails(): readonly string[] {
  return Object.freeze(Object.keys(EMAIL_TO_BABY));
}
