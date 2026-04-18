"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  BREAST_OUTCOMES,
  MILK_TYPES,
  VOLUME_PRESETS_ML,
  type BreastFeedOutcome,
  type MilkType,
} from "@/lib/events";
import { formatVolume, mlToOz } from "@/lib/format";
import { writeEvent, type NewEventPayload } from "@/lib/useEvents";

type PanelKind = "breast" | "bottle" | "pump" | null;

const MILK_STORAGE_KEY = "last_milk_types";

function readLastMilkTypes(): MilkType[] {
  try {
    const raw = window.localStorage.getItem(MILK_STORAGE_KEY);
    if (!raw) return ["mom_pumped"];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.length === 0) return ["mom_pumped"];
    return parsed.filter((v): v is MilkType =>
      ["mom_pumped", "donor", "formula"].includes(v as string),
    );
  } catch {
    return ["mom_pumped"];
  }
}

function writeLastMilkTypes(types: MilkType[]) {
  try {
    window.localStorage.setItem(MILK_STORAGE_KEY, JSON.stringify(types));
  } catch {
    /* ignore */
  }
}

export function ActionGrid({
  sleeping,
  occurredAt,
  backdate,
}: {
  sleeping: boolean;
  occurredAt?: Date;
  backdate?: boolean;
}) {
  const [panel, setPanel] = useState<PanelKind>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function log(payload: NewEventPayload, confirmation: string) {
    if (busy) return;
    setBusy(true);
    try {
      await writeEvent(payload, occurredAt);
      setFlash(
        backdate
          ? `${confirmation} (at ${occurredAt?.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })})`
          : confirmation,
      );
      setTimeout(() => setFlash(null), 2000);
      setPanel(null);
    } catch (err) {
      setFlash(
        err instanceof Error ? `Couldn't save: ${err.message}` : "Couldn't save",
      );
      setTimeout(() => setFlash(null), 4000);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="w-full flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <ActionButton onClick={() => setPanel("breast")}>
          Breast feed
        </ActionButton>
        <ActionButton onClick={() => setPanel("bottle")}>
          Bottle feed
        </ActionButton>
        <ActionButton
          onClick={() => log({ type: "diaper_wet" }, "Wet diaper logged")}
        >
          Wet diaper
        </ActionButton>
        <ActionButton
          onClick={() => log({ type: "diaper_dirty" }, "Dirty diaper logged")}
        >
          Dirty diaper
        </ActionButton>
        <ActionButton onClick={() => setPanel("pump")}>Pump</ActionButton>
        {backdate ? (
          <div className="grid grid-cols-2 gap-2">
            <ActionButton
              onClick={() =>
                log({ type: "sleep_start" }, "Sleep start logged")
              }
            >
              Sleep start
            </ActionButton>
            <ActionButton
              onClick={() => log({ type: "sleep_end" }, "Sleep end logged")}
            >
              Sleep end
            </ActionButton>
          </div>
        ) : (
          <ActionButton
            highlight={sleeping}
            onClick={() =>
              log(
                { type: sleeping ? "sleep_end" : "sleep_start" },
                sleeping ? "Woke up" : "Sleep started",
              )
            }
          >
            {sleeping ? "End sleep" : "Start sleep"}
          </ActionButton>
        )}
      </div>

      <div className="h-5 text-center text-xs text-muted">{flash ?? ""}</div>

      {panel === "breast" && (
        <BreastPanel onClose={() => setPanel(null)} onLog={log} />
      )}
      {panel === "bottle" && (
        <BottlePanel onClose={() => setPanel(null)} onLog={log} />
      )}
      {panel === "pump" && (
        <PumpPanel onClose={() => setPanel(null)} onLog={log} />
      )}
    </div>
  );
}

function ActionButton({
  onClick,
  children,
  highlight,
}: {
  onClick: () => void;
  children: ReactNode;
  highlight?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        touchAction: "manipulation",
        WebkitTapHighlightColor: "transparent",
      }}
      className={
        "min-h-[88px] rounded-3xl px-4 py-3 text-base font-semibold shadow-sm transition active:scale-[0.98] " +
        (highlight
          ? "bg-accent text-white"
          : "bg-surface border border-accent-soft text-foreground")
      }
    >
      {children}
    </button>
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
        className="w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl bg-surface p-5 shadow-lg flex flex-col gap-4"
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

function BreastPanel({
  onClose,
  onLog,
}: {
  onClose: () => void;
  onLog: (p: NewEventPayload, c: string) => Promise<void>;
}) {
  return (
    <Sheet title="Breast feed" onClose={onClose}>
      <div className="flex flex-col gap-3">
        {BREAST_OUTCOMES.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() =>
              onLog(
                { type: "breast_feed", outcome: o.value as BreastFeedOutcome },
                `Logged: ${o.label.toLowerCase()}`,
              )
            }
            className="min-h-[64px] rounded-2xl bg-accent/10 px-4 py-3 text-base font-semibold text-foreground border border-accent-soft active:scale-[0.98]"
          >
            {o.label}
          </button>
        ))}
      </div>
    </Sheet>
  );
}

