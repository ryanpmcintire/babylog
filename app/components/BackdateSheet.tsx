"use client";

import { useMemo, useState } from "react";
import type { Side } from "@/lib/events";
import { ActionGrid } from "./ActionGrid";

const QUICK_PRESETS_MIN = [10, 30, 60, 120, 240];

function toLocalInput(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function BackdateSheet({
  sleeping,
  suggestedBreastSide,
  onClose,
}: {
  sleeping: boolean;
  suggestedBreastSide?: Side;
  onClose: () => void;
}) {
  const [selectedMinutesAgo, setSelectedMinutesAgo] = useState<number | null>(
    30,
  );
  const [customInput, setCustomInput] = useState<string | null>(null);

  const occurredAt = useMemo(() => {
    if (customInput) {
      const d = new Date(customInput);
      if (!Number.isNaN(d.getTime())) return d;
    }
    if (selectedMinutesAgo != null) {
      return new Date(Date.now() - selectedMinutesAgo * 60 * 1000);
    }
    return new Date();
  }, [selectedMinutesAgo, customInput]);

  const timeLabel = occurredAt.toLocaleString(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-40 bg-black/40 flex items-end sm:items-center justify-center"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
        className="w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl bg-background p-5 shadow-lg flex flex-col gap-5 max-h-[92vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">
            Log earlier event
          </h2>
          <button
            onClick={onClose}
            className="text-sm text-muted underline decoration-dotted underline-offset-4"
          >
            Done
          </button>
        </div>

        <div className="rounded-2xl border border-accent-soft bg-surface p-4 flex flex-col gap-3">
          <p className="text-xs uppercase tracking-wider text-muted">When</p>
          <div className="grid grid-cols-5 gap-2">
            {QUICK_PRESETS_MIN.map((m) => {
              const active =
                selectedMinutesAgo === m && customInput == null;
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    setSelectedMinutesAgo(m);
                    setCustomInput(null);
                  }}
                  className={
                    "rounded-xl px-2 py-2 text-xs font-semibold border transition " +
                    (active
                      ? "bg-accent text-white border-accent"
                      : "bg-background text-foreground border-accent-soft")
                  }
                >
                  {m < 60 ? `${m}m` : `${m / 60}h`} ago
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-2">
            <input
              type="datetime-local"
              value={customInput ?? toLocalInput(occurredAt)}
              onChange={(e) => {
                setCustomInput(e.target.value || null);
                setSelectedMinutesAgo(null);
              }}
              className="flex-1 rounded-xl border border-accent-soft bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
          <p className="text-xs text-muted text-center">
            Logging at <span className="font-semibold">{timeLabel}</span>
          </p>
        </div>

        <div>
          <p className="text-xs uppercase tracking-wider text-muted mb-2">
            What happened
          </p>
          <ActionGrid
            sleeping={sleeping}
            occurredAt={occurredAt}
            backdate
            suggestedBreastSide={suggestedBreastSide}
          />
        </div>
      </div>
    </div>
  );
}
