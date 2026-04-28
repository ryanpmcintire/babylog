/**
 * Pure-function tests for lib/aggregates.
 *
 * Run with:  npx tsx --test tests/aggregates.test.ts
 */

import { test } from "node:test";
import assert from "node:assert";
import { Timestamp } from "firebase/firestore";
import { estimateNextEvent, inferredSleepWindows } from "../lib/aggregates";
import type { BabyEvent } from "../lib/events";

function evt<T extends BabyEvent["type"]>(
  type: T,
  occurred: Date,
  extra: Record<string, unknown> = {},
): BabyEvent {
  return {
    id: `id-${Math.random().toString(36).slice(2, 8)}`,
    type,
    occurred_at: Timestamp.fromDate(occurred),
    created_at: Timestamp.fromDate(occurred),
    created_by: "uid",
    deleted: false,
    ...extra,
  } as BabyEvent;
}

test("estimateNextEvent: diaper prediction anchors on most recent mixed", () => {
  // Regression: a fresh diaper_mixed must reset the prediction window.
  // Before the fix, the filter excluded "diaper_mixed", so the prediction
  // anchored on an older wet/dirty event and showed "overdue" right after
  // a mixed log.
  const now = new Date(2026, 3, 28, 12, 0);
  // newest-first
  const events: BabyEvent[] = [
    evt("diaper_mixed", new Date(now.getTime() - 39 * 60 * 1000)),
    evt("diaper_wet", new Date(now.getTime() - 4 * 60 * 60 * 1000)),
    evt("diaper_dirty", new Date(now.getTime() - 7 * 60 * 60 * 1000)),
    evt("diaper_wet", new Date(now.getTime() - 10 * 60 * 60 * 1000)),
  ];
  const result = estimateNextEvent(
    events,
    ["diaper_wet", "diaper_dirty", "diaper_mixed"],
    8,
    15 * 60 * 1000,
  );
  assert.ok(result, "expected a prediction");
  assert.strictEqual(
    result!.lastAt.getTime(),
    events[0]!.occurred_at.toMillis(),
    "lastAt must be the most recent diaper (the mixed one)",
  );
  // nextAt should be in the future, not overdue, given the mixed is 39m ago
  // and the median interval between the older events is ~3h.
  assert.ok(
    result!.nextAt.getTime() > now.getTime(),
    "next diaper must not be overdue right after a fresh mixed log",
  );
});

test("estimateNextEvent: returns null when fewer than 2 events match", () => {
  const now = new Date(2026, 3, 28, 12, 0);
  const events: BabyEvent[] = [
    evt("diaper_wet", new Date(now.getTime() - 30 * 60 * 1000)),
  ];
  const result = estimateNextEvent(
    events,
    ["diaper_wet", "diaper_dirty", "diaper_mixed"],
    8,
    15 * 60 * 1000,
  );
  assert.strictEqual(result, null);
});

test("estimateNextEvent: merges events within mergeWithinMs into one session", () => {
  // wet + dirty logged together (within 15 min) should count as one diaper
  // session; the median interval should reflect spacing between sessions,
  // not the within-session gap.
  const now = new Date(2026, 3, 28, 12, 0);
  const events: BabyEvent[] = [
    evt("diaper_wet", new Date(now.getTime() - 1 * 60 * 60 * 1000)),
    evt("diaper_dirty", new Date(now.getTime() - 1 * 60 * 60 * 1000 - 2 * 60 * 1000)),
    evt("diaper_wet", new Date(now.getTime() - 4 * 60 * 60 * 1000)),
    evt("diaper_wet", new Date(now.getTime() - 7 * 60 * 60 * 1000)),
  ];
  const result = estimateNextEvent(
    events,
    ["diaper_wet", "diaper_dirty", "diaper_mixed"],
    8,
    15 * 60 * 1000,
  );
  assert.ok(result);
  // 3 sessions => 2 intervals of ~3h each => median ~3h, not 2 minutes
  const hours = result!.medianIntervalMs / 3600000;
  assert.ok(hours > 2.5 && hours < 3.5, `expected ~3h median, got ${hours}h`);
});

test("inferredSleepWindows: diaper_mixed splits inferred sleep around it", () => {
  // Regression: buildAwakeIntervals previously omitted "diaper_mixed", so a
  // mixed diaper change in the middle of a long quiet stretch did not break
  // up inferred sleep — the algorithm produced one giant sleep window
  // straight through the change time, inflating sleep totals.
  //
  // With the fix, the mixed event is awake-signaling like wet/dirty, so the
  // inferred sleep around it must be split into two windows separated by
  // the awake interval at the mixed event.
  const feed1 = new Date(2026, 3, 28, 8, 0); // 08:00
  const mixedAt = new Date(2026, 3, 28, 10, 0); // 10:00 (2h after feed1)
  const feed2 = new Date(2026, 3, 28, 12, 0); // 12:00 (4h after feed1)
  const now = new Date(2026, 3, 28, 12, 5); // just after feed2

  const events: BabyEvent[] = [
    evt("breast_feed", feed1),
    evt("diaper_mixed", mixedAt),
    evt("breast_feed", feed2),
  ];

  const windows = inferredSleepWindows(events, 0, now);

  // Expect two distinct inferred sleep windows that bracket the mixed event,
  // not one continuous window spanning across it.
  assert.strictEqual(
    windows.length,
    2,
    `expected 2 inferred sleep windows split by mixed diaper, got ${windows.length}`,
  );

  // Neither window should contain the mixed-diaper instant.
  const mixedMs = mixedAt.getTime();
  for (const w of windows) {
    const startMs = w.start.getTime();
    const endMs = w.end.getTime();
    assert.ok(
      mixedMs < startMs || mixedMs > endMs,
      `inferred sleep window [${w.start.toISOString()}, ${w.end.toISOString()}] must not contain mixed diaper at ${mixedAt.toISOString()}`,
    );
  }

  // The first window must end before the mixed event, the second must start
  // after it — i.e. they sit on either side of the awake interval at mixed.
  const sorted = [...windows].sort(
    (a, b) => a.start.getTime() - b.start.getTime(),
  );
  assert.ok(
    sorted[0]!.end.getTime() <= mixedMs,
    "first sleep window must end at or before the mixed diaper time",
  );
  assert.ok(
    sorted[1]!.start.getTime() >= mixedMs,
    "second sleep window must start at or after the mixed diaper time",
  );
});
