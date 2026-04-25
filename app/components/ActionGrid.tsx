"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  BREAST_OUTCOMES,
  COMMON_MEDS,
  FEVER_THRESHOLD_F,
  HIGH_FEVER_THRESHOLD_F,
  MILK_TYPES,
  SIDES,
  TEMP_METHODS,
  VOLUME_PRESETS_ML,
  lookupCommonMed,
  type BabyEvent,
  type BreastFeedOutcome,
  type CommonMed,
  type MilkType,
  type Side,
  type TempMethod,
} from "@/lib/events";
import { formatRelativeShort, formatVolume, mlToOz } from "@/lib/format";
import { softDeleteEvent, writeEvent, type NewEventPayload } from "@/lib/useEvents";
import { useBaby } from "@/lib/useBaby";

type PanelKind = "breast" | "bottle" | "pump" | "med" | "temp" | null;

function lastMedicationPayload(
  events: BabyEvent[] | undefined,
): NewEventPayload | null {
  if (!events) return null;
  for (const e of events) {
    if (e.type === "medication") {
      const payload: NewEventPayload = { type: "medication", name: e.name };
      if (e.dose) payload.dose = e.dose;
      if (e.notes) payload.notes = e.notes;
      return payload;
    }
  }
  return null;
}

function uniqueMedNames(events: BabyEvent[] | undefined): string[] {
  if (!events) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of events) {
    if (e.type === "medication" && !seen.has(e.name)) {
      seen.add(e.name);
      out.push(e.name);
      if (out.length >= 8) break;
    }
  }
  return out;
}

const SESSION_GAP_MS = 5000;

function lastSessionPayloads(
  events: BabyEvent[] | undefined,
  types: BabyEvent["type"][],
): NewEventPayload[] {
  if (!events || events.length === 0) return [];
  const session: BabyEvent[] = [];
  let anchorMs: number | null = null;
  for (const e of events) {
    if (!types.includes(e.type)) continue;
    const ms = e.occurred_at.toMillis();
    if (anchorMs === null) {
      anchorMs = ms;
      session.push(e);
    } else if (Math.abs(ms - anchorMs) <= SESSION_GAP_MS) {
      session.push(e);
    } else {
      break;
    }
  }
  const payloads: NewEventPayload[] = [];
  for (const e of session) {
    if (e.type === "breast_feed") {
      payloads.push({
        type: "breast_feed",
        outcome: e.outcome,
        side: (e.side ?? "left") as Side,
      });
    } else if (e.type === "bottle_feed") {
      payloads.push({
        type: "bottle_feed",
        volume_ml: e.volume_ml,
        milk_types: e.milk_types,
      });
    } else if (e.type === "pump") {
      payloads.push({
        type: "pump",
        volume_ml: e.volume_ml,
        side: (e.side ?? "left") as Side,
      });
    }
  }
  return payloads;
}

const TIMER_STORAGE_KEY = "babylog.feedTimerStart";

