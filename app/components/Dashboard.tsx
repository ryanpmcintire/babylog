"use client";

import { useEffect, useState } from "react";
import { LILY_BIRTHDATE, formatBabyAge } from "@/lib/age";
import { formatElapsed, formatLiveElapsed, formatVolume } from "@/lib/format";
import type { BabyEvent } from "@/lib/events";
import { FunAge } from "./FunAge";

type Derived = {
  lastFeed: { summary: string; at: Date } | null;
  lastDiaper: { summary: string; at: Date } | null;
  sleepingSince: Date | null;
  lastWokeAt: Date | null;
};

function deriveState(events: BabyEvent[]): Derived {
  // events is ordered newest-first.
  let lastFeed: Derived["lastFeed"] = null;
  let lastDiaper: Derived["lastDiaper"] = null;
  let sleepingSince: Date | null = null;
  let lastWokeAt: Date | null = null;

  let sleepHandled = false;

  for (const e of events) {
    const at = e.occurred_at.toDate();
    if (!lastFeed && (e.type === "bottle_feed" || e.type === "breast_feed")) {
      if (e.type === "bottle_feed") {
        lastFeed = { summary: `Bottle · ${formatVolume(e.volume_ml)}`, at };
      } else {
        const outcomeLabel =
          e.outcome === "latched_fed"
            ? "latched & fed"
            : e.outcome === "latched_brief"
              ? "latched briefly"
              : "didn't latch";
        lastFeed = { summary: `Breast · ${outcomeLabel}`, at };
      }
    }
    if (
      !lastDiaper &&
      (e.type === "diaper_wet" || e.type === "diaper_dirty")
    ) {
      lastDiaper = {
        summary: e.type === "diaper_wet" ? "Wet" : "Dirty",
        at,
      };
    }
    if (!sleepHandled && (e.type === "sleep_start" || e.type === "sleep_end")) {
      if (e.type === "sleep_start") {
        sleepingSince = at;
      } else {
        lastWokeAt = at;
      }
      sleepHandled = true;
    }
    if (lastFeed && lastDiaper && sleepHandled) break;
  }

  return { lastFeed, lastDiaper, sleepingSince, lastWokeAt };
}

export function Dashboard({ events }: { events: BabyEvent[] }) {
  const [now, setNow] = useState(() => Date.now());
  const derived = deriveState(events);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const age = formatBabyAge(LILY_BIRTHDATE, new Date(now));

  return (
    <div className="w-full flex flex-col items-center text-center gap-4">
      <div className="flex flex-col items-center gap-1.5">
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted">
          Babylog
        </p>
        <h1 className="text-3xl font-extrabold tracking-tight text-accent">
          Lily
        </h1>
        <p className="text-xs font-semibold text-foreground tabular-nums">
          {age}
        </p>
        <FunAge />
      </div>

      <div className="w-full grid grid-cols-1 gap-2 rounded-3xl border border-accent-soft bg-surface p-4 shadow-sm">
        <Row
          label="Last feed"
          value={
            derived.lastFeed
              ? `${formatElapsed(now - derived.lastFeed.at.getTime())}`
              : "—"
          }
          detail={derived.lastFeed?.summary}
        />
        <Row
          label="Last diaper"
          value={
            derived.lastDiaper
              ? `${formatElapsed(now - derived.lastDiaper.at.getTime())}`
              : "—"
          }
          detail={derived.lastDiaper?.summary}
        />
        <Row
          label={derived.sleepingSince ? "Sleeping" : "Awake"}
          value={
            derived.sleepingSince
              ? formatLiveElapsed(now - derived.sleepingSince.getTime())
              : derived.lastWokeAt
                ? formatElapsed(now - derived.lastWokeAt.getTime(), true)
                : "—"
          }
          detail={derived.sleepingSince ? "since" : undefined}
          highlight={Boolean(derived.sleepingSince)}
        />
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  detail,
  highlight,
}: {
  label: string;
  value: string;
  detail?: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-sm text-muted">{label}</span>
      <span className="flex items-baseline gap-2 text-right">
        {detail && <span className="text-xs text-muted">{detail}</span>}
        <span
          className={
            "text-lg font-bold tabular-nums " +
            (highlight ? "text-accent" : "text-foreground")
          }
        >
          {value}
        </span>
      </span>
    </div>
  );
}

export function isCurrentlySleeping(events: BabyEvent[]): boolean {
  for (const e of events) {
    if (e.type === "sleep_start") return true;
    if (e.type === "sleep_end") return false;
  }
  return false;
}
