"use client";

import { useEffect, useState } from "react";
import { formatLiveElapsed } from "@/lib/format";
import { writeEvent } from "@/lib/useEvents";
import { currentSleepState } from "@/lib/aggregates";
import type { BabyEvent } from "@/lib/events";

export function SleepControl({ events }: { events: BabyEvent[] }) {
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const state = currentSleepState(events, 10, new Date(now));
  const { sleeping, since, source } = state;

  async function toggle() {
    if (busy) return;
    setBusy(true);
    try {
      await writeEvent(
        { type: sleeping ? "sleep_end" : "sleep_start" },
        undefined,
        events,
      );
      setFlash(sleeping ? "Woke up" : "Sleep started");
      setTimeout(() => setFlash(null), 1800);
    } catch (err) {
      setFlash(
        err instanceof Error ? `Couldn't save: ${err.message}` : "Couldn't save",
      );
      setTimeout(() => setFlash(null), 3500);
    } finally {
      setBusy(false);
    }
  }

  const elapsedMs = since ? now - since.getTime() : 0;

  return (
    <div className="w-full flex flex-col gap-1">
      <button
        type="button"
        onClick={toggle}
        disabled={busy}
        style={{
          touchAction: "manipulation",
          WebkitTapHighlightColor: "transparent",
        }}
        className={
          "w-full min-h-[96px] rounded-3xl px-5 py-4 shadow-sm transition-all duration-150 hover:shadow-md active:scale-[0.98] active:shadow-sm flex items-center justify-between gap-4 " +
          (sleeping
            ? "bg-accent text-white hover:brightness-105"
            : "bg-surface border border-accent-soft text-foreground hover:border-accent/60 hover:-translate-y-px")
        }
      >
        <span className="flex items-center gap-3">
          <SleepIcon sleeping={sleeping} />
          <span className="flex flex-col items-start text-left">
            <span className="text-base font-bold">
              {sleeping
                ? source === "inferred"
                  ? "Mark awake"
                  : "Wake up"
                : "Put down for sleep"}
            </span>
            <span
              className={
                "text-xs " + (sleeping ? "text-white/80" : "text-muted")
              }
            >
              {sleeping
                ? source === "inferred"
                  ? "assumed asleep between feeds"
                  : "tap when she wakes"
                : "tap when she's in the bassinet"}
            </span>
          </span>
        </span>
        {sleeping && since && (
          <span className="text-xl font-bold tabular-nums">
            {formatLiveElapsed(elapsedMs)}
          </span>
        )}
      </button>
      <p className="h-4 text-center text-xs text-muted">{flash ?? ""}</p>
    </div>
  );
}

function SleepIcon({ sleeping }: { sleeping: boolean }) {
  if (sleeping) {
    return (
      <svg
        viewBox="0 0 24 24"
        width="24"
        height="24"
        fill="currentColor"
        aria-hidden="true"
      >
        <circle cx="5" cy="12" r="1.3" />
        <path d="M9 4h8l-8 16h8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </svg>
    );
  }
  return (
    <svg
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

