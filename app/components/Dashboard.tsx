"use client";

import { useEffect, useState } from "react";
import { LILY_BIRTHDATE, formatBabyAge } from "@/lib/age";
import { formatElapsed, formatLiveElapsed, formatVolume } from "@/lib/format";
import type { BabyEvent } from "@/lib/events";
import {
  buildDailyBuckets,
  currentSleepState,
  estimateNextEvent,
} from "@/lib/aggregates";
import { maxFeedIntervalHours } from "@/lib/norms";
import { FunAge } from "./FunAge";

type Derived = {
  lastFeed: { summary: string; at: Date } | null;
  lastBreast: { summary: string; at: Date } | null;
  lastPump: { summary: string; at: Date } | null;
  lastDiaper: { summary: string; at: Date } | null;
  sleepingSince: Date | null;
  lastWokeAt: Date | null;
};

const SESSION_THRESHOLD_MS = 5000;

function lastSession(
  events: BabyEvent[],
  types: BabyEvent["type"][],
): BabyEvent[] {
  const results: BabyEvent[] = [];
  let anchorMs: number | null = null;
  for (const e of events) {
    if (!types.includes(e.type)) continue;
    const ms = e.occurred_at.toMillis();
    if (anchorMs === null) {
      anchorMs = ms;
      results.push(e);
    } else if (Math.abs(ms - anchorMs) <= SESSION_THRESHOLD_MS) {
      results.push(e);
    } else {
      break;
    }
  }
  return results;
}

function shortSide(side: string | undefined): string {
  if (!side) return "";
  if (side === "both") return "L+R";
  return side === "left" ? "L" : "R";
}

function shortOutcome(outcome: string): string {
  return outcome === "latched_fed"
    ? "fed"
    : outcome === "latched_brief"
      ? "brief"
      : "no latch";
}

function summarizeBreastSession(session: BabyEvent[]): string {
  const parts = session.map((e) => {
    if (e.type !== "breast_feed") return "";
    const side = shortSide(e.side);
    const outcome = shortOutcome(e.outcome);
    return side ? `${side} ${outcome}` : outcome;
  });
  return parts.join(", ");
}

function summarizePumpSession(session: BabyEvent[]): string {
  const parts = session.map((e) => {
    if (e.type !== "pump") return "";
    const side = shortSide(e.side);
    return side ? `${side} ${e.volume_ml}ml` : `${e.volume_ml}ml`;
  });
  const total = session.reduce(
    (sum, e) => (e.type === "pump" ? sum + e.volume_ml : sum),
    0,
  );
  const suffix = session.length > 1 ? ` (${total}ml)` : "";
  return `${parts.join(", ")}${suffix}`;
}

function deriveState(events: BabyEvent[], now: Date): Derived {
  const sleep = currentSleepState(events, 10, now);
  const sleepingSince = sleep.sleeping ? sleep.since : null;
  let lastWokeAt: Date | null = null;
  if (!sleep.sleeping) {
    for (const e of events) {
      if (e.type === "sleep_end") {
        lastWokeAt = e.occurred_at.toDate();
        break;
      }
    }
  }

  let lastFeed: Derived["lastFeed"] = null;
  let lastBreast: Derived["lastBreast"] = null;
  let lastPump: Derived["lastPump"] = null;
  let lastDiaper: Derived["lastDiaper"] = null;

  const feedSession = lastSession(events, ["breast_feed", "bottle_feed"]);
  if (feedSession.length > 0) {
    const anchor = feedSession[0]!;
    const at = anchor.occurred_at.toDate();
    if (anchor.type === "bottle_feed") {
      lastFeed = { summary: `Bottle · ${formatVolume(anchor.volume_ml)}`, at };
    } else {
      // Breast feed: group may contain L + R events.
      const breastOnly = feedSession.filter((e) => e.type === "breast_feed");
      lastFeed = {
        summary: `Breast · ${summarizeBreastSession(breastOnly)}`,
        at,
      };
    }
  }

  const breastSession = lastSession(events, ["breast_feed"]);
  if (breastSession.length > 0) {
    const at = breastSession[0]!.occurred_at.toDate();
    lastBreast = { summary: summarizeBreastSession(breastSession), at };
  }

  const pumpSession = lastSession(events, ["pump"]);
  if (pumpSession.length > 0) {
    const at = pumpSession[0]!.occurred_at.toDate();
    lastPump = { summary: summarizePumpSession(pumpSession), at };
  }

  for (const e of events) {
    if (e.type === "diaper_wet" || e.type === "diaper_dirty") {
      lastDiaper = {
        summary: e.type === "diaper_wet" ? "Wet" : "Dirty",
        at: e.occurred_at.toDate(),
      };
      break;
    }
  }

  return {
    lastFeed,
    lastBreast,
    lastPump,
    lastDiaper,
    sleepingSince,
    lastWokeAt,
  };
}

