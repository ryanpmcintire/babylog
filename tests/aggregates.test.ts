/**
 * Pure-function tests for lib/aggregates.
 *
 * Run with:  npx tsx --test tests/aggregates.test.ts
 */

import { test } from "node:test";
import assert from "node:assert";
import { Timestamp } from "firebase/firestore";
import { estimateNextEvent } from "../lib/aggregates";
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
