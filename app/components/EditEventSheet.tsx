"use client";

import { useState, type ReactNode } from "react";
import type { BabyEvent, BreastFeedOutcome, FoodReaction, MilkType, Side, TempMethod } from "@/lib/events";
import {
  BREAST_OUTCOMES,
  MILK_TYPES,
  SIDES,
  TEMP_METHODS,
} from "@/lib/events";
import { updateEvent, type NewEventPayload } from "@/lib/useEvents";

function toLocalInput(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const FOOD_REACTIONS: { value: FoodReaction; label: string }[] = [
  { value: "loved", label: "Loved" },
  { value: "liked", label: "Liked" },
  { value: "neutral", label: "Neutral" },
  { value: "disliked", label: "Disliked" },
];

export function EditEventSheet({
  event,
  onClose,
}: {
  event: BabyEvent;
  onClose: () => void;
}) {
  const [when, setWhen] = useState(toLocalInput(event.occurred_at.toDate()));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Type-specific state
  const [breastOutcome, setBreastOutcome] = useState<BreastFeedOutcome | null>(
    event.type === "breast_feed" ? event.outcome : null,
  );
  const [breastSide, setBreastSide] = useState<Side | null>(
    event.type === "breast_feed" ? (event.side ?? null) : null,
  );

  const [bottleMl, setBottleMl] = useState(
    event.type === "bottle_feed" ? String(event.volume_ml) : "",
  );
  const [bottleMilk, setBottleMilk] = useState<MilkType[]>(
    event.type === "bottle_feed" ? event.milk_types : [],
  );

  const [pumpMl, setPumpMl] = useState(
    event.type === "pump" ? String(event.volume_ml) : "",
  );
  const [pumpSide, setPumpSide] = useState<Side | null>(
    event.type === "pump" ? (event.side ?? null) : null,
  );

  const [diaperType, setDiaperType] = useState<"diaper_wet" | "diaper_dirty">(
    event.type === "diaper_wet" || event.type === "diaper_dirty"
      ? event.type
      : "diaper_wet",
  );

  const [weightG, setWeightG] = useState(
    event.type === "weight" ? String(event.weight_grams) : "",
  );

  const [bookTitle, setBookTitle] = useState(
    event.type === "book_read" ? event.title : "",
  );
  const [bookAuthor, setBookAuthor] = useState(
    event.type === "book_read" ? (event.author ?? "") : "",
  );

  const [foodName, setFoodName] = useState(
    event.type === "food_tried" ? event.food_name : "",
  );
  const [foodReaction, setFoodReaction] = useState<FoodReaction | null>(
    event.type === "food_tried" ? (event.reaction ?? null) : null,
  );
  const [foodFirstTry, setFoodFirstTry] = useState(
    event.type === "food_tried" ? !!event.first_try : false,
  );

  const [medName, setMedName] = useState(
    event.type === "medication" ? event.name : "",
  );
  const [medDose, setMedDose] = useState(
    event.type === "medication" ? (event.dose ?? "") : "",
  );
  const [medNotes, setMedNotes] = useState(
    event.type === "medication" ? (event.notes ?? "") : "",
  );

  const [tempStr, setTempStr] = useState(
    event.type === "temperature" ? String(event.temp_f) : "",
  );
  const [tempMethod, setTempMethod] = useState<TempMethod | null>(
    event.type === "temperature" ? (event.method ?? null) : null,
  );
  const [tempNotes, setTempNotes] = useState(
    event.type === "temperature" ? (event.notes ?? "") : "",
  );

  async function save() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const occurred_at = new Date(when);
      if (isNaN(occurred_at.getTime())) {
        throw new Error("Invalid time");
      }

      let patch: Partial<NewEventPayload> & { occurred_at: Date } = {
        occurred_at,
      };

      switch (event.type) {
        case "breast_feed":
          if (!breastOutcome) throw new Error("Pick an outcome");
          patch = {
            ...patch,
            type: "breast_feed",
            outcome: breastOutcome,
            side: (breastSide ?? "left") as Side,
          };
          break;
        case "bottle_feed": {
          const ml = Number(bottleMl);
          if (!Number.isFinite(ml) || ml <= 0) throw new Error("Enter volume");
          if (bottleMilk.length === 0) throw new Error("Pick milk type");
          patch = {
            ...patch,
            type: "bottle_feed",
            volume_ml: ml,
            milk_types: bottleMilk,
          };
          break;
        }
        case "pump": {
          const ml = Number(pumpMl);
          if (!Number.isFinite(ml) || ml <= 0) throw new Error("Enter volume");
          patch = {
            ...patch,
            type: "pump",
            volume_ml: ml,
            side: (pumpSide ?? "left") as Side,
          };
          break;
        }
        case "diaper_wet":
        case "diaper_dirty":
          patch = { ...patch, type: diaperType };
          break;
        case "sleep_start":
        case "sleep_end":
          // Only time editable.
          break;
        case "weight": {
          const g = Number(weightG);
          if (!Number.isFinite(g) || g <= 0) throw new Error("Enter grams");
          patch = { ...patch, type: "weight", weight_grams: g };
          break;
        }
        case "book_read":
          if (!bookTitle.trim()) throw new Error("Title required");
          patch = {
            ...patch,
            type: "book_read",
            title: bookTitle.trim(),
            ...(bookAuthor.trim() ? { author: bookAuthor.trim() } : {}),
          };
          break;
        case "food_tried":
          if (!foodName.trim()) throw new Error("Food name required");
          patch = {
            ...patch,
            type: "food_tried",
            food_name: foodName.trim(),
            ...(foodReaction ? { reaction: foodReaction } : {}),
            ...(foodFirstTry ? { first_try: true } : {}),
          };
          break;
        case "medication":
          if (!medName.trim()) throw new Error("Name required");
          patch = {
            ...patch,
            type: "medication",
            name: medName.trim(),
            ...(medDose.trim() ? { dose: medDose.trim() } : {}),
            ...(medNotes.trim() ? { notes: medNotes.trim() } : {}),
          };
          break;
        case "temperature": {
          const t = Number(tempStr);
          if (!Number.isFinite(t) || t <= 0 || t >= 115) {
            throw new Error("Enter a temperature");
          }
          patch = {
            ...patch,
            type: "temperature",
            temp_f: t,
            ...(tempMethod ? { method: tempMethod } : {}),
            ...(tempNotes.trim() ? { notes: tempNotes.trim() } : {}),
          };
          break;
        }
      }

      await updateEvent(event.id, patch);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save");
      setSaving(false);
    }
  }

  return (
    <Sheet title="Edit event" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div>
          <label className="text-xs uppercase tracking-wider text-muted">
            When
          </label>
          <input
            type="datetime-local"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
            className="w-full rounded-xl border border-accent-soft bg-background px-3 py-2 text-sm text-foreground mt-1"
          />
        </div>

        {event.type === "breast_feed" && (
          <>
            <Field label="Side">
              <Segmented
                options={SIDES.map((s) => ({ value: s.value, label: s.short }))}
                value={breastSide}
                onChange={setBreastSide}
              />
            </Field>
            <Field label="Outcome">
              <Segmented
                options={BREAST_OUTCOMES.map((o) => ({
                  value: o.value,
                  label: o.label,
                }))}
                value={breastOutcome}
                onChange={(v) => setBreastOutcome(v)}
              />
            </Field>
          </>
        )}

        {event.type === "bottle_feed" && (
          <>
            <Field label="Volume (ml)">
              <input
                type="number"
                inputMode="numeric"
                min={1}
                value={bottleMl}
                onChange={(e) => setBottleMl(e.target.value)}
                className="w-full rounded-xl border border-accent-soft bg-background px-3 py-2 text-sm text-foreground"
              />
            </Field>
            <Field label="Milk">
              <div className="flex gap-2 flex-wrap">
                {MILK_TYPES.map((m) => {
                  const active = bottleMilk.includes(m.value);
                  return (
                    <button
                      key={m.value}
                      type="button"
                      onClick={() =>
                        setBottleMilk((cur) =>
                          active
                            ? cur.filter((x) => x !== m.value)
                            : [...cur, m.value],
                        )
                      }
                      className={
                        "rounded-full px-3 py-1.5 text-xs font-semibold border " +
                        (active
                          ? "bg-accent text-white border-accent"
                          : "bg-surface text-foreground border-accent-soft")
                      }
                    >
                      {m.label}
                    </button>
                  );
                })}
              </div>
            </Field>
          </>
        )}

        {event.type === "pump" && (
          <>
            <Field label="Side">
              <Segmented
                options={SIDES.filter((s) => s.value !== "both").map((s) => ({
                  value: s.value,
                  label: s.short,
                }))}
                value={pumpSide}
                onChange={setPumpSide}
              />
            </Field>
            <Field label="Volume (ml)">
              <input
                type="number"
                inputMode="numeric"
                min={1}
                value={pumpMl}
                onChange={(e) => setPumpMl(e.target.value)}
                className="w-full rounded-xl border border-accent-soft bg-background px-3 py-2 text-sm text-foreground"
              />
            </Field>
          </>
        )}

        {(event.type === "diaper_wet" || event.type === "diaper_dirty") && (
          <Field label="Type">
            <Segmented
              options={[
                { value: "diaper_wet", label: "Wet" },
                { value: "diaper_dirty", label: "Dirty" },
              ]}
              value={diaperType}
              onChange={setDiaperType}
            />
          </Field>
        )}

        {event.type === "weight" && (
          <Field label="Weight (grams)">
            <input
              type="number"
              inputMode="numeric"
              min={1}
              value={weightG}
              onChange={(e) => setWeightG(e.target.value)}
              className="w-full rounded-xl border border-accent-soft bg-background px-3 py-2 text-sm text-foreground"
            />
          </Field>
        )}

        {event.type === "book_read" && (
          <>
            <Field label="Title">
              <input
                type="text"
                value={bookTitle}
                onChange={(e) => setBookTitle(e.target.value)}
                className="w-full rounded-xl border border-accent-soft bg-background px-3 py-2 text-sm text-foreground"
              />
            </Field>
            <Field label="Author">
              <input
                type="text"
                value={bookAuthor}
                onChange={(e) => setBookAuthor(e.target.value)}
                className="w-full rounded-xl border border-accent-soft bg-background px-3 py-2 text-sm text-foreground"
              />
            </Field>
          </>
        )}

        {event.type === "food_tried" && (
          <>
            <Field label="Food">
              <input
                type="text"
                value={foodName}
                onChange={(e) => setFoodName(e.target.value)}
                className="w-full rounded-xl border border-accent-soft bg-background px-3 py-2 text-sm text-foreground"
              />
            </Field>
            <Field label="Reaction">
              <Segmented
                options={FOOD_REACTIONS.map((r) => ({
                  value: r.value,
                  label: r.label,
                }))}
                value={foodReaction}
                onChange={setFoodReaction}
              />
            </Field>
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={foodFirstTry}
                onChange={(e) => setFoodFirstTry(e.target.checked)}
                className="w-4 h-4"
              />
              First time trying this
            </label>
          </>
        )}

        {event.type === "medication" && (
          <>
            <Field label="Name">
              <input
                type="text"
                value={medName}
                onChange={(e) => setMedName(e.target.value)}
                className="w-full rounded-xl border border-accent-soft bg-background px-3 py-2 text-sm text-foreground"
              />
            </Field>
            <Field label="Dose">
              <input
                type="text"
                value={medDose}
                onChange={(e) => setMedDose(e.target.value)}
                className="w-full rounded-xl border border-accent-soft bg-background px-3 py-2 text-sm text-foreground"
              />
            </Field>
            <Field label="Notes">
              <input
                type="text"
                value={medNotes}
                onChange={(e) => setMedNotes(e.target.value)}
                className="w-full rounded-xl border border-accent-soft bg-background px-3 py-2 text-sm text-foreground"
              />
            </Field>
          </>
        )}

        {event.type === "temperature" && (
          <>
            <Field label="Temperature (°F)">
              <input
                type="number"
                inputMode="decimal"
                step="0.1"
                value={tempStr}
                onChange={(e) => setTempStr(e.target.value)}
                className="w-full rounded-xl border border-accent-soft bg-background px-3 py-2 text-sm text-foreground"
              />
            </Field>
            <Field label="Method">
              <Segmented
                options={TEMP_METHODS.map((m) => ({
                  value: m.value,
                  label: m.label,
                }))}
                value={tempMethod}
                onChange={setTempMethod}
              />
            </Field>
            <Field label="Notes">
              <input
                type="text"
                value={tempNotes}
                onChange={(e) => setTempNotes(e.target.value)}
                className="w-full rounded-xl border border-accent-soft bg-background px-3 py-2 text-sm text-foreground"
              />
            </Field>
          </>
        )}

        {error && <p className="text-xs text-rose-600">{error}</p>}

        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="w-full rounded-2xl bg-accent px-4 py-3 text-base font-bold text-white disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
      </div>
    </Sheet>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wider text-muted mb-1">
        {label}
      </p>
      {children}
    </div>
  );
}

function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T | null;
  onChange: (v: T) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {options.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={
              "min-h-[40px] rounded-xl text-sm font-semibold border transition " +
              (active
                ? "bg-accent text-white border-accent"
                : "bg-background text-foreground border-accent-soft")
            }
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-40 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
        className="w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl bg-surface p-5 shadow-lg flex flex-col gap-4 max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">{title}</h2>
          <button
            onClick={onClose}
            className="text-sm text-muted underline decoration-dotted underline-offset-4"
          >
            Close
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
