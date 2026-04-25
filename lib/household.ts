// Pure household resolution. No React, no client-only imports — safe to use
// from Node scripts (migration, etc.) as well as from the app.

import { getBabyForEmail, getAllowedEmails } from "./baby";

// The household id is the same as baby.id for now — one baby per household.
// A future invite flow could split these (one household → multiple babies, or
// share one baby across households), but the current schema doesn't need it.

export function getHouseholdIdForEmail(
  email: string | null | undefined,
): string | null {
  if (!email) return null;
  return getBabyForEmail(email).id;
}

export type HouseholdSeed = {
  hid: string;
  babyName: string;
  babyFullName?: string;
  babyBirthdate: Date;
  memberEmails: string[];
};

export function getAllHouseholdSeeds(): HouseholdSeed[] {
  const seeds = new Map<string, HouseholdSeed>();
  for (const email of getAllowedEmails()) {
    const baby = getBabyForEmail(email);
    const existing = seeds.get(baby.id);
    if (existing) {
      existing.memberEmails.push(email);
    } else {
      seeds.set(baby.id, {
        hid: baby.id,
        babyName: baby.name,
        babyFullName: baby.fullName,
        babyBirthdate: baby.birthdate,
        memberEmails: [email],
      });
    }
  }
  return Array.from(seeds.values());
}