export function Dashboard({ events }: { events: BabyEvent[] }) {
  const [now, setNow] = useState(() => Date.now());
  const derived = deriveState(events, new Date(now));
  const nextFeed = estimateNextEvent(events, ["breast_feed", "bottle_feed"]);
  // Merge wet+dirty events within 15 minutes — they're typically the same change.
  const nextDiaper = estimateNextEvent(
    events,
    ["diaper_wet", "diaper_dirty"],
    8,
    15 * 60 * 1000,
  );

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const age = formatBabyAge(LILY_BIRTHDATE, new Date(now));

  const todayBucket = buildDailyBuckets(events, 1, new Date(now), {
    inferBufferMin: 10,
  })[0];
  const sleepHours = todayBucket ? todayBucket.sleepMinutes / 60 : 0;
  const sleepHrsWhole = Math.floor(sleepHours);
  const sleepMinsRem = Math.round((sleepHours - sleepHrsWhole) * 60);
  const sleepText =
    sleepHrsWhole > 0
      ? `${sleepHrsWhole}h ${sleepMinsRem}m`
      : `${sleepMinsRem}m`;

  function formatETA(target: Date): { text: string; overdue: boolean } {
    const diffMs = target.getTime() - now;
    if (diffMs < 0) {
      return { text: `overdue ${formatElapsed(-diffMs, true)}`, overdue: true };
    }
    return { text: `in ${formatElapsed(diffMs, true)}`, overdue: false };
  }

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

      {todayBucket && (todayBucket.feeds > 0 || todayBucket.diapers > 0 || todayBucket.sleepMinutes > 0) && (
        <div className="w-full rounded-2xl border border-accent-soft bg-surface px-4 py-2 flex items-baseline justify-center gap-3 text-xs text-foreground tabular-nums flex-wrap">
          <span className="text-[10px] uppercase tracking-wider text-muted">Today</span>
          <span>
            <span className="font-bold">{todayBucket.feeds}</span>
            <span className="text-muted"> feeds</span>
          </span>
          <span className="text-muted">·</span>
          <span>
            <span className="font-bold">{todayBucket.diapers}</span>
            <span className="text-muted"> diapers</span>
          </span>
          <span className="text-muted">·</span>
          <span>
            <span className="font-bold">{sleepText}</span>
            <span className="text-muted"> sleep</span>
          </span>
        </div>
      )}

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
          label="Last breast"
          value={
            derived.lastBreast
              ? `${formatElapsed(now - derived.lastBreast.at.getTime())}`
              : "—"
          }
          detail={derived.lastBreast?.summary}
        />
        <Row
          label="Last pump"
          value={
            derived.lastPump
              ? `${formatElapsed(now - derived.lastPump.at.getTime())}`
              : "—"
          }
          detail={derived.lastPump?.summary}
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
        {derived.sleepingSince && (
          <Row
            label="Sleeping"
            value={formatLiveElapsed(now - derived.sleepingSince.getTime())}
            detail="since"
            highlight
          />
        )}
      </div>

      {(nextFeed || nextDiaper) && (
        <div className="w-full grid grid-cols-1 gap-1 rounded-2xl border border-accent-soft bg-surface px-4 py-3">
          <p className="text-[10px] uppercase tracking-wider text-muted">
            Predicted next (based on recent intervals)
          </p>
          {nextFeed && (() => {
            const ageDays = Math.max(
              0,
              Math.floor((now - LILY_BIRTHDATE.getTime()) / 86400000),
            );
            const maxHours = maxFeedIntervalHours(ageDays);
            const intervalHours = nextFeed.medianIntervalMs / 3600000;
            const longGap = intervalHours > maxHours;
            const time = nextFeed.nextAt.toLocaleTimeString(undefined, {
              hour: "numeric",
              minute: "2-digit",
            });
            return (
              <Row
                label="Next feed"
                value={formatETA(nextFeed.nextAt).text}
                detail={longGap ? `${time} · long gap` : time}
                highlight={formatETA(nextFeed.nextAt).overdue}
              />
            );
          })()}
          {nextDiaper && (
            <Row
              label="Next diaper"
              value={formatETA(nextDiaper.nextAt).text}
              detail={nextDiaper.nextAt.toLocaleTimeString(undefined, {
                hour: "numeric",
                minute: "2-digit",
              })}
              highlight={formatETA(nextDiaper.nextAt).overdue}
            />
          )}
        </div>
      )}
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
    <div className="flex flex-col">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm text-muted">{label}</span>
        <span
          className={
            "text-sm font-medium tabular-nums " +
            (highlight ? "text-accent" : "text-foreground")
          }
        >
          {value}
        </span>
      </div>
      {detail && (
        <div className="text-right text-xs text-muted -mt-0.5">{detail}</div>
      )}
    </div>
  );
}

export function isCurrentlySleeping(events: BabyEvent[]): boolean {
  return currentSleepState(events, 10).sleeping;
}
