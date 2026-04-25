// Pure baby/household config. No React, no client-only imports — safe to use
// from Node scripts (migration, etc.) as well as from the app. The React
// hook lives in useBaby.ts.

export type BabyProfile = {
  id: string;
  name: string;
  fullName?: string;
  birthdate: Date;
};

// --- Household config ---------------------------------------------------
//
// Adding a new family is just adding a BabyProfile here and mapping each
// member's email to its id. Single source of truth for who is in the app;
// `allowlist.ts` derives from it.
//
// In Phase B, this still drives household IDs — `lib/household.ts` builds
// `households/{baby.id}` Firestore docs from this table at migration time,
// and the rules check membership via the doc's `member_emails` array.
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

export function getAllowedEmails(): readonly string[] {
  return Object.freeze(Object.keys(EMAIL_TO_BABY));
}
