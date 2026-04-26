"use client";

import { useEffect, useState } from "react";
import { formatBabyAge } from "@/lib/age";
import { useBaby } from "@/lib/useBaby";
import {
  formatElapsed,
  formatLiveElapsed,
  formatRelativeShort,
  formatVolume,
} from "@/lib/format";
import {
  canonicalMedName,
  lookupCommonMed,
  FEVER_THRESHOLD_F,
  HIGH_FEVER_THRESHOLD_F,
  type BabyEvent,
} from "@/lib/events";
import {
  buildDailyBuckets,
  currentSleepState,
  estimateNextEvent,
  explicitSleepWindows,
  inferredSleepWindows,
} from "@/lib/aggregates";
import {
  maxFeedIntervalHours,
  minSensibleFeedIntervalHours,
  wakeWindowMinutes,
} from "@/lib/norms";
import { rhythmClassFor, useFunAgeMode } from "@/lib/rhythm";
import { FunAge } from "./FunAge";

type Derived = {
  lastFeed: { summary: string; at: Date } | null;
  lastBreast: { summary: string; at: Date } | null;
  lastPump: { summary: string; at: Date } | null;
  lastDiaper: { summary: string; at: Date } | null;
  lastMedication: { summary: string; at: Date } | null;
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
    // The "awake since" anchor must be the END of the most recent sleep
    // window — explicit OR inferred. Using only explicit sleep_end events
    // produces nonsense like "awake 149h" when sleeps end implicitly via
    // feeds (the common case once parents stop tapping every wake-up).
    const windows = [
      ...explicitSleepWindows(events, now),
      ...inferredSleepWindows(events, 10, now),
    ].filter((w) => !w.ongoing && w.end.getTime() <= now.getTime());
    if (windows.length > 0) {
      windows.sort((a, b) => b.end.getTime() - a.end.getTime());
      lastWokeAt = windows[0]!.end;
    }
  }

  let lastFeed: Derived["lastFeed"] = null;
  let lastBreast: Derived["lastBreast"] = null;
  let lastPump: Derived["lastPump"] = null;
  let lastDiaper: Derived["lastDiaper"] = null;
  let lastMedication: Derived["lastMedication"] = null;

  const feedSession = lastSession(events, ["breast_feed", "bottle_feed"]);
  if (feedSession.length > 0) {
    const anchor = feedSession[0]!;
    const at = anchor.occurred_at.toDate();
    if (anchor.type === "bottle_feed") {
      lastFeed = { summary: `Bottle · ${formatVolume(anchor.volume_ml)}`, at };
    } else {
      // Nursing: group may contain L + R events.
      const breastOnly = feedSession.filter((e) => e.type === "breast_feed");
      lastFeed = {
        summary: `Nursing · ${summarizeBreastSession(breastOnly)}`,
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
    if (
      e.type === "diaper_wet" ||
      e.type === "diaper_dirty" ||
      e.type === "diaper_mixed"
    ) {
      lastDiaper = {
        summary:
          e.type === "diaper_wet"
            ? "Wet"
            : e.type === "diaper_dirty"
              ? "Dirty"
              : "Mixed",
        at: e.occurred_at.toDate(),
      };
      break;
    }
  }

  for (const e of events) {
    if (e.type === "medication") {
      lastMedication = {
        summary: e.dose ? `${e.name} · ${e.dose}` : e.name,
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
    lastMedication,
    sleepingSince,
    lastWokeAt,
  };
}

export function Dashboard({
  events,
  homeView,
}: {
  events: BabyEvent[];
  homeView?: import("@/lib/views").HomeView | null;
}) {
  // homeView is consumed once we wire the dashboard fully off raw events.
  // Currently it's accepted-but-unused so HomeClient can pass it through;
  // a follow-up pass will read latest pointers / today / sleep_state from
  // it and stop deriving them from `events`.
  void homeView;
  const [now, setNow] = useState(() => Date.now());
  const funAgeMode = useFunAgeMode();
  const rhythmClass = rhythmClassFor(funAgeMode);
  const baby = useBaby();
  const derived = deriveState(events, new Date(now));
  // Merge feed events within 15 min — L+R breast sessions or quick top-ups are
  // a single feeding, not two separate data points.
  const rawNextFeed = estimateNextEvent(
    events,
    ["breast_feed", "bottle_feed"],
    8,
    15 * 60 * 1000,
  );
  const feedAgeDays = Math.max(
    0,
    Math.floor((now - baby.birthdate.getTime()) / 86400000),
  );
  const feedFloorMs =
    minSensibleFeedIntervalHours(feedAgeDays) * 3600000;
  // Clamp the median to the age-appropriate floor so noisy data can't produce
  // nonsensically close-together predictions.
  const nextFeed =
    rawNextFeed && rawNextFeed.medianIntervalMs < feedFloorMs
      ? {
          ...rawNextFeed,
          medianIntervalMs: feedFloorMs,
          nextAt: new Date(rawNextFeed.lastAt.getTime() + feedFloorMs),
        }
      : rawNextFeed;
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

  const age = formatBabyAge(baby.birthdate, new Date(now));

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
        <h1
          className={`text-3xl font-extrabold tracking-tight text-accent ${rhythmClass}`}
          style={{ transformOrigin: "center" }}
        >
          {baby.name}
        </h1>
        <p className="text-xs font-semibold text-foreground tabular-nums">
          {age}
        </p>
        <FunAge />
      </div>

      {todayBucket && (todayBucket.feeds > 0 || todayBucket.diapers > 0 || todayBucket.sleepMinutes > 0) && (
        <div
          className="w-full rounded-2xl border border-accent-soft bg-surface px-4 py-2 flex items-baseline justify-center gap-3 text-xs text-foreground tabular-nums flex-wrap"
        >
          <span className="text-[10px] uppercase tracking-wider text-muted">Today</span>
          <span>
            <span className="font-bold">{todayBucket.feeds}</span>
            <span className="text-muted"> feeds</span>
          </span>
          <span className="text-muted">·</span>
          <span title="Wet (incl. mixed) / Dirty (incl. mixed)">
            <span className="font-bold">{todayBucket.wets}</span>
            <span className="text-muted">w</span>
            <span className="text-muted"> / </span>
            <span className="font-bold">{todayBucket.dirties}</span>
            <span className="text-muted">d</span>
          </span>
          <span className="text-muted">·</span>
          <span>
            <span className="font-bold">{sleepText}</span>
            <span className="text-muted"> sleep</span>
          </span>
        </div>
      )}

      <FeverCard events={events} ageDays={feedAgeDays} now={now} />
      <MedAdherenceCard events={events} now={new Date(now)} />

      <SleepStatusChip
        sleepingSince={derived.sleepingSince}
        lastWokeAt={derived.lastWokeAt}
        ageDays={feedAgeDays}
        now={now}
      />

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
          label="Last nursing"
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
      </div>

      {(nextFeed || nextDiaper) && (
        <div className="w-full grid grid-cols-1 gap-1 rounded-2xl border border-accent-soft bg-surface px-4 py-3">
          <p className="text-[10px] uppercase tracking-wider text-muted">
            Predicted next (based on recent intervals)
          </p>
          {nextFeed && (() => {
            const ageDays = Math.max(
              0,
              Math.floor((now - baby.birthdate.getTime()) / 86400000),
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

function SleepStatusChip({
  sleepingSince,
  lastWokeAt,
  ageDays,
  now,
}: {
  sleepingSince: Date | null;
  lastWokeAt: Date | null;
  ageDays: number;
  now: number;
}) {
  if (sleepingSince) {
    const ms = now - sleepingSince.getTime();
    return (
      <div className="w-full rounded-2xl border border-accent/40 bg-accent/10 px-4 py-2.5 flex items-baseline justify-between gap-3">
        <span className="text-xs uppercase tracking-wider text-muted">
          Sleeping
        </span>
        <span className="text-base font-semibold text-accent tabular-nums">
          {formatLiveElapsed(ms)}
        </span>
      </div>
    );
  }
  if (!lastWokeAt) return null;
  const awakeMs = now - lastWokeAt.getTime();
  const win = wakeWindowMinutes(ageDays);
  const overMs = awakeMs - win.max * 60_000;
  const tone =
    overMs >= 30 * 60_000 ? "rose" : overMs >= 0 ? "amber" : "neutral";
  const containerClass =
    tone === "rose"
      ? "border-rose-300 bg-rose-50/70 dark:border-rose-900/60 dark:bg-rose-950/20"
      : tone === "amber"
        ? "border-amber-300 bg-amber-50/70 dark:border-amber-900/60 dark:bg-amber-950/20"
        : "border-accent-soft bg-surface";
  const valueClass =
    tone === "rose"
      ? "text-rose-700 dark:text-rose-300"
      : tone === "amber"
        ? "text-amber-700 dark:text-amber-300"
        : "text-foreground";
  const note =
    tone === "rose"
      ? "overtired — try a nap"
      : tone === "amber"
        ? "past wake window"
        : `target ${win.min}–${win.max}m`;
  return (
    <div className={"w-full rounded-2xl border px-4 py-2.5 flex items-baseline justify-between gap-3 " + containerClass}>
      <span className="text-xs uppercase tracking-wider text-muted">
        Awake
      </span>
      <div className="flex flex-col items-end">
        <span className={"text-base font-semibold tabular-nums " + valueClass}>
          {formatLiveElapsed(awakeMs)}
        </span>
        <span className="text-[10px] text-muted">{note}</span>
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

// ---------- Medication adherence -----------------------------------------

type MedItem = {
  displayName: string;
  cadence: "daily" | "prn";
  last: Extract<BabyEvent, { type: "medication" }>;
  givenToday: boolean;
};

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function deriveMedItems(events: BabyEvent[], now: Date): MedItem[] {
  const sevenAgoMs = now.getTime() - 7 * 86400_000;
  const todayKey = dayKey(now);
  const byKey = new Map<
    string,
    {
      displayName: string;
      events: Extract<BabyEvent, { type: "medication" }>[];
    }
  >();
  for (const e of events) {
    if (e.type !== "medication") continue;
    if (e.occurred_at.toMillis() < sevenAgoMs) break; // newest-first
    const key = (canonicalMedName(e.name) ?? e.name.trim()).toLowerCase();
    const display = canonicalMedName(e.name) ?? e.name.trim();
    const entry = byKey.get(key) ?? { displayName: display, events: [] };
    entry.events.push(e);
    byKey.set(key, entry);
  }
  const items: MedItem[] = [];
  for (const { displayName, events: list } of byKey.values()) {
    const common = lookupCommonMed(displayName);
    const cadence: "daily" | "prn" = common?.cadence ?? "prn";
    const last = list[0]!;
    const givenToday = list.some(
      (e) => dayKey(e.occurred_at.toDate()) === todayKey,
    );
    items.push({ displayName, cadence, last, givenToday });
  }
  // Action-required first: daily not-yet-given today.
  // Then daily given today, then PRN by recency.
  items.sort((a, b) => {
    const rank = (x: MedItem) =>
      x.cadence === "daily" && !x.givenToday
        ? 0
        : x.cadence === "daily"
          ? 1
          : 2;
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    return b.last.occurred_at.toMillis() - a.last.occurred_at.toMillis();
  });
  return items;
}

function MedAdherenceCard({
  events,
  now,
}: {
  events: BabyEvent[];
  now: Date;
}) {
  const items = deriveMedItems(events, now);
  if (items.length === 0) return null;
  return (
    <div className="w-full rounded-2xl border border-accent-soft bg-surface px-4 py-3 flex flex-col gap-1.5">
      <p className="text-[10px] uppercase tracking-wider text-muted">
        Today&apos;s meds
      </p>
      {items.map((item) => (
        <MedRow key={item.displayName} item={item} now={now} />
      ))}
    </div>
  );
}

function MedRow({ item, now }: { item: MedItem; now: Date }) {
  const lastDate = item.last.occurred_at.toDate();
  const todayKey = dayKey(now);
  let value: string;
  let valueClass: string;
  if (item.cadence === "daily") {
    if (item.givenToday) {
      value = `✓ ${lastDate.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
      valueClass = "text-emerald-600 dark:text-emerald-400";
    } else {
      value = "—";
      valueClass = "text-amber-600";
    }
  } else {
    // PRN: show relative time, but flag if same-day repeat is recent
    if (dayKey(lastDate) === todayKey) {
      value = formatRelativeShort(lastDate, now);
      valueClass = "text-foreground";
    } else {
      value = formatRelativeShort(lastDate, now);
      valueClass = "text-muted";
    }
  }
  const dose = item.last.dose ? ` · ${item.last.dose}` : "";
  return (
    <div className="flex items-baseline justify-between gap-2 text-sm">
      <span className="text-foreground truncate">
        {item.displayName}
        <span className="text-muted text-xs">{dose}</span>
      </span>
      <span className={"tabular-nums font-medium " + valueClass}>
        {value}
      </span>
    </div>
  );
}

// ---------- Active fever card --------------------------------------------

const FEVER_LOOKBACK_MS = 24 * 60 * 60 * 1000;

function recentTemps(
  events: BabyEvent[],
  now: number,
): Extract<BabyEvent, { type: "temperature" }>[] {
  const cutoff = now - FEVER_LOOKBACK_MS;
  const list: Extract<BabyEvent, { type: "temperature" }>[] = [];
  for (const e of events) {
    if (e.type !== "temperature") continue;
    if (e.occurred_at.toMillis() < cutoff) break;
    list.push(e);
  }
  return list;
}

// AAP fever-when-to-call rules, simplified. Returns the most relevant
// guidance line for the (age, current temp) pair.
function feverCallGuidance(
  ageDays: number,
  tempF: number,
): string | null {
  if (ageDays < 90) {
    if (tempF >= 100.4) return "Under 3 months: any fever ≥100.4°F — call now.";
    return null;
  }
  if (ageDays < 180) {
    if (tempF >= 102) return "3–6 months & ≥102°F — call the pediatrician.";
    if (tempF >= 100.4) return "Fever — call if it persists past 24h.";
    return null;
  }
  if (ageDays < 730) {
    if (tempF >= 104) return "≥104°F — call now.";
    if (tempF >= 102) return "Fever ≥102°F — call if it persists past 24h.";
    if (tempF >= 100.4) return "Fever — call if it persists past 72h.";
    return null;
  }
  if (tempF >= 104) return "≥104°F — call now.";
  if (tempF >= 102) return "Fever ≥102°F — call if it persists past 72h.";
  return null;
}

function FeverCard({
  events,
  ageDays,
  now,
}: {
  events: BabyEvent[];
  ageDays: number;
  now: number;
}) {
  const recents = recentTemps(events, now);
  const latest = recents[0];
  if (!latest || latest.temp_f < FEVER_THRESHOLD_F) return null;

  // Build a chronological (oldest-first) list of up to 8 readings.
  const series = recents.slice(0, 8).reverse();
  const tone =
    latest.temp_f >= HIGH_FEVER_THRESHOLD_F ? "rose" : "amber";
  const trend = (() => {
    if (series.length < 2) return null;
    const first = series[0]!.temp_f;
    const last = series[series.length - 1]!.temp_f;
    const diff = last - first;
    if (Math.abs(diff) < 0.3) return "holding";
    return diff > 0 ? "rising" : "easing";
  })();
  const guidance = feverCallGuidance(ageDays, latest.temp_f);

  const containerClass =
    tone === "rose"
      ? "border-rose-300 bg-rose-50 dark:border-rose-900/60 dark:bg-rose-950/30"
      : "border-amber-300 bg-amber-50 dark:border-amber-900/60 dark:bg-amber-950/30";
  const valueClass =
    tone === "rose"
      ? "text-rose-700 dark:text-rose-300"
      : "text-amber-700 dark:text-amber-300";

  return (
    <div className={"w-full rounded-2xl border px-4 py-3 flex flex-col gap-2 " + containerClass}>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[10px] uppercase tracking-wider text-muted">
          Fever tracking
        </p>
        <span className="text-[10px] text-muted">
          {formatRelativeShort(latest.occurred_at.toDate(), new Date(now))}
        </span>
      </div>
      <div className="flex items-baseline justify-between gap-2">
        <span className={"text-2xl font-bold tabular-nums " + valueClass}>
          {latest.temp_f.toFixed(1)}°F
        </span>
        {trend && (
          <span className="text-xs text-muted">
            {trend === "rising"
              ? "↑ rising"
              : trend === "easing"
                ? "↓ easing"
                : "→ holding"}
          </span>
        )}
      </div>
      {series.length >= 2 && <FeverSparkline series={series} tone={tone} />}
      {guidance && (
        <p className={"text-xs font-medium " + valueClass}>{guidance}</p>
      )}
    </div>
  );
}

function FeverSparkline({
  series,
  tone,
}: {
  series: Extract<BabyEvent, { type: "temperature" }>[];
  tone: "amber" | "rose";
}) {
  const W = 240;
  const H = 32;
  const PAD = 2;
  const temps = series.map((e) => e.temp_f);
  const min = Math.min(98, ...temps);
  const max = Math.max(...temps, 102);
  const span = max - min || 1;
  const xs = series.map((e) => e.occurred_at.toMillis());
  const t0 = xs[0]!;
  const tN = xs[xs.length - 1]!;
  const tspan = tN - t0 || 1;
  const points = series.map((e, i) => {
    const x = PAD + ((e.occurred_at.toMillis() - t0) / tspan) * (W - 2 * PAD);
    const y = H - PAD - ((e.temp_f - min) / span) * (H - 2 * PAD);
    return { x, y, i };
  });
  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(" ");
  const stroke = tone === "rose" ? "rgb(225 29 72)" : "rgb(217 119 6)";
  // 100.4 reference line
  const yFever = H - PAD - ((100.4 - min) / span) * (H - 2 * PAD);
  return (
    <svg
      width="100%"
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <line
        x1={0}
        x2={W}
        y1={yFever}
        y2={yFever}
        stroke="currentColor"
        strokeOpacity={0.2}
        strokeDasharray="2 3"
      />
      <path d={path} fill="none" stroke={stroke} strokeWidth={1.5} />
      {points.map((p) => (
        <circle key={p.i} cx={p.x} cy={p.y} r={2} fill={stroke} />
      ))}
    </svg>
  );
}