function formatElapsedClock(totalSec: number): string {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function ActionGrid({
  sleeping,
  occurredAt,
  backdate,
  suggestedBreastSide,
  events,
}: {
  sleeping: boolean;
  occurredAt?: Date;
  backdate?: boolean;
  suggestedBreastSide?: Side;
  events?: BabyEvent[];
}) {
  const baby = useBaby();
  const ageDays = Math.max(
    0,
    Math.floor((Date.now() - baby.birthdate.getTime()) / 86400000),
  );
  const [panel, setPanel] = useState<PanelKind>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [undoInfo, setUndoInfo] = useState<{ id: string; label: string } | null>(
    null,
  );
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [timerStart, setTimerStart] = useState<number | null>(null);
  const [timerTick, setTimerTick] = useState(() => Date.now());

  useEffect(() => {
    if (backdate) return;
    try {
      const raw = localStorage.getItem(TIMER_STORAGE_KEY);
      if (raw) {
        const ms = Number(raw);
        if (Number.isFinite(ms) && ms > 0) setTimerStart(ms);
      }
    } catch {
      /* ignore */
    }
  }, [backdate]);

  useEffect(() => {
    if (timerStart === null) return;
    const id = setInterval(() => setTimerTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [timerStart]);

  function startTimer() {
    const ms = Date.now();
    setTimerStart(ms);
    try {
      localStorage.setItem(TIMER_STORAGE_KEY, String(ms));
    } catch {
      /* ignore */
    }
  }
  function clearTimer() {
    setTimerStart(null);
    try {
      localStorage.removeItem(TIMER_STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }

  const timerOccurredAt =
    timerStart !== null ? new Date(timerStart) : undefined;
  const effectiveOccurredAt = occurredAt ?? timerOccurredAt;

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
      const when = effectiveOccurredAt ?? new Date();
      for (const p of payloads) {
        await writeEvent(p, when);
      }
      const timeNote =
        backdate || timerStart !== null
          ? ` (at ${when.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })})`
          : "";
      setFlash(confirmation + timeNote);
      setTimeout(() => setFlash(null), 2000);
      setPanel(null);
      if (timerStart !== null) clearTimer();
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
      const when = effectiveOccurredAt ?? new Date();
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

  async function repeatLast(
    types: BabyEvent["type"][],
    label: string,
  ) {
    const payloads = lastSessionPayloads(events, types);
    if (payloads.length === 0) {
      setFlash("Nothing recent to repeat");
      setTimeout(() => setFlash(null), 2000);
      return;
    }
    await log(payloads, `${label} (repeated)`);
  }

  const elapsedSec =
    timerStart !== null ? Math.max(0, Math.floor((timerTick - timerStart) / 1000)) : 0;

  return (
    <div className="w-full flex flex-col gap-3">
      {!backdate && timerStart === null && (
        <button
          type="button"
          onClick={startTimer}
          className="self-center text-xs text-muted underline decoration-dotted underline-offset-4 hover:text-foreground"
        >
          Start feed timer
        </button>
      )}
      {timerStart !== null && (
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-accent bg-accent/10 px-4 py-2">
          <span className="text-xs text-muted">
            Feeding since{" "}
            <span className="text-foreground font-semibold tabular-nums">
              {new Date(timerStart).toLocaleTimeString(undefined, {
                hour: "numeric",
                minute: "2-digit",
              })}
            </span>
            {" · "}
            <span className="text-accent font-bold tabular-nums">
              {formatElapsedClock(elapsedSec)}
            </span>
          </span>
          <button
            type="button"
            onClick={clearTimer}
            className="text-xs text-muted underline decoration-dotted underline-offset-4 hover:text-foreground"
          >
            Cancel
          </button>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <ActionButton
          onClick={() => setPanel("breast")}
          onLongPress={() => repeatLast(["breast_feed"], "Nursing")}
          icon={<HeartIcon />}
          hint="hold to repeat"
        >
          Nursing
        </ActionButton>
        <ActionButton
          onClick={() => setPanel("bottle")}
          onLongPress={() => repeatLast(["bottle_feed"], "Bottle")}
          icon={<BottleIcon />}
          hint="hold to repeat"
        >
          Bottle feed
        </ActionButton>
        <ActionButton
          onClick={() =>
            logDiaper({ type: "diaper_wet" }, "Wet diaper logged")
          }
          icon={<DropIcon />}
        >
          Wet diaper
        </ActionButton>
        <ActionButton
          onClick={() =>
            logDiaper({ type: "diaper_dirty" }, "Dirty diaper logged")
          }
          icon={<SwirlIcon />}
        >
          Dirty diaper
        </ActionButton>
      </div>

      <ActionButton
        onClick={() => setPanel("pump")}
        onLongPress={() => repeatLast(["pump"], "Pump")}
        icon={<PumpIcon />}
        hint="hold to repeat"
      >
        Pump
      </ActionButton>

      <div className="grid grid-cols-2 gap-3">
        <SecondaryButton
          onClick={() => setPanel("med")}
          onLongPress={async () => {
            const last = lastMedicationPayload(events);
            if (!last) {
              setFlash("Nothing recent to repeat");
              setTimeout(() => setFlash(null), 2000);
              return;
            }
            await log(
              last,
              `Medication (repeated): ${last.type === "medication" ? last.name : ""}`,
            );
          }}
          icon={<PillIcon />}
          hint="hold to repeat"
        >
          Medication
        </SecondaryButton>
        <SecondaryButton
          onClick={() => setPanel("temp")}
          icon={<ThermometerIcon />}
        >
          Temperature
        </SecondaryButton>
      </div>

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
      {panel === "med" && (
        <MedicationPanel
          recentNames={uniqueMedNames(events)}
          ageDays={ageDays}
          onClose={() => setPanel(null)}
          onLog={(p, c) => log(p, c)}
        />
      )}
      {panel === "temp" && (
        <TemperaturePanel
          events={events}
          onClose={() => setPanel(null)}
          onLog={(p, c) => log(p, c)}
        />
      )}
    </div>
  );
}

function SecondaryButton({
  onClick,
  onLongPress,
  children,
  icon,
  hint,
}: {
  onClick: () => void;
  onLongPress?: () => void;
  children: ReactNode;
  icon?: ReactNode;
  hint?: string;
}) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggeredRef = useRef(false);

  function startHold() {
    if (!onLongPress) return;
    triggeredRef.current = false;
    timerRef.current = setTimeout(() => {
      triggeredRef.current = true;
      onLongPress();
    }, 550);
  }
  function cancelHold() {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  return (
    <button
      type="button"
      onClick={() => {
        if (triggeredRef.current) {
          triggeredRef.current = false;
          return;
        }
        onClick();
      }}
      onPointerDown={startHold}
      onPointerUp={cancelHold}
      onPointerCancel={cancelHold}
      onPointerLeave={cancelHold}
      onContextMenu={(e) => {
        if (onLongPress) e.preventDefault();
      }}
      style={{
        touchAction: "manipulation",
        WebkitTapHighlightColor: "transparent",
      }}
      className="min-h-[64px] rounded-2xl px-3 py-2 text-sm font-medium shadow-sm transition-all duration-150 hover:shadow-md active:scale-[0.97] flex flex-col items-center justify-center gap-0.5 bg-surface border border-accent-soft text-foreground hover:border-accent/60"
    >
      {icon}
      <span>{children}</span>
      {hint && (
        <span className="text-[10px] text-muted/80 font-medium leading-none mt-0.5">
          {hint}
        </span>
      )}
    </button>
  );
}

function ActionButton({
  onClick,
  onLongPress,
  children,
  highlight,
  icon,
  hint,
}: {
  onClick: () => void;
  onLongPress?: () => void;
  children: ReactNode;
  highlight?: boolean;
  icon?: ReactNode;
  hint?: string;
}) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggeredRef = useRef(false);

  function startHold() {
    if (!onLongPress) return;
    triggeredRef.current = false;
    timerRef.current = setTimeout(() => {
      triggeredRef.current = true;
      onLongPress();
    }, 550);
  }
  function cancelHold() {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  return (
    <button
      type="button"
      onClick={() => {
        if (triggeredRef.current) {
          triggeredRef.current = false;
          return;
        }
        onClick();
      }}
      onPointerDown={startHold}
      onPointerUp={cancelHold}
      onPointerCancel={cancelHold}
      onPointerLeave={cancelHold}
      onContextMenu={(e) => {
        if (onLongPress) e.preventDefault();
      }}
      style={{
        touchAction: "manipulation",
        WebkitTapHighlightColor: "transparent",
      }}
      className={
        "min-h-[88px] rounded-3xl px-4 py-3 text-base font-semibold shadow-sm transition-all duration-150 hover:shadow-md active:scale-[0.97] active:shadow-sm flex flex-col items-center justify-center gap-1 " +
        (highlight
          ? "bg-accent text-white hover:brightness-105"
          : "bg-surface border border-accent-soft text-foreground hover:border-accent/60 hover:-translate-y-px")
      }
    >
      {icon}
      <span>{children}</span>
      {hint && (
        <span className="text-[10px] text-muted/80 font-medium leading-none mt-0.5">
          {hint}
        </span>
      )}
    </button>
  );
}

function HeartIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  );
}

function BottleIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M10 2h4v3h-4z" />
      <path d="M9 5h6l1.8 3v12.2a.8.8 0 0 1-.8.8H8a.8.8 0 0 1-.8-.8V8z" />
      <line x1="9.5" y1="13" x2="14.5" y2="13" />
    </svg>
  );
}

function DropIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 2.5c-.3 0-.58.15-.75.4-.7 1-5.75 8.46-5.75 12.1a6.5 6.5 0 0 0 13 0c0-3.64-5.05-11.1-5.75-12.1a.92.92 0 0 0-.75-.4z" />
    </svg>
  );
}

function SwirlIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 3a4 4 0 0 0-3.5 5.95A4 4 0 0 0 6 16.5a4 4 0 0 0 4 4h4a4 4 0 0 0 4-4 4 4 0 0 0-2.5-7.55A4 4 0 0 0 12 3z" />
    </svg>
  );
}

function PillIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="2.5" y="9" width="19" height="6" rx="3" transform="rotate(-30 12 12)" />
      <line x1="8.7" y1="7.5" x2="15.3" y2="16.5" />
    </svg>
  );
}

function ThermometerIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M14 4a2 2 0 0 0-4 0v10.5a4 4 0 1 0 4 0z" />
      <line x1="12" y1="8" x2="12" y2="14" />
    </svg>
  );
}

function PumpIcon() {
  // Stylized breast pump: circular flange on top, narrowing neck,
  // collection bottle on the bottom.
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <ellipse cx="12" cy="6.5" rx="4.5" ry="3.5" />
      <path d="M10 10 L10 13 L9 14 L9 20 A1 1 0 0 0 10 21 L14 21 A1 1 0 0 0 15 20 L15 14 L14 13 L14 10" />
    </svg>
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
    onLog(events, `Nursing: ${summary}`);
  }

  const any = leftOutcome || rightOutcome;

  return (
    <Sheet title="Nursing" onClose={onClose}>
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
          className="mt-2 w-full rounded-2xl bg-accent px-4 py-4 text-base font-bold text-white shadow-sm transition-all duration-150 hover:shadow-md hover:brightness-105 active:scale-[0.98] active:shadow-sm disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:shadow-sm disabled:hover:brightness-100"
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
                "min-h-[48px] rounded-xl text-sm font-semibold border transition-all duration-150 hover:shadow-sm active:scale-[0.97] " +
                (active
                  ? "bg-accent text-white border-accent"
                  : "bg-background text-foreground border-accent-soft hover:border-accent/50")
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
                    "rounded-full px-4 py-2 text-sm font-medium border transition-all duration-150 hover:shadow-sm active:scale-[0.97] " +
                    (active
                      ? "bg-accent text-white border-accent"
                      : "bg-surface text-foreground border-accent-soft hover:border-accent/50")
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
                    "min-h-[64px] rounded-2xl font-semibold flex flex-col items-center justify-center border transition-all duration-150 hover:shadow-sm active:scale-[0.97] " +
                    (active
                      ? "bg-accent text-white border-accent"
                      : "bg-surface text-foreground border-accent-soft hover:border-accent/50")
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
          className="mt-2 w-full rounded-2xl bg-accent px-4 py-4 text-base font-bold text-white shadow-sm transition-all duration-150 hover:shadow-md hover:brightness-105 active:scale-[0.98] active:shadow-sm disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:shadow-sm disabled:hover:brightness-100"
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
          className="mt-2 w-full rounded-2xl bg-accent px-4 py-4 text-base font-bold text-white shadow-sm transition-all duration-150 hover:shadow-md hover:brightness-105 active:scale-[0.98] active:shadow-sm disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:shadow-sm disabled:hover:brightness-100"
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
                "min-h-[44px] rounded-xl text-sm font-semibold border transition-all duration-150 hover:shadow-sm active:scale-[0.97] " +
                (active
                  ? "bg-accent text-white border-accent"
                  : "bg-background text-foreground border-accent-soft hover:border-accent/50")
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

function MedicationPanel({
  recentNames,
  ageDays,
  onClose,
  onLog,
}: {
  recentNames: string[];
  ageDays: number;
  onClose: () => void;
  onLog: (p: NewEventPayload, c: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [dose, setDose] = useState("");
  const [notes, setNotes] = useState("");

  function selectCommon(m: CommonMed) {
    setName(m.name);
    if (m.defaultDose && !dose) setDose(m.defaultDose);
  }

  function selectRecent(n: string) {
    setName(n);
    const common = lookupCommonMed(n);
    if (common?.defaultDose && !dose) setDose(common.defaultDose);
  }

  // Recent names that aren't already in the COMMON_MEDS quick-pick list, so
  // we don't show them twice.
  const commonNamesLower = new Set(
    COMMON_MEDS.map((m) => m.name.toLowerCase()),
  );
  const extraRecents = recentNames.filter(
    (n) => !commonNamesLower.has(n.toLowerCase()),
  );

  function confirm() {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    const payload: NewEventPayload = {
      type: "medication",
      name: trimmedName,
    };
    const trimmedDose = dose.trim();
    if (trimmedDose) payload.dose = trimmedDose;
    const trimmedNotes = notes.trim();
    if (trimmedNotes) payload.notes = trimmedNotes;
    const summary = trimmedDose
      ? `${trimmedName} · ${trimmedDose}`
      : trimmedName;
    onLog(payload, `Medication: ${summary}`);
  }

  return (
    <Sheet title="Medication" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div>
          <p className="text-xs uppercase tracking-wider text-muted mb-2">
            Common
          </p>
          <div className="flex flex-wrap gap-2">
            {COMMON_MEDS.map((m) => {
              const active = name === m.name;
              const tooYoung =
                m.minAgeDays != null && ageDays < m.minAgeDays;
              return (
                <button
                  key={m.name}
                  type="button"
                  onClick={() => selectCommon(m)}
                  title={
                    tooYoung
                      ? `Typically given after ${Math.round((m.minAgeDays ?? 0) / 30)} months`
                      : undefined
                  }
                  className={
                    "rounded-full px-3 py-1.5 text-sm border transition-all duration-150 active:scale-[0.97] " +
                    (active
                      ? "bg-accent text-white border-accent"
                      : tooYoung
                        ? "bg-surface text-muted border-accent-soft/50 opacity-60"
                        : "bg-surface text-foreground border-accent-soft hover:border-accent/50")
                  }
                >
                  {m.name}
                </button>
              );
            })}
          </div>
        </div>

        {extraRecents.length > 0 && (
          <div>
            <p className="text-xs uppercase tracking-wider text-muted mb-2">
              Recent
            </p>
            <div className="flex flex-wrap gap-2">
              {extraRecents.map((n) => {
                const active = name === n;
                return (
                  <button
                    key={n}
                    type="button"
                    onClick={() => selectRecent(n)}
                    className={
                      "rounded-full px-3 py-1.5 text-sm border transition-all duration-150 active:scale-[0.97] " +
                      (active
                        ? "bg-accent text-white border-accent"
                        : "bg-surface text-foreground border-accent-soft hover:border-accent/50")
                    }
                  >
                    {n}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div>
          <label className="text-xs uppercase tracking-wider text-muted mb-2 block">
            Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Vitamin D, Tylenol, Gas drops…"
            className="w-full rounded-2xl border border-accent-soft bg-surface px-4 py-3 text-base text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>

        <div>
          <label className="text-xs uppercase tracking-wider text-muted mb-2 block">
            Dose <span className="lowercase opacity-70">(optional)</span>
          </label>
          <input
            type="text"
            value={dose}
            onChange={(e) => setDose(e.target.value)}
            placeholder="1 mL, 1 dropper, 80 mg…"
            className="w-full rounded-2xl border border-accent-soft bg-surface px-4 py-3 text-base text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>

        <div>
          <label className="text-xs uppercase tracking-wider text-muted mb-2 block">
            Notes <span className="lowercase opacity-70">(optional)</span>
          </label>
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder=""
            className="w-full rounded-2xl border border-accent-soft bg-surface px-4 py-3 text-base text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>

        <button
          type="button"
          onClick={confirm}
          disabled={!name.trim()}
          className="mt-2 w-full rounded-2xl bg-accent px-4 py-4 text-base font-bold text-white shadow-sm transition-all duration-150 hover:shadow-md hover:brightness-105 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {!name.trim() ? "Enter a medication name" : "Log medication"}
        </button>
      </div>
    </Sheet>
  );
}

function TemperaturePanel({
  events,
  onClose,
  onLog,
}: {
  events?: BabyEvent[];
  onClose: () => void;
  onLog: (p: NewEventPayload, c: string) => Promise<void>;
}) {
  const [tempStr, setTempStr] = useState("");
  const [method, setMethod] = useState<TempMethod | null>(null);
  const [notes, setNotes] = useState("");

  // Most recent prior temperature reading, for context.
  const prior = (() => {
    if (!events) return null;
    for (const e of events) {
      if (e.type === "temperature") return e;
    }
    return null;
  })();

  const tempF =
    tempStr && Number(tempStr) > 0 && Number(tempStr) < 115
      ? Number(tempStr)
      : null;
  const isFever = tempF != null && tempF >= FEVER_THRESHOLD_F;
  const isHighFever = tempF != null && tempF >= HIGH_FEVER_THRESHOLD_F;
  const delta =
    tempF != null && prior ? tempF - prior.temp_f : null;

  function confirm() {
    if (tempF == null) return;
    const payload: NewEventPayload = { type: "temperature", temp_f: tempF };
    if (method) payload.method = method;
    const trimmedNotes = notes.trim();
    if (trimmedNotes) payload.notes = trimmedNotes;
    onLog(payload, `Temp logged: ${tempF.toFixed(1)}°F`);
  }

  return (
    <Sheet title="Temperature" onClose={onClose}>
      <div className="flex flex-col gap-4">
        {prior && (
          <div className="rounded-2xl bg-background border border-accent-soft px-4 py-2 text-xs text-muted flex items-baseline justify-between gap-2">
            <span>
              Last reading{" "}
              <span className="text-foreground font-semibold tabular-nums">
                {prior.temp_f.toFixed(1)}°F
              </span>
              {prior.method && (
                <span className="text-muted"> · {prior.method}</span>
              )}
            </span>
            <span className="tabular-nums">
              {formatRelativeShort(prior.occurred_at.toDate())}
            </span>
          </div>
        )}
        <div>
          <label className="text-xs uppercase tracking-wider text-muted mb-2 block">
            Temperature (°F)
          </label>
          <input
            type="number"
            inputMode="decimal"
            step="0.1"
            min={90}
            max={115}
            placeholder="98.6"
            value={tempStr}
            onChange={(e) => setTempStr(e.target.value)}
            className={
              "w-full rounded-2xl border bg-surface px-4 py-3 text-base text-foreground focus:outline-none focus:ring-2 " +
              (isHighFever
                ? "border-rose-500 focus:ring-rose-500"
                : isFever
                  ? "border-amber-500 focus:ring-amber-500"
                  : "border-accent-soft focus:ring-accent")
            }
          />
          {delta != null && (
            <p className="mt-1 text-xs text-muted tabular-nums">
              {delta > 0 ? "↑" : delta < 0 ? "↓" : "="}
              {" "}
              {Math.abs(delta).toFixed(1)}°F vs. last reading
            </p>
          )}
          {isHighFever && (
            <p className="mt-2 text-xs text-rose-600 font-medium">
              High fever — call the pediatrician.
            </p>
          )}
          {isFever && !isHighFever && (
            <p className="mt-2 text-xs text-amber-700 dark:text-amber-400 font-medium">
              Fever (≥ 100.4°F).
            </p>
          )}
        </div>

        <div>
          <p className="text-xs uppercase tracking-wider text-muted mb-2">
            Method <span className="lowercase opacity-70">(optional)</span>
          </p>
          <div className="grid grid-cols-2 gap-2">
            {TEMP_METHODS.map((m) => {
              const active = method === m.value;
              return (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => setMethod(active ? null : m.value)}
                  className={
                    "min-h-[48px] rounded-xl text-sm font-semibold border transition-all duration-150 active:scale-[0.97] " +
                    (active
                      ? "bg-accent text-white border-accent"
                      : "bg-surface text-foreground border-accent-soft hover:border-accent/50")
                  }
                >
                  {m.label}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label className="text-xs uppercase tracking-wider text-muted mb-2 block">
            Notes <span className="lowercase opacity-70">(optional)</span>
          </label>
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full rounded-2xl border border-accent-soft bg-surface px-4 py-3 text-base text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>

        <button
          type="button"
          onClick={confirm}
          disabled={tempF == null}
          className="mt-2 w-full rounded-2xl bg-accent px-4 py-4 text-base font-bold text-white shadow-sm transition-all duration-150 hover:shadow-md hover:brightness-105 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {tempF == null ? "Enter a temperature" : `Log ${tempF.toFixed(1)}°F`}
        </button>
      </div>
    </Sheet>
  );
}
