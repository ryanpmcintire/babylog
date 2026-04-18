import { Timestamp } from "firebase/firestore";

export type EventType =
  | "breast_feed"
  | "bottle_feed"
  | "pump"
  | "diaper_wet"
  | "diaper_dirty"
  | "sleep_start"
  | "sleep_end";

export type BreastFeedOutcome =
  | "latched_fed"
  | "latched_brief"
  | "no_latch";

export type MilkType = "mom_pumped" | "donor" | "formula";

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
    | { type: "breast_feed"; outcome: BreastFeedOutcome }
    | { type: "bottle_feed"; volume_ml: number; milk_types: MilkType[] }
    | { type: "pump"; volume_ml: number }
    | { type: "diaper_wet" }
    | { type: "diaper_dirty" }
    | { type: "sleep_start" }
    | { type: "sleep_end" }
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