function BottlePanel({
  onClose,
  onLog,
}: {
  onClose: () => void;
  onLog: (p: NewEventPayload, c: string) => Promise<void>;
}) {
  const [milk, setMilk] = useState<MilkType[]>(["mom_pumped"]);
  const [selectedMl, setSelectedMl] = useState<number | null>(null);
  const [customMl, setCustomMl] = useState("");

  useEffect(() => {
    setMilk(readLastMilkTypes());
  }, []);

  const effectiveMl =
    selectedMl != null
      ? selectedMl
      : customMl && Number(customMl) > 0
        ? Number(customMl)
        : null;

  function toggleMilk(m: MilkType) {
    setMilk((cur) => {
      const next = cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m];
      return next.length === 0 ? [m] : next;
    });
  }

  function confirm() {
    if (effectiveMl == null || effectiveMl <= 0) return;
    writeLastMilkTypes(milk);
    onLog(
      { type: "bottle_feed", volume_ml: effectiveMl, milk_types: milk },
      `Bottle logged: ${formatVolume(effectiveMl)}`,
    );
  }

  return (
    <Sheet title="Bottle feed" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div>
          <p className="text-xs uppercase tracking-wider text-muted mb-2">
            Milk
          </p>
          <div className="flex gap-2 flex-wrap">
            {MILK_TYPES.map((m) => {
              const active = milk.includes(m.value);
              return (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => toggleMilk(m.value)}
                  className={
                    "rounded-full px-4 py-2 text-sm font-medium border transition " +
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
        </div>

        <div>
          <p className="text-xs uppercase tracking-wider text-muted mb-2">
            Volume
          </p>
          <div className="grid grid-cols-3 gap-2">
            {VOLUME_PRESETS_ML.map((v) => {
              const active = selectedMl === v && !customMl;
              return (
                <button
                  key={v}
                  type="button"
                  onClick={() => {
                    setSelectedMl(v);
                    setCustomMl("");
                  }}
                  className={
                    "min-h-[64px] rounded-2xl font-semibold active:scale-[0.98] flex flex-col items-center justify-center border transition " +
                    (active
                      ? "bg-accent text-white border-accent"
                      : "bg-surface text-foreground border-accent-soft")
                  }
                >
                  <span className="text-lg">{v} ml</span>
                  <span
                    className={
                      "text-[10px] " +
                      (active ? "text-white/80" : "text-muted")
                    }
                  >
                    {mlToOz(v)} oz
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <p className="text-xs uppercase tracking-wider text-muted mb-2">
            Custom
          </p>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            placeholder="ml"
            value={customMl}
            onChange={(e) => {
              setCustomMl(e.target.value);
              if (e.target.value) setSelectedMl(null);
            }}
            className="w-full rounded-2xl border border-accent-soft bg-surface px-4 py-3 text-base text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>

        <button
          type="button"
          onClick={confirm}
          disabled={effectiveMl == null || effectiveMl <= 0}
          className="mt-2 w-full rounded-2xl bg-accent px-4 py-4 text-base font-bold text-white shadow-sm active:scale-[0.99] disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {effectiveMl
            ? `Log ${formatVolume(effectiveMl)}`
            : "Pick a volume"}
        </button>
      </div>
    </Sheet>
  );
}

function PumpPanel({
  onClose,
  onLog,
}: {
  onClose: () => void;
  onLog: (p: NewEventPayload, c: string) => Promise<void>;
}) {
  const [selectedMl, setSelectedMl] = useState<number | null>(null);
  const [customMl, setCustomMl] = useState("");

  const effectiveMl =
    selectedMl != null
      ? selectedMl
      : customMl && Number(customMl) > 0
        ? Number(customMl)
        : null;

  function confirm() {
    if (effectiveMl == null || effectiveMl <= 0) return;
    onLog(
      { type: "pump", volume_ml: effectiveMl },
      `Pump logged: ${formatVolume(effectiveMl)}`,
    );
  }

  return (
    <Sheet title="Pump" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div>
          <p className="text-xs uppercase tracking-wider text-muted mb-2">
            Volume
          </p>
          <div className="grid grid-cols-3 gap-2">
            {VOLUME_PRESETS_ML.map((v) => {
              const active = selectedMl === v && !customMl;
              return (
                <button
                  key={v}
                  type="button"
                  onClick={() => {
                    setSelectedMl(v);
                    setCustomMl("");
                  }}
                  className={
                    "min-h-[64px] rounded-2xl font-semibold active:scale-[0.98] flex flex-col items-center justify-center border transition " +
                    (active
                      ? "bg-accent text-white border-accent"
                      : "bg-surface text-foreground border-accent-soft")
                  }
                >
                  <span className="text-lg">{v} ml</span>
                  <span
                    className={
                      "text-[10px] " +
                      (active ? "text-white/80" : "text-muted")
                    }
                  >
                    {mlToOz(v)} oz
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <p className="text-xs uppercase tracking-wider text-muted mb-2">
            Custom
          </p>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            placeholder="ml"
            value={customMl}
            onChange={(e) => {
              setCustomMl(e.target.value);
              if (e.target.value) setSelectedMl(null);
            }}
            className="w-full rounded-2xl border border-accent-soft bg-surface px-4 py-3 text-base text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>

        <button
          type="button"
          onClick={confirm}
          disabled={effectiveMl == null || effectiveMl <= 0}
          className="mt-2 w-full rounded-2xl bg-accent px-4 py-4 text-base font-bold text-white shadow-sm active:scale-[0.99] disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {effectiveMl
            ? `Log ${formatVolume(effectiveMl)}`
            : "Pick a volume"}
        </button>
      </div>
    </Sheet>
  );
}
