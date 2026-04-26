import { Timestamp } from "firebase/firestore";

export type EventType =
  | "breast_feed"
  | "bottle_feed"
  | "pump"
  | "diaper_wet"
  | "diaper_dirty"
  | "diaper_mixed"
  | "sleep_start"
  | "sleep_end"
  | "weight"
  | "book_read"
  | "food_tried"
  | "medication"
  | "temperature";

export type FoodReaction = "loved" | "liked" | "neutral" | "disliked";

export type TempMethod = "forehead" | "ear" | "rectal" | "armpit";

export const TEMP_METHODS: { value: TempMethod; label: string }[] = [
  { value: "forehead", label: "Forehead" },
  { value: "ear", label: "Ear" },
  { value: "armpit", label: "Armpit" },
  { value: "rectal", label: "Rectal" },
];

// Cutoffs the AAP uses for "call the pediatrician" — drives color coding.
// Under 3 months: any fever >= 100.4°F is urgent; otherwise the threshold rises with age.
export const FEVER_THRESHOLD_F = 100.4;
export const HIGH_FEVER_THRESHOLD_F = 102.2;

// Common-medication presets shown as quick-pick chips. Doses are deliberately
// blank for weight-dosed meds (Tylenol/Motrin) — a wrong default is worse than
// no default. Cadence drives the daily-adherence card behavior.
export type MedCadence = "daily" | "prn";

export type CommonMed = {
  name: string;
  defaultDose?: string;
  cadence: MedCadence;
  // Earliest age in days the med is generally appropriate (AAP guidance).
  // Just used to soft-warn or de-prioritize, never block.
  minAgeDays?: number;
};

export const COMMON_MEDS: CommonMed[] = [
  { name: "Vitamin D", defaultDose: "400 IU", cadence: "daily" },
  { name: "Probiotic", defaultDose: "1 dropper", cadence: "daily" },
  { name: "Gas drops", defaultDose: "0.3 mL", cadence: "prn" },
  { name: "Tylenol", cadence: "prn" },
  { name: "Motrin", cadence: "prn", minAgeDays: 180 },
  { name: "Saline drops", cadence: "prn" },
];

// Match a free-text med name against the COMMON_MEDS list (case-insensitive,
// fuzzy on common synonyms). Returns the canonical name if matched.
export function canonicalMedName(name: string): string | null {
  const n = name.trim().toLowerCase();
  if (!n) return null;
  if (n.includes("vit") && n.includes("d")) return "Vitamin D";
  if (n.includes("probiotic")) return "Probiotic";
  if (n.includes("mylicon") || (n.includes("gas") && n.includes("drop")))
    return "Gas drops";
  if (n.includes("tylenol") || n.includes("acetaminophen"))
    return "Tylenol";
  if (n.includes("motrin") || n.includes("ibuprofen") || n.includes("advil"))
    return "Motrin";
  if (n.includes("saline")) return "Saline drops";
  return null;
}

export function lookupCommonMed(name: string): CommonMed | null {
  const canonical = canonicalMedName(name) ?? name.trim();
  return (
    COMMON_MEDS.find(
      (m) => m.name.toLowerCase() === canonical.toLowerCase(),
    ) ?? null
  );
}

export type BreastFeedOutcome =
  | "latched_fed"
  | "latched_brief"
  | "no_latch";

export type MilkType = "mom_pumped" | "donor" | "formula";

export type Side = "left" | "right" | "both";

export const SIDES: { value: Side; label: string; short: string }[] = [
  { value: "left", label: "Left", short: "L" },
  { value: "right", label: "Right", short: "R" },
  { value: "both", label: "Both", short: "L+R" },
];

export function sideLabel(side: Side | undefined): string {
  if (!side) return "";
  return side === "left" ? "L" : side === "right" ? "R" : "L+R";
}

type BaseEvent = {
  id: string;
  created_by: string;
  created_by_email?: string;
  created_at: Timestamp;
  updated_at?: Timestamp;
  deleted?: boolean;
  occurred_at: Timestamp;
};

export type BabyEvent = BaseEvent &
  (
    | { type: "breast_feed"; outcome: BreastFeedOutcome; side?: Side }
    | { type: "bottle_feed"; volume_ml: number; milk_types: MilkType[] }
    | { type: "pump"; volume_ml: number; side?: Side }
    | { type: "diaper_wet" }
    | { type: "diaper_dirty" }
    | { type: "diaper_mixed" }
    | { type: "sleep_start" }
    | { type: "sleep_end" }
    | { type: "weight"; weight_grams: number; notes?: string }
    | {
        type: "book_read";
        title: string;
        author?: string;
        cover_url?: string;
        open_library_key?: string;
      }
    | {
        type: "food_tried";
        food_name: string;
        reaction?: FoodReaction;
        first_try?: boolean;
        notes?: string;
      }
    | {
        type: "medication";
        name: string;
        dose?: string;
        notes?: string;
      }
    | {
        type: "temperature";
        temp_f: number;
        method?: TempMethod;
        notes?: string;
      }
  );

export const BREAST_OUTCOMES: {
  value: BreastFeedOutcome;
  label: string;
}[] = [
  { value: "latched_fed", label: "Latched & fed" },
  { value: "latched_brief", label: "Latched briefly" },
  { value: "no_latch", label: "Didn't latch" },
];

export const MILK_TYPES: { value: MilkType; label: string }[] = [
  { value: "mom_pumped", label: "Mom" },
  { value: "donor", label: "Donor" },
  { value: "formula", label: "Formula" },
];

export const VOLUME_PRESETS_ML: number[] = [30, 60, 90, 120, 150];

export function formatWeightGrams(g: number): string {
  const pounds = g / 453.59237;
  const totalOz = g / 28.349523125;
  const lb = Math.floor(pounds);
  const oz = Math.round(totalOz - lb * 16);
  const oz16 = oz === 16 ? 0 : oz;
  const lbOut = oz === 16 ? lb + 1 : lb;
  return `${lbOut} lb ${oz16} oz (${g.toLocaleString()} g)`;
}
