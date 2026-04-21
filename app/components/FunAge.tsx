"use client";

import { useEffect, useState } from "react";
import { LILY_BIRTHDATE, ageInMs } from "@/lib/age";
import {
  readFunAgeMode,
  setFunAgeMode,
  type FunAgeMode,
} from "@/lib/rhythm";

const NEWBORN_BPS = 135 / 60;
const NEWBORN_BREATHS_PER_SEC = 42 / 60;
const LUNAR_CYCLE_DAYS = 29.530588;

const MODE_ORDER: FunAgeMode[] = [
  "tally",
  "minutes",
  "heartbeats",
  "breaths",
  "moons",
  "firstYear",
];

export function FunAge() {
  const [modeIdx, setModeIdx] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const stored = readFunAgeMode();
    if (stored) {
      const idx = MODE_ORDER.indexOf(stored);
      if (idx >= 0) setModeIdx(idx);
    }
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const ms = ageInMs(LILY_BIRTHDATE, new Date(now));
  const totalSeconds = Math.floor(ms / 1000);
  const totalMinutes = Math.floor(ms / 60000);
  const days = ms / 86400000;
  const wholeDays = Math.floor(days);
  const dayFraction = days - wholeDays;

  const mode = MODE_ORDER[modeIdx % MODE_ORDER.length]!;

  function cycle() {
    const next = (modeIdx + 1) % MODE_ORDER.length;
    setModeIdx(next);
    setFunAgeMode(MODE_ORDER[next]!);
  }

  return (
    <button
      type="button"
      onClick={cycle}
      aria-label="Tap to show a different unit"
      className="flex flex-col items-center gap-1 text-muted hover:text-foreground transition"
    >
      {mode === "tally" && (
        <TallyMarks days={wholeDays} fraction={dayFraction} />
      )}
      {mode === "minutes" && (
        <StatLine
          value={`${totalMinutes.toLocaleString()}m ${(totalSeconds % 60)
            .toString()
            .padStart(2, "0")}s`}
          unit="since birth"
        />
      )}
      {mode === "heartbeats" && (
        <StatLine
          value={Math.round(totalSeconds * NEWBORN_BPS).toLocaleString()}
          unit="heartbeats (est.)"
        />
      )}
      {mode === "breaths" && (
        <StatLine
          value={Math.round(
            totalSeconds * NEWBORN_BREATHS_PER_SEC,
          ).toLocaleString()}
          unit="breaths (est.)"
        />
      )}
      {mode === "moons" && (
        <StatLine
          value={(days / LUNAR_CYCLE_DAYS).toFixed(5)}
          unit="lunar cycles"
        />
      )}
      {mode === "firstYear" && (
        <StatLine
          value={((days / 365.25) * 100).toFixed(4) + "%"}
          unit="of her first year"
        />
      )}
      <span className="text-[9px] uppercase tracking-wider opacity-60">
        tap to change
      </span>
    </button>
  );
}

function StatLine({ value, unit }: { value: string; unit: string }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="text-sm font-bold tabular-nums text-foreground">
        {value}
      </span>
      <span className="text-xs">{unit}</span>
    </span>
  );
}

function TallyMarks({
  days,
  fraction,
}: {
  days: number;
  fraction: number;
}) {
  // Completed days as full-height marks, plus one partial for the in-progress day.
  const heights: number[] = Array.from({ length: days }, () => 1);
  const hasPartial = fraction > 0;
  if (hasPartial) heights.push(fraction);

  const groups: number[][] = [];
  for (let i = 0; i < heights.length; i += 5) {
    groups.push(heights.slice(i, i + 5));
  }

  return (
    <span className="flex items-center gap-1.5">
      <span className="flex flex-wrap items-center gap-1.5 max-w-[240px] justify-center">
        {groups.length === 0 && hasPartial === false ? (
          <span className="text-[10px] text-muted">—</span>
        ) : (
          groups.map((g, i) => <TallyGroup key={i} heights={g} />)
        )}
      </span>
      <span className="text-[10px] text-muted whitespace-nowrap">
        {days === 0 && hasPartial
          ? "day 1"
          : days === 1 && !hasPartial
            ? "day"
            : "days"}
      </span>
    </span>
  );
}

function TallyGroup({ heights }: { heights: number[] }) {
  const barWidth = 3;
  const barGap = 3;
  const barHeight = 18;
  const bars = heights.slice(0, 5);
  const groupWidth =
    bars.length * barWidth + Math.max(0, bars.length - 1) * barGap + 4;
  const stroke = "var(--color-accent)";
  const isFullFive = bars.length === 5 && bars.every((h) => h >= 0.999);

  return (
    <svg
      width={groupWidth}
      height={barHeight + 4}
      viewBox={`0 0 ${groupWidth} ${barHeight + 4}`}
      aria-hidden="true"
    >
      {bars.map((h, i) => {
        const clamped = Math.max(0, Math.min(1, h));
        const top = 2 + barHeight * (1 - clamped);
        const bottom = barHeight + 2;
        const cx = i * (barWidth + barGap) + barWidth / 2 + 2;
        return (
          <line
            key={i}
            x1={cx}
            x2={cx}
            y1={top}
            y2={bottom}
            stroke={stroke}
            strokeWidth={barWidth}
            strokeLinecap="round"
            opacity={clamped < 1 ? 0.55 : 1}
          />
        );
      })}
      {isFullFive && (
        <line
          x1={2}
          x2={2 + 4 * (barWidth + barGap) + barWidth}
          y1={barHeight * 0.8 + 2}
          y2={barHeight * 0.2 + 2}
          stroke={stroke}
          strokeWidth={barWidth - 0.5}
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}
