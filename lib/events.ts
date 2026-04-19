import { Timestamp } from "firebase/firestore";

export type EventType =
  | "breast_feed"
  | "bottle_feed"
  | "pump"
  | "diaper_wet"
  | "diaper_dirty"
  | "sleep_start"
  | "sleep_end"
  | "book_read"
  | "food_tried";

export type FoodReaction = "loved" | "liked" | "neutral" | "disliked";

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
