"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  BREAST_OUTCOMES,
  MILK_TYPES,
  SIDES,
  VOLUME_PRESETS_ML,
  type BreastFeedOutcome,
  type MilkType,
  type Side,
} from "@/lib/events";
import { formatVolume, mlToOz } from "@/lib/format";
import { softDeleteEvent, writeEvent, type NewEventPayload } from "@/lib/useEvents";

type PanelKind = "breast" | "bottle" | "pump" | null;

export function ActionGrid({
  sleeping,
  occurredAt,
  backdate,
  suggestedBreastSide,
}: {
  sleeping: boolean;
  occurredAt?: Date;
  backdate?: boolean;
  suggestedBreastSide?: Side;
}) {
  const [panel, setPanel] = useState<PanelKind>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [undoInfo, setUndoInfo] = useState<{ id: string; label: string } | null>(
    null,
  );
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearUndoTimer() {
    if (undoTimerRef.current) {
      clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
  }

  async function log(
    payload: NewEventPayload | NewEventPayload[],
    confirmation: string,
  ) {
    if (busy) return;
    setBusy(true);
    const payloads = Array.isArray(payload) ? payload : [payload];
    if (payloads.length === 0) {
      setBusy(false);
      return;
    }
    try {
      const when = occurredAt ?? new Date();
      for (const p of payloads) {
        await writeEvent(p, when);
      }
      setFlash(
        backdate
          ? `${confirmation} (at ${when.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })})`
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

  async function logDiaper(
    payload: NewEventPayload,
    label: string,
  ) {
    if (busy) return;
    setBusy(true);
    clearUndoTimer();
    setUndoInfo(null);
    setFlash(null);
    try {
      const when = occurredAt ?? new Date();
      const id = await writeEvent(payload, when);
      setUndoInfo({ id, label });
      undoTimerRef.current = setTimeout(() => {
        setUndoInfo(null);
        undoTimerRef.current = null;
      }, 5000);
    } catch (err) {
      setFlash(
        err instanceof Error ? `Couldn't save: ${err.message}` : "Couldn't save",
      );
      setTimeout(() => setFlash(null), 4000);
    } finally {
      setBusy(false);
    }
  }

  async function undo() {
    if (!undoInfo) return;
    const id = undoInfo.id;
    clearUndoTimer();
    setUndoInfo(null);
    try {
      await softDeleteEvent(id);
      setFlash("Undone");
      setTimeout(() => setFlash(null), 1500);
    } catch (err) {
      setFlash(
        err instanceof Error ? `Undo failed: ${err.message}` : "Undo failed",
      );
      setTimeout(() => setFlash(null), 4000);
    }
  }

  useEffect(() => {
    return () => clearUndoTimer();
  }, []);

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
          onClick={() =>
            logDiaper({ type: "diaper_wet" }, "Wet diaper logged")
          }
        >
          Wet diaper
        </ActionButton>
        <ActionButton
          onClick={() =>
            logDiaper({ type: "diaper_dirty" }, "Dirty diaper logged")
          }
        >
          Dirty diaper
        </ActionButton>
      </div>

      <ActionButton onClick={() => setPanel("pump")}>Pump</ActionButton>

      {backdate && (
        <div className="grid grid-cols-2 gap-3">
          <ActionButton
            onClick={() => log({ type: "sleep_start" }, "Sleep start logged")}
          >
            Sleep start
          </ActionButton>
          <ActionButton
            onClick={() => log({ type: "sleep_end" }, "Sleep end logged")}
          >
            Sleep end
          </ActionButton>
        </div>
      )}

      {undoInfo ? (
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-accent-soft bg-surface px-4 py-2">
          <span className="text-sm text-foreground">{undoInfo.label}</span>
          <button
            type="button"
            onClick={undo}
            className="text-sm font-semibold text-accent underline decoration-dotted underline-offset-4"
          >
            Undo
          </button>
        </div>
      ) : (
        <div className="h-5 text-center text-xs text-muted">{flash ?? ""}</div>
      )}

      {panel === "breast" && (
        <BreastPanel onClose={() => setPanel(null)} onLog={log} />
      )}
      {panel === "bottle" && (
        <BottlePanel onClose={() => setPanel(null)} onLog={(p, c) => log(p, c)} />
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

const SHORT_OUTCOMES: { value: BreastFeedOutcome; label: string }[] = [
  { value: "latched_fed", label: "Latched" },
  { value: "latched_brief", label: "Brief" },
  { value: "no_latch", label: "No latch" },
];

function BreastPanel({
  onClose,
  onLog,
}: {
  onClose: () => void;
  onLog: (p: NewEventPayload[], c: string) => Promise<void>;
}) {
  const [leftOutcome, setLeftOutcome] = useState<BreastFeedOutcome | null>(null);
  const [rightOutcome, setRightOutcome] = useState<BreastFeedOutcome | null>(null);

  function confirm() {
    const events: NewEventPayload[] = [];
    if (leftOutcome) {
      events.push({ type: "breast_feed", outcome: leftOutcome, side: "left" });
    }
    if (rightOutcome) {
      events.push({ type: "breast_feed", outcome: rightOutcome, side: "right" });
    }
    if (events.length === 0) return;
    const summary = events
      .map(
        (e) =>
          (e.type === "breast_feed" && e.side === "left" ? "L" : "R") +
          " " +
          (e.type === "breast_feed"
            ? e.outcome === "latched_fed"
              ? "fed"
              : e.outcome === "latched_brief"
                ? "brief"
                : "no latch"
            : ""),
      )
      .join(" · ");
    onLog(events, `Breast: ${summary}`);
  }

  const any = leftOutcome || rightOutcome;

  return (
    <Sheet title="Breast feed" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <p className="text-xs text-muted">
          Pick an outcome for each side you used. Skip a side by leaving it blank.
        </p>

        <SidePicker
          label="Left"
          value={leftOutcome}
          onChange={setLeftOutcome}
        />
        <SidePicker
          label="Right"
          value={rightOutcome}
          onChange={setRightOutcome}
        />

        <button
          type="button"
          onClick={confirm}
          disabled={!any}
          className="mt-2 w-full rounded-2xl bg-accent px-4 py-4 text-base font-bold text-white shadow-sm active:scale-[0.99] disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {!any
            ? "Pick an outcome for at least one side"
            : leftOutcome && rightOutcome
              ? "Log both sides"
              : `Log ${leftOutcome ? "left" : "right"}`}
        </button>
      </div>
    </Sheet>
  );
}

function SidePicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: BreastFeedOutcome | null;
  onChange: (v: BreastFeedOutcome | null) => void;
}) {
  return (
    <div className="rounded-2xl border border-accent-soft bg-surface p-3 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-foreground">{label}</span>
        {value && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="text-[10px] text-muted underline decoration-dotted underline-offset-2"
          >
            clear
          </button>
        )}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {SHORT_OUTCOMES.map((o) => {
          const active = value === o.value;
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => onChange(o.value)}
              className={
                "min-h-[48px] rounded-xl text-sm font-semibold border transition active:scale-[0.98] " +
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
    </div>
  );
}

function BottlePanel({
  onClose,
  onLog,
}: {
  onClose: () => void;
  onLog: (p: NewEventPayload, c: string) => Promise<void>;
}) {
  const [milk, setMilk] = useState<MilkType[]>([]);
  const [selectedMl, setSelectedMl] = useState<number | null>(null);
  const [customMl, setCustomMl] = useState("");

  const effectiveMl =
    selectedMl != null
      ? selectedMl
      : customMl && Number(customMl) > 0
        ? Number(customMl)
        : null;

  function toggleMilk(m: MilkType) {
    setMilk((cur) =>
      cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m],
    );
  }

  function confirm() {
    if (effectiveMl == null || effectiveMl <= 0 || milk.length === 0) return;
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
          disabled={
            effectiveMl == null || effectiveMl <= 0 || milk.length === 0
          }
          className="mt-2 w-full rounded-2xl bg-accent px-4 py-4 text-base font-bold text-white shadow-sm active:scale-[0.99] disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {milk.length === 0
            ? "Pick at least one milk type"
            : effectiveMl == null
              ? "Pick a volume"
              : `Log ${formatVolume(effectiveMl)}`}
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
  onLog: (p: NewEventPayload[], c: string) => Promise<void>;
}) {
  const [leftMl, setLeftMl] = useState<number | null>(null);
  const [leftCustom, setLeftCustom] = useState("");
  const [rightMl, setRightMl] = useState<number | null>(null);
  const [rightCustom, setRightCustom] = useState("");

  const leftVal =
    leftMl != null
      ? leftMl
      : leftCustom && Number(leftCustom) > 0
        ? Number(leftCustom)
        : 0;
  const rightVal =
    rightMl != null
      ? rightMl
      : rightCustom && Number(rightCustom) > 0
        ? Number(rightCustom)
        : 0;

  const total = leftVal + rightVal;

  function confirm() {
    const events: NewEventPayload[] = [];
    if (leftVal > 0)
      events.push({ type: "pump", volume_ml: leftVal, side: "left" });
    if (rightVal > 0)
      events.push({ type: "pump", volume_ml: rightVal, side: "right" });
    if (events.length === 0) return;
    const summary = events
      .map((e) => (e.type === "pump" ? `${e.side === "left" ? "L" : "R"} ${e.volume_ml}` : ""))
      .join(" · ");
    onLog(events, `Pump: ${summary} ml`);
  }

  return (
    <Sheet title="Pump" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <p className="text-xs text-muted">
          Enter volume for each side. Leave blank to skip a side.
        </p>

        <PumpSide
          label="Left"
          selected={leftMl}
          custom={leftCustom}
          onSelect={(v) => {
            setLeftMl(v);
            setLeftCustom("");
          }}
          onCustom={(v) => {
            setLeftCustom(v);
            if (v) setLeftMl(null);
          }}
        />

        <PumpSide
          label="Right"
          selected={rightMl}
          custom={rightCustom}
          onSelect={(v) => {
            setRightMl(v);
            setRightCustom("");
          }}
          onCustom={(v) => {
            setRightCustom(v);
            if (v) setRightMl(null);
          }}
        />

        {total > 0 && (
          <p className="text-center text-xs text-muted">
            Total: <span className="text-foreground font-semibold">{total} ml</span>
            {" "}({mlToOz(total)} oz)
          </p>
        )}

        <button
          type="button"
          onClick={confirm}
          disabled={total <= 0}
          className="mt-2 w-full rounded-2xl bg-accent px-4 py-4 text-base font-bold text-white shadow-sm active:scale-[0.99] disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {total <= 0
            ? "Enter a volume"
            : leftVal > 0 && rightVal > 0
              ? `Log ${total} ml (L+R)`
              : `Log ${total} ml (${leftVal > 0 ? "L" : "R"})`}
        </button>
      </div>
    </Sheet>
  );
}

function PumpSide({
  label,
  selected,
  custom,
  onSelect,
  onCustom,
}: {
  label: string;
  selected: number | null;
  custom: string;
  onSelect: (v: number | null) => void;
  onCustom: (v: string) => void;
}) {
  return (
    <div className="rounded-2xl border border-accent-soft bg-surface p-3 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-foreground">{label}</span>
        {(selected || custom) && (
          <button
            type="button"
            onClick={() => {
              onSelect(null);
              onCustom("");
            }}
            className="text-[10px] text-muted underline decoration-dotted underline-offset-2"
          >
            clear
          </button>
        )}
      </div>
      <div className="grid grid-cols-5 gap-1.5">
        {VOLUME_PRESETS_ML.map((v) => {
          const active = selected === v && !custom;
          return (
            <button
              key={v}
              type="button"
              onClick={() => onSelect(v)}
              className={
                "min-h-[44px] rounded-xl text-sm font-semibold border transition active:scale-[0.98] " +
                (active
                  ? "bg-accent text-white border-accent"
                  : "bg-background text-foreground border-accent-soft")
              }
            >
              {v}
            </button>
          );
        })}
      </div>
      <input
        type="number"
        inputMode="numeric"
        min={1}
        step={1}
        placeholder="custom ml"
        value={custom}
        onChange={(e) => onCustom(e.target.value)}
        className="w-full rounded-xl border border-accent-soft bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
      />
    </div>
  );
}
