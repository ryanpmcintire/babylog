"use client";

import { useEffect, useState } from "react";
import { LILY_BIRTHDATE, ageInMs } from "@/lib/age";

const NEWBORN_BPS = 135 / 60;
const NEWBORN_BREATHS_PER_SEC = 42 / 60;
const LUNAR_CYCLE_DAYS = 29.530588;

type Mode =
  | "tally"
  | "minutes"
  | "heartbeats"
  | "breaths"
  | "moons"
  | "firstYear";

const MODE_ORDER: Mode[] = [
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
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const ms = ageInMs(LILY_BIRTHDATE, new Date(now));
  const totalSeconds = Math.floor(ms / 1000);
  const totalMinutes = Math.floor(ms / 60000);
  const days = ms / 86400000;
  const wholeDays = Math.floor(days);

  const mode = MODE_ORDER[modeIdx % MODE_ORDER.length]!;

  function cycle() {
    setModeIdx((i) => (i + 1) % MODE_ORDER.length);
  }

  return (
    <button
      type="button"
      onClick={cycle}
      aria-label="Tap to show a different unit"
      className="flex flex-col items-center gap-1 text-muted hover:text-foreground transition"
    >
      {mode === "tally" && <TallyMarks days={wholeDays} />}
      {mode === "minutes" && (
        <StatLine
          value={`${totalMinutes.toLocaleString()}m ${(totalSeconds % 60)
            .toString()
            .padStart(2, "0")}s`}
          unit="alive"
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

function TallyMarks({ days }: { days: number }) {
  const groups = Math.floor(days / 5);
  const remainder = days % 5;
  const groupArr = Array.from({ length: groups }, () => 5);
  if (remainder > 0) groupArr.push(remainder);

  return (
    <span className="flex items-center gap-1.5">
      <span className="flex flex-wrap items-center gap-1.5 max-w-[220px] justify-center">
        {groupArr.map((count, i) => (
          <TallyGroup key={i} count={count} />
        ))}
      </span>
      <span className="text-[10px] text-muted whitespace-nowrap">
        {days === 1 ? "day" : "days"}
      </span>
    </span>
  );
}

function TallyGroup({ count }: { count: number }) {
  const barWidth = 3;
  const barGap = 3;
  const barHeight = 18;
  const groupWidth = 4 * barWidth + 3 * barGap + 6;
  const stroke = "var(--color-accent)";

  return (
    <svg
      width={count === 5 ? groupWidth : count * barWidth + (count - 1) * barGap}
      height={barHeight + 4}
      viewBox={`0 0 ${groupWidth} ${barHeight + 4}`}
      aria-hidden="true"
    >
      {Array.from({ length: Math.min(count, 4) }).map((_, i) => (
        <line
          key={i}
          x1={i * (barWidth + barGap) + barWidth / 2}
          x2={i * (barWidth + barGap) + barWidth / 2}
          y1={2}
          y2={barHeight + 2}
          stroke={stroke}
          strokeWidth={barWidth}
          strokeLinecap="round"
        />
      ))}
      {count === 5 && (
        <line
          x1={-1}
          x2={4 * (barWidth + barGap) + 1}
          y1={barHeight * 0.75}
          y2={barHeight * 0.3}
          stroke={stroke}
          strokeWidth={barWidth - 0.5}
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}
